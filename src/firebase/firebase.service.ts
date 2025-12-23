import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as dns from 'dns';
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
  private realtimeDb: admin.database.Database | null = null;
  private realtimeDbRest: AxiosInstance | null = null;
  
  private initialized = false;
  private firestoreReady = false;
  private useRestForRealtimeDb = false;
  
  private restConnectionPool: AxiosInstance[] = [];
  private readonly POOL_SIZE = 5;
  private currentPoolIndex = 0;
  
  private operationCount = 0;
  private avgResponseTime = 0;
  
  private queryCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000;

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

      this.logger.log('⚡ Initializing Firebase...');

      // ✅ Initialize Admin SDK dengan DATABASE URL
      const realtimeDbUrl = this.configService.get('firebase.realtimeDbUrl');
      
      if (!admin.apps.length) {
        const appConfig: any = {
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        };
        
        // ✅ CRITICAL: Tambahkan databaseURL saat init
        if (realtimeDbUrl) {
          appConfig.databaseURL = realtimeDbUrl;
          this.logger.log(`🔥 Realtime DB URL: ${realtimeDbUrl}`);
        }
        
        admin.initializeApp(appConfig);
      }

      // Initialize Firestore
      this.db = admin.firestore();
      this.db.settings({
        ignoreUndefinedProperties: true,
        timestampsInSnapshots: true,
        maxIdleChannels: 10,
      });

      try {
        await this.db.collection('_health_check').limit(1).get();
        this.firestoreReady = true;
        this.logger.log('✅ Firestore initialized');
      } catch (error) {
        this.logger.error(`❌ Firestore test failed: ${error.message}`);
        this.firestoreReady = true;
      }

      // ✅ Initialize Realtime DB - FIXED VERSION
      await this.initializeRealtimeDbFixed();
      
      this.initialized = true;
      
      this.logger.log('✅ Firebase initialized successfully!');
      
      setInterval(() => this.cleanupCache(), 30000);
      
    } catch (error) {
      this.logger.error(`❌ Firebase initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ FIXED: Realtime DB Initialization
   */
  private async initializeRealtimeDbFixed() {
    const realtimeDbUrl = this.configService.get('firebase.realtimeDbUrl');
    
    if (!realtimeDbUrl) {
      this.logger.warn('⚠️ Realtime DB URL not configured');
      return;
    }

    this.logger.log('🔥 Initializing Realtime DB...');

    // ✅ METHOD 1: Try Admin SDK first (recommended)
    try {
      this.logger.log('📡 Attempting Admin SDK...');
      this.realtimeDb = admin.database();
      
      // Test connection
      const testRef = this.realtimeDb.ref('/.info/connected');
      await testRef.once('value');
      
      this.useRestForRealtimeDb = false;
      this.logger.log('✅ Realtime DB (Admin SDK) ready');
      return; // Success!
      
    } catch (sdkError) {
      this.logger.warn(`⚠️ Admin SDK failed: ${sdkError.message}`);
      this.logger.log('📡 Falling back to REST API...');
      this.realtimeDb = null;
    }

    // ✅ METHOD 2: REST API as fallback
    try {
      const baseURL = realtimeDbUrl.replace(/\/$/, '');
      
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
        });
        
        this.restConnectionPool.push(instance);
      }
      
      // Test REST connection
      await this.restConnectionPool[0].get('/.json?shallow=true');
      
      this.useRestForRealtimeDb = true;
      this.realtimeDbRest = this.restConnectionPool[0];
      
      this.logger.log(`✅ Realtime DB (REST API) ready with ${this.POOL_SIZE} connections`);
      
    } catch (restError) {
      this.logger.error(`❌ Both methods failed!`);
      this.logger.error(`SDK Error: Admin SDK initialization issue`);
      this.logger.error(`REST Error: ${restError.message}`);
      this.logger.warn('⚠️ Price fetching will not work!');
    }
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

  private getNextConnection(): AxiosInstance {
    if (this.restConnectionPool.length === 0) {
      throw new Error('No REST connections available');
    }
    
    const conn = this.restConnectionPool[this.currentPoolIndex];
    this.currentPoolIndex = (this.currentPoolIndex + 1) % this.POOL_SIZE;
    
    return conn;
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

  /**
   * ✅ FIXED: Get Realtime DB Value
   */
  async getRealtimeDbValue(path: string, useCache = true): Promise<any> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const startTime = Date.now();

    // Try cache
    if (useCache) {
      const cached = this.getCachedQuery(path);
      if (cached !== null) {
        this.logger.debug(`⚡ Cache hit for ${path}`);
        return cached;
      }
    }

    try {
      let data: any;

      // ✅ METHOD 1: Admin SDK
      if (!this.useRestForRealtimeDb && this.realtimeDb) {
        try {
          this.logger.debug(`📡 Fetching via SDK: ${path}`);
          const snapshot = await this.realtimeDb.ref(path).once('value');
          data = snapshot.val();
        } catch (sdkError) {
          this.logger.warn(`SDK fetch failed: ${sdkError.message}`);
          throw sdkError;
        }
      }
      // ✅ METHOD 2: REST API
      else if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
        this.logger.debug(`📡 Fetching via REST: ${path}`);
        const conn = this.getNextConnection();
        const response = await conn.get(`${path}.json`);
        data = response.data;
      }
      // ❌ No method available
      else {
        throw new Error('Realtime Database not available');
      }

      // Cache result
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

      this.queryCache.delete(path);

      const duration = Date.now() - startTime;
      this.logger.debug(`⚡ Set ${path} in ${duration}ms`);

    } catch (error) {
      this.logger.error(`Set error: ${error.message}`);
      throw error;
    }
  }

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

          default:
            throw new Error(`Unknown operation: ${(operation as any).type}`);
        }
      }

      await batch.commit();
    }

    this.logger.debug(`⚡ Batch completed: ${operations.length} operations`);
  }

  async runTransaction<T>(
    updateFunction: (transaction: admin.firestore.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.getFirestore().runTransaction(updateFunction);
  }

  getPerformanceStats() {
    return {
      operations: this.operationCount,
      avgResponseTime: Math.round(this.avgResponseTime),
      cacheSize: this.queryCache.size,
      connectionPoolSize: this.restConnectionPool.length,
      usingREST: this.useRestForRealtimeDb,
      firestoreReady: this.firestoreReady,
      realtimeDbAvailable: !!(this.realtimeDb || this.restConnectionPool.length > 0),
    };
  }
}
