// src/firebase/firebase.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';

dns.setDefaultResultOrder('ipv4first');

export interface BatchOperation {
  type: 'set' | 'update' | 'delete';
  collection: string;
  docId: string;
  data?: any;
}

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  
  private db: admin.firestore.Firestore;
  private realtimeDbAdmin: admin.database.Database | null = null;
  private realtimeDbRest: AxiosInstance | null = null;
  
  private isConnected = false;
  
  private useRestForRealtimeDb = false;
  private restConnectionPool: AxiosInstance[] = [];
  private readonly POOL_SIZE = 3;
  private currentPoolIndex = 0;
  
  private queryCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000;
  private readonly STALE_CACHE_TTL = 120000;
  
  private writeQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  
  private writeStats = { 
    success: 0, 
    failed: 0, 
    queued: 0,
    lastSuccessTime: Date.now() 
  };
  
  private firestoreReadCount = 0;
  private realtimeWriteCount = 0;
  private lastReadReset = Date.now();
  
  private lastHeartbeat = Date.now();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 5;
  
  private operationCount = 0;
  private avgResponseTime = 0;
  private cacheHitRate = 0;
  
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 200;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;
  
  private connectionHealth = {
    restConnections: new Map<number, { lastSuccess: number; failures: number }>(),
    lastSuccessfulFetch: Date.now(),
    consecutiveFailures: 0,
  };

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      dns.setDefaultResultOrder('ipv4first');
      
      const serviceAccount = {
        projectId: this.configService.get('firebase.projectId'),
        privateKey: this.configService.get('firebase.privateKey'),
        clientEmail: this.configService.get('firebase.clientEmail'),
      };

      if (!serviceAccount.projectId || !serviceAccount.privateKey || !serviceAccount.clientEmail) {
        throw new Error('Firebase credentials missing');
      }

      this.logger.log('⚡ Initializing Firebase (OPTIMIZED MODE)...');

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
          databaseURL: this.configService.get('firebase.realtimeDbUrl'),
        });
      }

      this.db = admin.firestore();
      this.db.settings({
        ignoreUndefinedProperties: true,
        timestampsInSnapshots: true,
        maxIdleChannels: 5,
      });

      try {
        await Promise.race([
          this.db.collection('_health_check').limit(1).get(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        this.logger.log('✅ Firestore ready');
      } catch (error) {
        this.logger.warn(`⚠️ Firestore test failed: ${error.message}`);
      }

      await this.initializeRealtimeDbWithPool();
      
      this.isConnected = this.useRestForRealtimeDb || this.realtimeDbAdmin !== null;
      
      this.logger.log('✅ Firebase OPTIMIZED mode ready!');
      this.logger.log('💡 Optimizations:');
      this.logger.log('   • Connection pool: 3');
      this.logger.log('   • Cache TTL: 30s');
      this.logger.log('   • Stale cache: 120s');
      this.logger.log('   • Aggressive caching for reads');
      this.logger.log('   • Batch writes for efficiency');
      this.logger.log('   • Health check: Every 2 minutes');
      this.logger.log('   • Timeouts: 5s (generous)');
      
      this.startBackgroundTasks();
      
    } catch (error) {
      this.logger.error(`❌ Firebase initialization failed: ${error.message}`);
      this.isConnected = false;
      throw error;
    }
  }

  private async initializeRealtimeDbWithPool() {
    const realtimeDbUrl = this.configService.get('firebase.realtimeDbUrl');
    
    if (!realtimeDbUrl) {
      this.logger.warn('⚠️ Realtime DB URL not configured');
      this.isConnected = false;
      return;
    }

    try {
      this.logger.log('⚡ Creating optimized REST connection pool...');
      
      const baseURL = realtimeDbUrl.replace(/\/$/, '');
      
      const httpAgent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 60000,
        maxSockets: 10,
        maxFreeSockets: 5,
        timeout: 30000,
      });
      
      const httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 60000,
        maxSockets: 10,
        maxFreeSockets: 5,
        timeout: 30000,
      });
      
      for (let i = 0; i < this.POOL_SIZE; i++) {
        const instance = axios.create({
          baseURL,
          timeout: 5000, // ✅ FIX: Increased from 3s to 5s
          family: 4,
          headers: {
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
          },
          validateStatus: (status) => status >= 200 && status < 300,
          maxRedirects: 0,
          httpAgent: httpAgent,
          httpsAgent: httpsAgent,
        });
        
        this.restConnectionPool.push(instance);
        this.connectionHealth.restConnections.set(i, {
          lastSuccess: Date.now(),
          failures: 0
        });
      }
      
      // ✅ FIX: Test with longer timeout
      await Promise.race([
        this.restConnectionPool[0].get('/.json?shallow=true'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Init timeout')), 8000)
        ),
      ]);
      
      this.useRestForRealtimeDb = true;
      this.realtimeDbRest = this.restConnectionPool[0];
      this.isConnected = true;
      
      this.logger.log(`✅ Optimized REST pool created (${this.POOL_SIZE} connections)`);
      
    } catch (restError) {
      this.logger.warn(`⚠️ REST API failed: ${restError.message}`);
      this.isConnected = false;
      
      try {
        this.logger.log('⚡ Trying Admin SDK...');
        this.realtimeDbAdmin = admin.database();
        this.realtimeDbAdmin.goOffline();
        this.realtimeDbAdmin.goOnline();
        this.useRestForRealtimeDb = false;
        this.isConnected = true;
        this.logger.log('✅ Realtime DB via Admin SDK');
      } catch (sdkError) {
        this.logger.error('❌ Both methods failed');
        this.isConnected = false;
      }
    }
  }

  private getNextConnection(): AxiosInstance {
    if (this.restConnectionPool.length === 0) {
      throw new Error('No REST connections available');
    }
    
    let bestIndex = this.currentPoolIndex;
    let bestScore = -Infinity;
    let hasHealthyConnection = false;
    
    // Find the healthiest connection
    for (let i = 0; i < this.restConnectionPool.length; i++) {
      const health = this.connectionHealth.restConnections.get(i);
      if (!health) continue;
      
      const age = Date.now() - health.lastSuccess;
      const failureScore = health.failures * 1000;
      const score = 10000 - age - failureScore;
      
      if (score > bestScore) {
        bestIndex = i;
        bestScore = score;
      }
      
      // ✅ FIX: More generous healthy threshold
      // Healthy if: last success within 5 minutes AND less than 5 failures
      if (age < 300000 && health.failures < 5) {
        hasHealthyConnection = true;
      }
    }
    
    // ✅ FIX: Only warn if NO healthy connections, but DON'T block
    if (!hasHealthyConnection) {
      // Only log every 10th unhealthy check to reduce spam
      if (this.operationCount % 10 === 0) {
        this.logger.warn(`⚠️ No optimal connections (using best available: ${bestIndex}, score: ${bestScore})`);
      }
      
      // DON'T trigger reconnect here - let health check handle it
      // Just reset some failures to give connections a chance
      for (let i = 0; i < this.restConnectionPool.length; i++) {
        const health = this.connectionHealth.restConnections.get(i);
        if (health && health.failures > 0) {
          health.failures = Math.max(0, health.failures - 1);
        }
      }
    }
    
    this.currentPoolIndex = (bestIndex + 1) % this.POOL_SIZE;
    
    return this.restConnectionPool[bestIndex];
  }

  async getRealtimeDbValue(path: string, useCache = true): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Firebase not connected');
    }

    const startTime = Date.now();

    if (useCache) {
      const cached = this.getCachedQuery(path);
      if (cached !== null) {
        this.cacheHitRate++;
        this.logger.debug(`⚡ Cache hit: ${path}`);
        return cached;
      }
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const data = await this.fetchRealtimeDbWithTimeout(path);
        
        this.connectionHealth.consecutiveFailures = 0;
        this.connectionHealth.lastSuccessfulFetch = Date.now();

        if (useCache && data !== null) {
          this.cacheQuery(path, data);
        }

        const duration = Date.now() - startTime;
        this.operationCount++;
        this.avgResponseTime = (this.avgResponseTime * 0.9) + (duration * 0.1);

        return data;

      } catch (error) {
        lastError = error;
        const connIndex = this.currentPoolIndex;
        const health = this.connectionHealth.restConnections.get(connIndex);
        if (health) {
          health.failures++;
        }
        
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAY_MS * Math.pow(1.5, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    const staleCache = this.getStaleCache(path);
    if (staleCache !== null) {
      this.logger.warn(`⚠️ Using stale cache: ${path}`);
      this.connectionHealth.consecutiveFailures++;
      return staleCache;
    }

    this.connectionHealth.consecutiveFailures++;
    const duration = Date.now() - startTime;
    
    this.logger.error(`❌ Get failed after ${this.MAX_RETRIES} retries (${duration}ms): ${lastError?.message}`);
    
    if (this.connectionHealth.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      this.logger.error('❌ Too many failures, reconnecting...');
      setImmediate(() => this.reconnectRealtimeDb());
    }
    
    throw lastError || new Error('Failed to fetch');
  }

  private async fetchRealtimeDbWithTimeout(path: string): Promise<any> {
    return Promise.race([
      this.fetchRealtimeDb(path),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 5000)
      ),
    ]);
  }

  private async fetchRealtimeDb(path: string): Promise<any> {
    if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
      const conn = this.getNextConnection();
      const response = await conn.get(`${path}.json`);
      
      const connIndex = this.restConnectionPool.indexOf(conn);
      if (connIndex >= 0) {
        const health = this.connectionHealth.restConnections.get(connIndex);
        if (health) {
          health.lastSuccess = Date.now();
          health.failures = Math.max(0, health.failures - 1);
        }
      }
      
      return response.data;
      
    } else if (this.realtimeDbAdmin) {
      const snapshot = await this.realtimeDbAdmin.ref(path).once('value');
      return snapshot.val();
      
    } else {
      throw new Error('Realtime Database not available');
    }
  }

  async setRealtimeDbValue(path: string, data: any, critical = false): Promise<void> {
    if (!this.isConnected) {
      this.logger.error('❌ Cannot write: Firebase not connected');
      this.writeStats.failed++;
      return;
    }

    const writeOperation = async () => {
      for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
        try {
          if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
            const conn = this.getNextConnection();
            await conn.put(`${path}.json`, data);
          } else if (this.realtimeDbAdmin) {
            await this.realtimeDbAdmin.ref(path).set(data);
          } else {
            throw new Error('Realtime Database not available');
          }

          this.writeStats.success++;
          this.realtimeWriteCount++;
          this.writeStats.lastSuccessTime = Date.now();
          this.consecutiveErrors = 0;
          this.queryCache.delete(path);
          return;

        } catch (error) {
          if (attempt < this.MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS));
          }
        }
      }
      
      this.writeStats.failed++;
      this.consecutiveErrors++;
    };

    if (critical) {
      await writeOperation();
    } else {
      this.writeStats.queued++;
      this.writeQueue.push(writeOperation);
      this.processWriteQueue();
    }
  }

  async setRealtimeDbValueAsync(path: string, data: any): Promise<void> {
    this.writeStats.queued++;
    this.writeQueue.push(async () => {
      try {
        await this.setRealtimeDbValue(path, data, true);
      } catch (error) {
        this.logger.error(`Async write failed: ${error.message}`);
      }
    });
    
    if (this.writeQueue.length > 500) {
      this.logger.warn(`⚠️ Write queue overflow (${this.writeQueue.length}), dropping oldest entries`);
      this.writeQueue = this.writeQueue.slice(-250);
    }
  }

  private async processWriteQueue(): Promise<void> {
    if (this.isProcessingQueue || this.writeQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    const batch = this.writeQueue.splice(0, 20);
    
    await Promise.allSettled(
      batch.map(write => write())
    );
    
    const now = Date.now();
    this.writeQueue = this.writeQueue.filter(item => {
      return now - (item as any).addedAt < 300000;
    });
    
    this.isProcessingQueue = false;
  }

  async deleteRealtimeDbData(path: string): Promise<boolean> {
    if (!this.isConnected || (!this.useRestForRealtimeDb && !this.realtimeDbAdmin)) {
      this.logger.error('❌ Cannot delete: Realtime DB not available');
      return false;
    }

    try {
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      
      this.logger.log(`🗑️ Deleting Realtime DB path: ${cleanPath}...`);

      if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
        const conn = this.getNextConnection();
        await conn.delete(`${cleanPath}.json`);
      } else if (this.realtimeDbAdmin) {
        await this.realtimeDbAdmin.ref(cleanPath).remove();
      }

      this.logger.log(`✅ Successfully deleted: ${cleanPath}`);
      return true;

    } catch (error) {
      if (error.response?.status === 404 || error.code === 'DATABASE_REFERENCE_NOT_FOUND') {
        this.logger.warn(`⚠️ Path not found (treating as success): ${path}`);
        return true;
      }

      this.logger.error(`❌ Failed to delete ${path}: ${error.message}`);
      return false;
    }
  }

  private getCachedQuery(path: string): any | null {
    const cached = this.queryCache.get(path);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) return null;

    return cached.data;
  }

  private getStaleCache(path: string): any | null {
    const cached = this.queryCache.get(path);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.STALE_CACHE_TTL) return null;

    return cached.data;
  }

  private cacheQuery(path: string, data: any): void {
    this.queryCache.set(path, {
      data,
      timestamp: Date.now(),
    });
    
    if (this.queryCache.size > 300) {
      const oldestKeys = Array.from(this.queryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 50)
        .map(([key]) => key);
      
      oldestKeys.forEach(key => this.queryCache.delete(key));
    }
  }

  private startBackgroundTasks() {
    setInterval(() => this.cleanupCache(), 60000);
    // ✅ FIX: Health check every 2 minutes instead of 1 minute
    setInterval(() => this.healthCheckConnections(), 120000);
    setInterval(() => this.processWriteQueue(), 200);
    setInterval(() => this.resetDailyStats(), 86400000);
  }

  private cleanupCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [path, cached] of this.queryCache.entries()) {
      if (now - cached.timestamp > this.STALE_CACHE_TTL) {
        this.queryCache.delete(path);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`⚡ Cleaned ${cleaned} cache entries`);
    }
  }

  private async healthCheckConnections(): Promise<void> {
    if (!this.useRestForRealtimeDb || this.restConnectionPool.length === 0) return;

    try {
      const conn = this.restConnectionPool[0];
      // ✅ FIX: Increase timeout to 5s for health check
      await Promise.race([
        conn.get('/.json?shallow=true'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        ),
      ]);
      
      // Success - reset ALL health metrics
      this.connectionHealth.consecutiveFailures = 0;
      this.connectionHealth.lastSuccessfulFetch = Date.now();
      
      // Mark all connections as healthy
      for (const [index, health] of this.connectionHealth.restConnections) {
        health.lastSuccess = Date.now();
        health.failures = Math.max(0, health.failures - 1);
      }
      
    } catch (error) {
      this.connectionHealth.consecutiveFailures++;
      
      // ✅ FIX: Only warn, don't reconnect yet
      if (this.connectionHealth.consecutiveFailures <= 5) {
        this.logger.debug(
          `⏳ Health check attempt ${this.connectionHealth.consecutiveFailures}/5 waiting...`
        );
        return;
      }
      
      this.logger.error(
        `❌ Health check failed ${this.connectionHealth.consecutiveFailures} times: ${error.message}`
      );
      
      // ✅ FIX: More relaxed threshold - check if REALLY all unhealthy
      let allUnhealthy = true;
      let healthyCount = 0;
      
      for (const [index, health] of this.connectionHealth.restConnections) {
        const age = Date.now() - health.lastSuccess;
        // More generous: 5 minutes instead of 1 minute
        if (age < 300000 && health.failures < 10) {
          allUnhealthy = false;
          healthyCount++;
        }
      }
      
      this.logger.warn(`⚠️ Healthy connections: ${healthyCount}/${this.POOL_SIZE}`);
      
      // Only reconnect if REALLY all connections are dead
      if (allUnhealthy && this.connectionHealth.consecutiveFailures >= 10) {
        this.logger.error('❌ All connections truly unhealthy - triggering reconnect');
        this.connectionHealth.consecutiveFailures = 0;
        await this.reconnectRealtimeDb();
      } else if (healthyCount > 0) {
        this.logger.log(`✅ ${healthyCount} connections still working, continuing...`);
        this.connectionHealth.consecutiveFailures = 0;
      }
    }
  }

  private async reconnectRealtimeDb(): Promise<void> {
    this.logger.log('🔄 Reconnecting Realtime DB...');
    
    try {
      // Clear existing pools
      this.restConnectionPool = [];
      this.connectionHealth.restConnections.clear();
      
      // Recreate connection pool
      await this.initializeRealtimeDbWithPool();
      
      // Test connection
      if (this.restConnectionPool.length > 0) {
        try {
          await Promise.race([
            this.restConnectionPool[0].get('/.json?shallow=true'),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Test timeout')), 5000)
            ),
          ]);
          
          this.connectionHealth.consecutiveFailures = 0;
          this.connectionHealth.lastSuccessfulFetch = Date.now();
          
          this.logger.log('✅ Reconnection successful');
        } catch (testError) {
          this.logger.error(`❌ Reconnection test failed: ${testError.message}`);
          throw testError;
        }
      } else {
        throw new Error('No connections created after reconnect');
      }
      
    } catch (error) {
      this.logger.error(`❌ Reconnection failed: ${error.message}`);
      this.isConnected = false;
      
      // Schedule retry after delay
      setTimeout(() => {
        this.logger.warn('🔄 Retrying reconnection...');
        this.reconnectRealtimeDb();
      }, 5000);
    }
  }

  private resetDailyStats(): void {
    const hoursSinceReset = (Date.now() - this.lastReadReset) / 3600000;
    
    this.logger.log('📊 Daily Stats:');
    this.logger.log(`   • Reads: ${this.firestoreReadCount} (${Math.round(this.firestoreReadCount / hoursSinceReset)}/hour)`);
    this.logger.log(`   • Writes: ${this.writeStats.success} (${Math.round(this.writeStats.success / hoursSinceReset)}/hour)`);
    
    this.firestoreReadCount = 0;
    this.writeStats.success = 0;
    this.lastReadReset = Date.now();
  }

  isFirestoreReady(): boolean {
    return this.db !== undefined;
  }

  async waitForFirestore(maxWaitMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    
    while (!this.isFirestoreReady()) {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error('Firestore initialization timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  getFirestore(): admin.firestore.Firestore {
    if (!this.db) {
      throw new Error('Firestore not initialized');
    }
    if (!this.isFirestoreReady()) {
      throw new Error('Firestore not ready yet');
    }
    
    this.firestoreReadCount++;
    return this.db;
  }

  getRealtimeDatabase(): admin.database.Database {
    if (!this.realtimeDbAdmin) {
      throw new Error('Realtime Database not available');
    }
    return this.realtimeDbAdmin;
  }

  async generateId(collection: string): Promise<string> {
    return this.getFirestore().collection(collection).doc().id;
  }

  async createWithTimestamp(collection: string, data: any): Promise<string> {
    const id = await this.generateId(collection);
    const timestamp = new Date().toISOString();
    
    await this.getFirestore().collection(collection).doc(id).set({
      ...data,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    
    this.writeStats.success++;
    return id;
  }

  async updateWithTimestamp(collection: string, id: string, data: any): Promise<void> {
    await this.getFirestore().collection(collection).doc(id).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
    
    this.writeStats.success++;
  }

  async batchWrite(operations: BatchOperation[]): Promise<void> {
    const db = this.getFirestore();
    const BATCH_LIMIT = 500;
    
    for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
      const chunk = operations.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();

      for (const operation of chunk) {
        const docRef = db.collection(operation.collection).doc(operation.docId);

        switch (operation.type) {
          case 'set':
            if (!operation.data) throw new Error('Data required for set');
            batch.set(docRef, operation.data);
            break;

          case 'update':
            if (!operation.data) throw new Error('Data required for update');
            batch.update(docRef, operation.data);
            break;

          case 'delete':
            batch.delete(docRef);
            break;
        }
      }

      await batch.commit();
      this.writeStats.success += chunk.length;
    }
  }

  async batchDeleteRealtimeDb(paths: string[]): Promise<void> {
  if (!this.isConnected) {
    throw new Error('Firebase not connected');
  }

  if (paths.length === 0) return;

  try {
    // Gunakan update dengan null values untuk batch delete
    const updates: any = {};
    paths.forEach(path => {
      updates[path] = null;
    });

    if (this.useRestForRealtimeDb) {
      await this.getNextConnection().patch('/.json', updates);
    } else if (this.realtimeDbAdmin) {
      await this.realtimeDbAdmin.ref().update(updates);
    }
    
    this.writeStats.success += paths.length;
  } catch (error) {
    this.writeStats.failed += paths.length;
    throw error;
  }
}

/**
 * ✅ NEW: Cek apakah Admin SDK untuk RTDB tersedia
 */
isRealtimeDbAdminAvailable(): boolean {
  return this.realtimeDbAdmin !== null && !this.useRestForRealtimeDb;
}

  async runTransaction<T>(
    updateFunction: (transaction: admin.firestore.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.getFirestore().runTransaction(updateFunction);
  }

  getPerformanceStats() {
    const timeSinceLastSuccess = Date.now() - this.connectionHealth.lastSuccessfulFetch;
    const totalOps = this.operationCount + this.cacheHitRate;
    const cacheHitPercentage = totalOps > 0 ? Math.round((this.cacheHitRate / totalOps) * 100) : 0;
    const hoursSinceReset = (Date.now() - this.lastReadReset) / 3600000;
    
    return {
      operations: this.operationCount,
      avgResponseTime: Math.round(this.avgResponseTime),
      cacheSize: this.queryCache.size,
      cacheHitRate: `${cacheHitPercentage}%`,
      connectionPoolSize: this.restConnectionPool.length,
      writeQueueSize: this.writeQueue.length,
      usingREST: this.useRestForRealtimeDb,
      dailyStats: {
        reads: this.firestoreReadCount,
        writes: this.writeStats.success,
        estimatedDailyReads: Math.round(this.firestoreReadCount / hoursSinceReset * 24),
        estimatedDailyWrites: Math.round(this.writeStats.success / hoursSinceReset * 24),
      },
      health: {
        consecutiveFailures: this.connectionHealth.consecutiveFailures,
        lastSuccessMs: timeSinceLastSuccess,
        isHealthy: this.connectionHealth.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES,
        isConnected: this.isConnected,
      },
    };
  }

  async shutdown() {
    this.logger.warn('🛑 Shutting down Firebase Service...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.writeQueue.length > 0) {
      this.logger.warn(`📤 Processing ${this.writeQueue.length} remaining writes...`);
      
      while (this.writeQueue.length > 0) {
        const batch = this.writeQueue.splice(0, 10);
        await Promise.allSettled(batch.map(write => write()));
      }
    }
    
    this.logger.warn('✅ Firebase Service shutdown complete');
  }
}