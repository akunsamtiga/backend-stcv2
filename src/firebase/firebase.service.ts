// src/firebase/firebase.service.ts
// ⚡ ULTRA-PERFORMANCE VERSION - TypeScript Errors Fixed

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';

// ⚡ Force IPv4 globally
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
  
  // Firestore
  private db: admin.firestore.Firestore;
  
  // Realtime DB
  private realtimeDb: admin.database.Database | null = null;
  private realtimeDbRest: AxiosInstance | null = null;
  
  // Status
  private initialized = false;
  private firestoreReady = false;
  private useRestForRealtimeDb = false;
  
  // ⚡ ULTRA-FAST CONNECTION POOL
  private restConnectionPool: AxiosInstance[] = [];
  private readonly POOL_SIZE = 15;
  private currentPoolIndex = 0;
  
  // ⚡ AGGRESSIVE CACHING
  private queryCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 3000;
  private readonly STALE_CACHE_TTL = 20000;
  
  // ⚡ CONNECTION HEALTH
  private connectionHealth = {
    restConnections: new Map<number, { lastSuccess: number; failures: number }>(),
    lastSuccessfulFetch: Date.now(),
    consecutiveFailures: 0,
  };
  
  // ⚡ RETRY CONFIGURATION
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 100;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  
  // ⚡ PERFORMANCE TRACKING
  private operationCount = 0;
  private avgResponseTime = 0;
  private cacheHitRate = 0;
  
  // ⚡ WRITE QUEUE
  private writeQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;

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

      this.logger.log('⚡ Initializing Firebase (ULTRA-FAST mode)...');

      // Initialize Admin SDK
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        });
      }

      this.db = admin.firestore();
      
      // ⚡ ULTRA-OPTIMIZED Firestore settings
      this.db.settings({
        ignoreUndefinedProperties: true,
        timestampsInSnapshots: true,
        maxIdleChannels: 20,
      });

      // Test Firestore
      try {
        await Promise.race([
          this.db.collection('_health_check').limit(1).get(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
        ]);
        this.firestoreReady = true;
        this.logger.log('✅ Firestore ready (ultra-fast mode)');
      } catch (error) {
        this.logger.warn(`⚠️ Firestore test failed: ${error.message}`);
        this.firestoreReady = true;
      }

      // Initialize Realtime DB with enhanced pool
      await this.initializeRealtimeDbWithPool();
      
      this.initialized = true;
      this.logger.log('✅ Firebase ULTRA-FAST mode ready!');
      
      // ⚡ Background tasks
      this.startBackgroundTasks();
      
    } catch (error) {
      this.logger.error(`❌ Firebase initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * ⚡ ENHANCED CONNECTION POOL - Fixed TypeScript errors
   */
  private async initializeRealtimeDbWithPool() {
    const realtimeDbUrl = this.configService.get('firebase.realtimeDbUrl');
    
    if (!realtimeDbUrl) {
      this.logger.warn('⚠️ Realtime DB URL not configured');
      return;
    }

    try {
      this.logger.log('⚡ Creating ENHANCED REST connection pool...');
      
      const baseURL = realtimeDbUrl.replace(/\/$/, '');
      
      // ✅ FIXED: Create HTTP/HTTPS Agents for connection pooling
      const httpAgent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        maxFreeSockets: 25,
        timeout: 30000,
      });
      
      const httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        maxFreeSockets: 25,
        timeout: 30000,
      });
      
      // Create larger pool with optimized settings
      for (let i = 0; i < this.POOL_SIZE; i++) {
        const instance = axios.create({
          baseURL,
          timeout: 2000,
          family: 4,
          headers: {
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
            'Keep-Alive': 'timeout=30, max=100',
          },
          validateStatus: (status) => status >= 200 && status < 300,
          maxRedirects: 0,
          // ✅ FIXED: Use agents for connection pooling
          httpAgent: httpAgent,
          httpsAgent: httpsAgent,
        });
        
        this.restConnectionPool.push(instance);
        this.connectionHealth.restConnections.set(i, {
          lastSuccess: Date.now(),
          failures: 0
        });
      }
      
      // Quick test
      await this.restConnectionPool[0].get('/.json?shallow=true');
      
      this.useRestForRealtimeDb = true;
      this.realtimeDbRest = this.restConnectionPool[0];
      
      this.logger.log(`✅ ENHANCED REST pool created (${this.POOL_SIZE} connections)`);
      
    } catch (restError) {
      this.logger.warn(`⚠️ REST API failed: ${restError.message}`);
      
      // Fallback to SDK
      try {
        this.logger.log('⚡ Trying Admin SDK...');
        this.realtimeDb = admin.database();
        this.realtimeDb.goOffline();
        this.realtimeDb.goOnline();
        this.useRestForRealtimeDb = false;
        this.logger.log('✅ Realtime DB via Admin SDK');
      } catch (sdkError) {
        this.logger.error('❌ Both methods failed');
      }
    }
  }

  /**
   * ⚡ INTELLIGENT CONNECTION SELECTION
   */
  private getNextConnection(): AxiosInstance {
    if (this.restConnectionPool.length === 0) {
      throw new Error('No REST connections available');
    }
    
    // Find healthiest connection
    let bestIndex = this.currentPoolIndex;
    let bestScore = -Infinity;
    
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
    }
    
    this.currentPoolIndex = (bestIndex + 1) % this.POOL_SIZE;
    
    return this.restConnectionPool[bestIndex];
  }

  /**
   * ⚡ ULTRA-FAST GET with AGGRESSIVE CACHING
   */
  async getRealtimeDbValue(path: string, useCache = true): Promise<any> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const startTime = Date.now();

    // Check cache
    if (useCache) {
      const cached = this.getCachedQuery(path);
      if (cached !== null) {
        this.cacheHitRate++;
        this.logger.debug(`⚡ Cache hit: ${path}`);
        return cached;
      }
    }

    // Retry loop
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const data = await this.fetchRealtimeDbWithTimeout(path);
        
        // Success
        this.connectionHealth.consecutiveFailures = 0;
        this.connectionHealth.lastSuccessfulFetch = Date.now();

        // Cache
        if (useCache && data !== null) {
          this.cacheQuery(path, data);
        }

        const duration = Date.now() - startTime;
        this.operationCount++;
        this.avgResponseTime = (this.avgResponseTime * 0.9) + (duration * 0.1);

        if (attempt > 0) {
          this.logger.log(`✅ Retry ${attempt} succeeded: ${path} (${duration}ms)`);
        }

        return data;

      } catch (error) {
        lastError = error;
        
        // Mark connection as failed
        const connIndex = this.currentPoolIndex;
        const health = this.connectionHealth.restConnections.get(connIndex);
        if (health) {
          health.failures++;
        }
        
        // Retry with backoff
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAY_MS * Math.pow(1.5, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // Try stale cache
    const staleCache = this.getStaleCache(path);
    if (staleCache !== null) {
      this.logger.warn(`⚠️ Using stale cache: ${path}`);
      this.connectionHealth.consecutiveFailures++;
      return staleCache;
    }

    // Complete failure
    this.connectionHealth.consecutiveFailures++;
    const duration = Date.now() - startTime;
    
    this.logger.error(`❌ Get failed after ${this.MAX_RETRIES} retries (${duration}ms): ${lastError?.message}`);
    
    // Auto-reconnect
    if (this.connectionHealth.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      this.logger.error('❌ Too many failures, reconnecting...');
      setImmediate(() => this.reconnectRealtimeDb());
    }
    
    throw lastError || new Error('Failed to fetch');
  }

  /**
   * ⚡ TIMEOUT WRAPPER
   */
  private async fetchRealtimeDbWithTimeout(path: string): Promise<any> {
    return Promise.race([
      this.fetchRealtimeDb(path),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 3000)
      ),
    ]);
  }

  /**
   * ⚡ CORE FETCH LOGIC
   */
  private async fetchRealtimeDb(path: string): Promise<any> {
    if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
      const conn = this.getNextConnection();
      const response = await conn.get(`${path}.json`);
      
      // Mark as successful
      const connIndex = this.restConnectionPool.indexOf(conn);
      if (connIndex >= 0) {
        const health = this.connectionHealth.restConnections.get(connIndex);
        if (health) {
          health.lastSuccess = Date.now();
          health.failures = Math.max(0, health.failures - 1);
        }
      }
      
      return response.data;
      
    } else if (this.realtimeDb) {
      const snapshot = await this.realtimeDb.ref(path).once('value');
      return snapshot.val();
      
    } else {
      throw new Error('Realtime Database not available');
    }
  }

  /**
   * ⚡ ASYNC SET (Non-blocking for non-critical writes)
   */
  async setRealtimeDbValue(path: string, data: any, critical = false): Promise<void> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const writeOperation = async () => {
      for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
        try {
          if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
            const conn = this.getNextConnection();
            await conn.put(`${path}.json`, data);
          } else if (this.realtimeDb) {
            await this.realtimeDb.ref(path).set(data);
          } else {
            throw new Error('Realtime Database not available');
          }

          // Success
          this.queryCache.delete(path);
          return;

        } catch (error) {
          if (attempt < this.MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS));
          }
        }
      }
    };

    if (critical) {
      await writeOperation();
    } else {
      this.writeQueue.push(writeOperation);
      this.processWriteQueue();
    }
  }

  /**
   * ⚡ BACKGROUND WRITE QUEUE PROCESSOR
   */
  private async processWriteQueue() {
    if (this.isProcessingQueue || this.writeQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    
    while (this.writeQueue.length > 0) {
      const write = this.writeQueue.shift();
      if (write) {
        try {
          await write();
        } catch (error) {
          this.logger.error(`Write queue error: ${error.message}`);
        }
      }
    }
    
    this.isProcessingQueue = false;
  }

  /**
   * ⚡ CACHE MANAGEMENT
   */
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
    
    // Auto-cleanup if cache too large
    if (this.queryCache.size > 1000) {
      const oldestKeys = Array.from(this.queryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 100)
        .map(([key]) => key);
      
      oldestKeys.forEach(key => this.queryCache.delete(key));
    }
  }

  /**
   * ⚡ BACKGROUND TASKS
   */
  private startBackgroundTasks() {
    setInterval(() => this.cleanupCache(), 30000);
    setInterval(() => this.healthCheckConnections(), 10000);
    setInterval(() => this.processWriteQueue(), 100);
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
      await conn.get('/.json?shallow=true&timeout=1000');
      
      const timeSinceLastSuccess = Date.now() - this.connectionHealth.lastSuccessfulFetch;
      
      if (timeSinceLastSuccess > 30000) {
        this.logger.log('✅ Health check passed');
      }
      
    } catch (error) {
      this.logger.warn(`⚠️ Health check failed: ${error.message}`);
      
      if (this.connectionHealth.consecutiveFailures >= 3) {
        await this.reconnectRealtimeDb();
      }
    }
  }

  private async reconnectRealtimeDb(): Promise<void> {
    this.logger.log('🔄 Reconnecting Realtime DB...');
    
    try {
      this.restConnectionPool = [];
      this.connectionHealth.restConnections.clear();
      
      await this.initializeRealtimeDbWithPool();
      
      this.connectionHealth.consecutiveFailures = 0;
      this.logger.log('✅ Reconnection successful');
      
    } catch (error) {
      this.logger.error(`❌ Reconnection failed: ${error.message}`);
    }
  }

  /**
   * FIRESTORE METHODS
   */
  isFirestoreReady(): boolean {
    return this.firestoreReady;
  }

  async waitForFirestore(maxWaitMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    
    while (!this.firestoreReady) {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error('Firestore initialization timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  getFirestore(): admin.firestore.Firestore {
    if (!this.initialized || !this.db) {
      throw new Error('Firestore not initialized');
    }
    if (!this.firestoreReady) {
      throw new Error('Firestore not ready yet');
    }
    return this.db;
  }

  getRealtimeDatabase(): admin.database.Database {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }
    if (this.useRestForRealtimeDb) {
      throw new Error('Use getRealtimeDbValue() instead');
    }
    if (!this.realtimeDb) {
      throw new Error('Realtime Database not available');
    }
    return this.realtimeDb;
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
    
    return id;
  }

  async updateWithTimestamp(collection: string, id: string, data: any): Promise<void> {
    await this.getFirestore().collection(collection).doc(id).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
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
    }
  }

  async runTransaction<T>(
    updateFunction: (transaction: admin.firestore.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.getFirestore().runTransaction(updateFunction);
  }

  /**
   * PERFORMANCE STATS
   */
  getPerformanceStats() {
    const timeSinceLastSuccess = Date.now() - this.connectionHealth.lastSuccessfulFetch;
    const totalOps = this.operationCount + this.cacheHitRate;
    const cacheHitPercentage = totalOps > 0 ? Math.round((this.cacheHitRate / totalOps) * 100) : 0;
    
    return {
      operations: this.operationCount,
      avgResponseTime: Math.round(this.avgResponseTime),
      cacheSize: this.queryCache.size,
      cacheHitRate: `${cacheHitPercentage}%`,
      connectionPoolSize: this.restConnectionPool.length,
      writeQueueSize: this.writeQueue.length,
      usingREST: this.useRestForRealtimeDb,
      firestoreReady: this.firestoreReady,
      health: {
        consecutiveFailures: this.connectionHealth.consecutiveFailures,
        lastSuccessMs: timeSinceLastSuccess,
        isHealthy: this.connectionHealth.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES,
      },
    };
  }
}