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
  private app: admin.app.App;
  private realtimeDbRest: AxiosInstance | null = null;
  
  private initialized = false;
  private firestoreReady = false;
  
  private restConnectionPool: AxiosInstance[] = [];
  private readonly POOL_SIZE = 5;
  private currentPoolIndex = 0;
  
  // ✅ Store auth token
  private authToken: string | null = null;
  private tokenExpiresAt: number = 0;
  
  private queryCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000;
  private readonly STALE_CACHE_TTL = 30000;
  
  private connectionHealth = {
    restConnections: new Map<number, { lastSuccess: number; failures: number }>(),
    lastSuccessfulFetch: Date.now(),
    consecutiveFailures: 0,
  };
  
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 300;
  private readonly MAX_CONSECUTIVE_FAILURES = 10;
  
  private operationCount = 0;
  private avgResponseTime = 0;
  private cacheHitRate = 0;
  
  private writeQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  
  private readCount = 0;
  private writeCount = 0;
  private lastStatsReset = Date.now();

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

      this.logger.log('⚡ Initializing Firebase with Auth...');

      // ✅ Init Firebase Admin SDK
      if (!admin.apps.length) {
        this.app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
          databaseURL: this.configService.get('firebase.realtimeDbUrl'),
        });
      } else {
        this.app = admin.apps[0]!;
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
        this.firestoreReady = true;
        this.logger.log('✅ Firestore ready');
      } catch (error) {
        this.logger.warn(`⚠️ Firestore test failed: ${error.message}`);
        this.firestoreReady = true;
      }

      // ✅ Get auth token first
      await this.refreshAuthToken();

      // ✅ Init Realtime DB with auth
      await this.initializeRealtimeDbWithAuth();
      
      this.initialized = true;
      this.logger.log('✅ Firebase ready (Authenticated REST API)');
      
      this.startBackgroundTasks();
      
    } catch (error) {
      this.logger.error(`❌ Firebase initialization failed: ${error.message}`);
      throw error;
    }
  }

  // ✅ Get Firebase Auth Token
  private async refreshAuthToken(): Promise<void> {
    try {
      this.logger.log('🔑 Getting Firebase Auth token...');
      
      // Get access token from Firebase Admin SDK
      const accessToken = await this.app.options.credential!.getAccessToken();
      
      this.authToken = accessToken.access_token;
      this.tokenExpiresAt = Date.now() + (accessToken.expires_in * 1000) - 60000; // Refresh 1 minute before expiry
      
      this.logger.log('✅ Auth token obtained');
      this.logger.log(`   Expires in: ${Math.round(accessToken.expires_in / 60)} minutes`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to get auth token: ${error.message}`);
      throw error;
    }
  }

  // ✅ Check and refresh token if needed
  private async ensureValidToken(): Promise<void> {
    if (!this.authToken || Date.now() >= this.tokenExpiresAt) {
      this.logger.log('🔄 Token expired, refreshing...');
      await this.refreshAuthToken();
    }
  }

  // ✅ Initialize with Authentication
  private async initializeRealtimeDbWithAuth() {
    const realtimeDbUrl = this.configService.get('firebase.realtimeDbUrl');
    
    if (!realtimeDbUrl) {
      this.logger.error('❌ FIREBASE_REALTIME_DB_URL not configured in .env');
      throw new Error('Realtime DB URL not configured');
    }

    this.logger.log('⚡ Creating authenticated REST connection pool...');
    
    const baseURL = realtimeDbUrl.replace(/\/$/, '');
    
    const httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 20,
      maxFreeSockets: 10,
      timeout: 10000,
    });
    
    const httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 20,
      maxFreeSockets: 10,
      timeout: 10000,
    });
    
    // ✅ Create connection pool with auth interceptor
    for (let i = 0; i < this.POOL_SIZE; i++) {
      const instance = axios.create({
        baseURL,
        timeout: 5000,
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
      
      // ✅ Add auth interceptor
      instance.interceptors.request.use(async (config) => {
        await this.ensureValidToken();
        
        // Add auth token as query parameter
        config.params = {
          ...config.params,
          auth: this.authToken,
        };
        
        return config;
      });
      
      this.restConnectionPool.push(instance);
      this.connectionHealth.restConnections.set(i, {
        lastSuccess: Date.now(),
        failures: 0
      });
    }
    
    // ✅ Test connection with auth
    try {
      await this.restConnectionPool[0].get('/.json', {
        params: { shallow: 'true' }
      });
      
      this.realtimeDbRest = this.restConnectionPool[0];
      
      this.logger.log(`✅ Authenticated REST connection pool created`);
      this.logger.log(`   Connections: ${this.POOL_SIZE}`);
      this.logger.log(`   Base URL: ${baseURL}`);
      this.logger.log(`   Auth: OAuth 2.0 Access Token`);
      
    } catch (error) {
      this.logger.error(`❌ Authenticated connection failed: ${error.message}`);
      
      if (error.response?.status === 401) {
        this.logger.error(`   Error: Unauthorized (401)`);
        this.logger.error(`   Check: Firebase service account credentials`);
      }
      
      throw new Error('Failed to connect with authentication');
    }
  }

  private getNextConnection(): AxiosInstance {
    if (this.restConnectionPool.length === 0) {
      throw new Error('No REST connections available');
    }
    
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

  async getRealtimeDbValue(path: string, useCache = true): Promise<any> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const startTime = Date.now();

    if (useCache) {
      const cached = this.getCachedQuery(path);
      if (cached !== null) {
        this.cacheHitRate++;
        return cached;
      }
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const data = await this.fetchFromRestAPI(path);
        
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
        
        // ✅ Check if it's auth error
        if (error.response?.status === 401) {
          this.logger.warn('⚠️ Auth token expired, refreshing...');
          await this.refreshAuthToken();
          continue; // Retry with new token
        }
        
        const connIndex = this.currentPoolIndex;
        const health = this.connectionHealth.restConnections.get(connIndex);
        if (health) {
          health.failures++;
        }
        
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAY_MS * Math.pow(1.5, attempt);
          this.logger.debug(`⚠️ Retry ${attempt + 1}/${this.MAX_RETRIES} for ${path} after ${delay}ms`);
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
    
    throw lastError || new Error('Failed to fetch');
  }

  private async fetchFromRestAPI(path: string): Promise<any> {
    const conn = this.getNextConnection();
    
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const fullPath = cleanPath.endsWith('.json') ? cleanPath : `${cleanPath}.json`;
    
    this.logger.debug(`🔍 Fetching: ${fullPath}`);
    
    // Auth token will be added automatically by interceptor
    const response = await conn.get(fullPath);
    
    const connIndex = this.restConnectionPool.indexOf(conn);
    if (connIndex >= 0) {
      const health = this.connectionHealth.restConnections.get(connIndex);
      if (health) {
        health.lastSuccess = Date.now();
        health.failures = Math.max(0, health.failures - 1);
      }
    }
    
    return response.data;
  }

  async setRealtimeDbValue(path: string, data: any, critical = false): Promise<void> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const writeOperation = async () => {
      for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
        try {
          const conn = this.getNextConnection();
          const cleanPath = path.startsWith('/') ? path : `/${path}`;
          const fullPath = cleanPath.endsWith('.json') ? cleanPath : `${cleanPath}.json`;
          
          // Auth token will be added automatically by interceptor
          await conn.put(fullPath, data);

          this.writeCount++;
          this.queryCache.delete(path);
          return;

        } catch (error) {
          // ✅ Check if it's auth error
          if (error.response?.status === 401) {
            this.logger.warn('⚠️ Auth token expired during write, refreshing...');
            await this.refreshAuthToken();
            continue; // Retry with new token
          }
          
          if (attempt < this.MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS));
          } else {
            this.logger.error(`❌ Write failed for ${path}: ${error.message}`);
            throw error;
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

  private async processWriteQueue() {
    if (this.isProcessingQueue || this.writeQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    
    while (this.writeQueue.length > 0) {
      const batch = this.writeQueue.splice(0, 5);
      
      await Promise.allSettled(
        batch.map(write => write())
      );
    }
    
    this.isProcessingQueue = false;
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
    
    if (this.queryCache.size > 500) {
      const oldestKeys = Array.from(this.queryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 100)
        .map(([key]) => key);
      
      oldestKeys.forEach(key => this.queryCache.delete(key));
    }
  }

  private startBackgroundTasks() {
    setInterval(() => this.cleanupCache(), 60000);
    setInterval(() => this.healthCheckConnections(), 30000);
    setInterval(() => this.processWriteQueue(), 200);
    setInterval(() => this.resetDailyStats(), 86400000);
    
    // ✅ Refresh token periodically (every 50 minutes)
    setInterval(() => {
      this.refreshAuthToken().catch(err => {
        this.logger.error(`Token refresh failed: ${err.message}`);
      });
    }, 50 * 60 * 1000);
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
      this.logger.debug(`🗑️ Cleaned ${cleaned} cache entries`);
    }
  }

  private async healthCheckConnections(): Promise<void> {
    if (this.restConnectionPool.length === 0) return;

    try {
      const conn = this.restConnectionPool[0];
      await conn.get('/.json', {
        params: { shallow: 'true', timeout: '2000' }
      });
      
      this.logger.debug('✅ Health check passed');
      
    } catch (error) {
      this.logger.warn(`⚠️ Health check failed: ${error.message}`);
      
      if (error.response?.status === 401) {
        this.logger.warn('⚠️ Auth issue detected, refreshing token...');
        await this.refreshAuthToken();
      }
    }
  }

  private resetDailyStats(): void {
    const hoursSinceReset = (Date.now() - this.lastStatsReset) / 3600000;
    
    this.logger.log('📊 Daily Stats:');
    this.logger.log(`   • Reads: ${this.readCount} (${Math.round(this.readCount / hoursSinceReset)}/hour)`);
    this.logger.log(`   • Writes: ${this.writeCount} (${Math.round(this.writeCount / hoursSinceReset)}/hour)`);
    
    this.readCount = 0;
    this.writeCount = 0;
    this.lastStatsReset = Date.now();
  }

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
    
    this.readCount++;
    return this.db;
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
    
    this.writeCount++;
    return id;
  }

  async updateWithTimestamp(collection: string, id: string, data: any): Promise<void> {
    await this.getFirestore().collection(collection).doc(id).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
    
    this.writeCount++;
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
      this.writeCount += chunk.length;
    }
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
    const hoursSinceReset = (Date.now() - this.lastStatsReset) / 3600000;
    
    const tokenExpiresIn = this.tokenExpiresAt > 0 
      ? Math.max(0, Math.round((this.tokenExpiresAt - Date.now()) / 60000))
      : 0;
    
    return {
      operations: this.operationCount,
      avgResponseTime: Math.round(this.avgResponseTime),
      cacheSize: this.queryCache.size,
      cacheHitRate: `${cacheHitPercentage}%`,
      connectionPoolSize: this.restConnectionPool.length,
      writeQueueSize: this.writeQueue.length,
      method: 'Authenticated REST API',
      authStatus: {
        hasToken: !!this.authToken,
        expiresInMinutes: tokenExpiresIn,
      },
      firestoreReady: this.firestoreReady,
      dailyStats: {
        reads: this.readCount,
        writes: this.writeCount,
        estimatedDailyReads: Math.round(this.readCount / hoursSinceReset * 24),
        estimatedDailyWrites: Math.round(this.writeCount / hoursSinceReset * 24),
      },
      health: {
        consecutiveFailures: this.connectionHealth.consecutiveFailures,
        lastSuccessMs: timeSinceLastSuccess,
        isHealthy: this.connectionHealth.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES,
      },
    };
  }
}
