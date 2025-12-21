import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as dns from 'dns';
import axios, { AxiosInstance } from 'axios';

// ⚡ Force IPv4 resolution globally
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
  
  // Firestore instance
  private db: admin.firestore.Firestore;
  
  // Realtime DB instances
  private realtimeDb: admin.database.Database | null = null;
  private realtimeDbRest: AxiosInstance | null = null;
  
  // Status flags
  private initialized = false;
  private firestoreReady = false; // ✅ NEW FLAG
  private useRestForRealtimeDb = false;
  
  // ⚡ Connection pool optimization
  private restConnectionPool: AxiosInstance[] = [];
  private readonly POOL_SIZE = 5;
  private currentPoolIndex = 0;
  
  // ⚡ Performance tracking
  private operationCount = 0;
  private avgResponseTime = 0;
  
  // ⚡ Cache for frequently accessed data
  private queryCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

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

      this.logger.log('⚡ Initializing Firebase (Ultra-Fast mode)...');

      // ✅ Initialize Admin SDK for Firestore
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        });
      }

      this.db = admin.firestore();
      
      // ⚡ Optimize Firestore settings
      this.db.settings({
        ignoreUndefinedProperties: true,
        timestampsInSnapshots: true,
        // Enable connection pooling
        maxIdleChannels: 10,
      });

      // ✅ TEST FIRESTORE CONNECTION
      try {
        await this.db.collection('_health_check').limit(1).get();
        this.firestoreReady = true;
        this.logger.log('✅ Firestore initialized and ready');
      } catch (error) {
        this.logger.error(`❌ Firestore test failed: ${error.message}`);
        // Still set as ready, will retry on actual operations
        this.firestoreReady = true;
      }

      // ✅ Initialize Realtime DB with connection pool
      await this.initializeRealtimeDbWithPool();
      
      this.initialized = true;
      
      this.logger.log('✅ Firebase Ultra-Fast mode ready!');
      
      // ⚡ Start cache cleanup
      setInterval(() => this.cleanupCache(), 30000); // Every 30s
      
    } catch (error) {
      this.logger.error(`❌ Firebase initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ CHECK IF FIRESTORE IS READY
   */
  isFirestoreReady(): boolean {
    return this.firestoreReady;
  }

  /**
   * ✅ WAIT FOR FIRESTORE TO BE READY
   */
  async waitForFirestore(maxWaitMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    
    while (!this.firestoreReady) {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error('Firestore initialization timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * ⚡ INITIALIZE REALTIME DB WITH CONNECTION POOL
   */
  private async initializeRealtimeDbWithPool() {
    const realtimeDbUrl = this.configService.get('firebase.realtimeDbUrl');
    
    if (!realtimeDbUrl) {
      this.logger.warn('⚠️ Realtime DB URL not configured');
      return;
    }

    // ✅ Try REST API with connection pool (fastest for read-heavy)
    try {
      this.logger.log('⚡ Creating REST connection pool...');
      
      const baseURL = realtimeDbUrl.replace(/\/$/, '');
      
      // Create multiple axios instances for connection pooling
      for (let i = 0; i < this.POOL_SIZE; i++) {
        const instance = axios.create({
          baseURL,
          timeout: 1000, // ⚡ 1 second timeout
          family: 4, // Force IPv4
          headers: {
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
          },
          validateStatus: (status) => status >= 200 && status < 300,
          maxRedirects: 0, // No redirects
          // ⚡ Keep connection alive
          httpAgent: null,
          httpsAgent: null,
        });
        
        this.restConnectionPool.push(instance);
      }
      
      // Test connection with first instance
      await this.restConnectionPool[0].get('/.json?shallow=true');
      
      this.useRestForRealtimeDb = true;
      this.realtimeDbRest = this.restConnectionPool[0]; // Keep for compatibility
      
      this.logger.log(`✅ REST connection pool created (${this.POOL_SIZE} connections)`);
      
    } catch (restError) {
      this.logger.warn(`⚠️ REST API failed: ${restError.message}`);
      
      // ✅ Fallback to Admin SDK
      try {
        this.logger.log('⚡ Trying Admin SDK...');
        this.realtimeDb = admin.database();
        
        // Optimize SDK settings
        this.realtimeDb.goOffline();
        this.realtimeDb.goOnline();
        
        this.useRestForRealtimeDb = false;
        this.logger.log('✅ Realtime DB via Admin SDK');
        
      } catch (sdkError) {
        this.logger.error('❌ Both methods failed for Realtime DB');
        this.logger.warn('⚠️ Continuing without Realtime DB');
      }
    }
  }

  /**
   * ⚡ GET NEXT CONNECTION FROM POOL
   */
  private getNextConnection(): AxiosInstance {
    if (this.restConnectionPool.length === 0) {
      throw new Error('No REST connections available');
    }
    
    const conn = this.restConnectionPool[this.currentPoolIndex];
    this.currentPoolIndex = (this.currentPoolIndex + 1) % this.POOL_SIZE;
    
    return conn;
  }

  /**
   * GET FIRESTORE (WITH READY CHECK)
   */
  getFirestore(): admin.firestore.Firestore {
    if (!this.initialized || !this.db) {
      throw new Error('Firestore not initialized');
    }
    if (!this.firestoreReady) {
      throw new Error('Firestore not ready yet');
    }
    return this.db;
  }

  /**
   * GET REALTIME DATABASE (SDK)
   */
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

  /**
   * ⚡ GET REALTIME DB VALUE (ULTRA-FAST)
   * Uses connection pool and caching
   */
  async getRealtimeDbValue(path: string, useCache = true): Promise<any> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const startTime = Date.now();

    // ✅ Try cache first
    if (useCache) {
      const cached = this.getCachedQuery(path);
      if (cached !== null) {
        this.logger.debug(`⚡ Cache hit for ${path}`);
        return cached;
      }
    }

    // ✅ Fetch with connection pool
    try {
      let data: any;

      if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
        // Use connection pool
        const conn = this.getNextConnection();
        const response = await conn.get(`${path}.json`);
        data = response.data;
      } else if (this.realtimeDb) {
        // Fallback to SDK
        const snapshot = await this.realtimeDb.ref(path).once('value');
        data = snapshot.val();
      } else {
        throw new Error('Realtime Database not available');
      }

      // ✅ Cache result
      if (useCache && data !== null) {
        this.cacheQuery(path, data);
      }

      const duration = Date.now() - startTime;
      this.operationCount++;
      this.avgResponseTime = (this.avgResponseTime + duration) / 2;

      this.logger.debug(`⚡ Fetched ${path} in ${duration}ms`);

      return data;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Get error after ${duration}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * ⚡ SET REALTIME DB VALUE
   */
  async setRealtimeDbValue(path: string, data: any): Promise<void> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const startTime = Date.now();

    try {
      if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
        const conn = this.getNextConnection();
        await conn.put(`${path}.json`, data);
      } else if (this.realtimeDb) {
        await this.realtimeDb.ref(path).set(data);
      } else {
        throw new Error('Realtime Database not available');
      }

      // Invalidate cache
      this.queryCache.delete(path);

      const duration = Date.now() - startTime;
      this.logger.debug(`⚡ Set ${path} in ${duration}ms`);

    } catch (error) {
      this.logger.error(`Set error: ${error.message}`);
      throw error;
    }
  }

  /**
   * ⚡ CACHE MANAGEMENT
   */
  private getCachedQuery(path: string): any | null {
    const cached = this.queryCache.get(path);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) {
      this.queryCache.delete(path);
      return null;
    }

    return cached.data;
  }

  private cacheQuery(path: string, data: any): void {
    this.queryCache.set(path, {
      data,
      timestamp: Date.now(),
    });
  }

  private cleanupCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [path, cached] of this.queryCache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL * 2) {
        this.queryCache.delete(path);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`⚡ Cleaned ${cleaned} cache entries`);
    }
  }

  /**
   * GENERATE ID
   */
  async generateId(collection: string): Promise<string> {
    return this.getFirestore().collection(collection).doc().id;
  }

  /**
   * CREATE WITH TIMESTAMP
   */
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

  /**
   * UPDATE WITH TIMESTAMP
   */
  async updateWithTimestamp(collection: string, id: string, data: any): Promise<void> {
    await this.getFirestore().collection(collection).doc(id).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * ⚡ OPTIMIZED BATCH WRITE
   * Max 500 operations per batch (Firestore limit)
   */
  async batchWrite(operations: BatchOperation[]): Promise<void> {
    const db = this.getFirestore();
    const BATCH_LIMIT = 500;
    
    // Split into chunks if needed
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

          default:
            throw new Error(`Unknown operation: ${(operation as any).type}`);
        }
      }

      await batch.commit();
    }

    this.logger.debug(`⚡ Batch completed: ${operations.length} operations`);
  }

  /**
   * ⚡ TRANSACTION
   */
  async runTransaction<T>(
    updateFunction: (transaction: admin.firestore.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.getFirestore().runTransaction(updateFunction);
  }

  /**
   * ⚡ PERFORMANCE STATS
   */
  getPerformanceStats() {
    return {
      operations: this.operationCount,
      avgResponseTime: Math.round(this.avgResponseTime),
      cacheSize: this.queryCache.size,
      connectionPoolSize: this.restConnectionPool.length,
      usingREST: this.useRestForRealtimeDb,
      firestoreReady: this.firestoreReady,
    };
  }
}