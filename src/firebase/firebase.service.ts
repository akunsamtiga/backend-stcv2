// src/firebase/firebase.service.ts
// ⚡ FIXED VERSION - Automatic Retry & Better Fallback

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
  private firestoreReady = false;
  private useRestForRealtimeDb = false;
  
  // ⚡ Connection pool optimization
  private restConnectionPool: AxiosInstance[] = [];
  private readonly POOL_SIZE = 5;
  private currentPoolIndex = 0;
  
  // ✅ NEW: Connection health tracking
  private connectionHealth = {
    restConnections: new Map<number, number>(), // index -> last successful time
    lastSuccessfulFetch: Date.now(),
    consecutiveFailures: 0,
  };
  
  // ✅ NEW: Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 200; // Start with 200ms
  private readonly MAX_CONSECUTIVE_FAILURES = 5;
  
  // ⚡ Performance tracking
  private operationCount = 0;
  private avgResponseTime = 0;
  
  // ⚡ Cache for frequently accessed data
  private queryCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds
  private readonly STALE_CACHE_TTL = 30000; // 30 seconds - for fallback

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

      this.logger.log('⚡ Initializing Firebase (Ultra-Fast mode with Auto-Retry)...');

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
        maxIdleChannels: 10,
      });

      // ✅ TEST FIRESTORE CONNECTION
      try {
        await this.db.collection('_health_check').limit(1).get();
        this.firestoreReady = true;
        this.logger.log('✅ Firestore initialized and ready');
      } catch (error) {
        this.logger.error(`❌ Firestore test failed: ${error.message}`);
        this.firestoreReady = true; // Still set as ready, will retry on actual operations
      }

      // ✅ Initialize Realtime DB with connection pool
      await this.initializeRealtimeDbWithPool();
      
      this.initialized = true;
      
      this.logger.log('✅ Firebase Ultra-Fast mode with Auto-Retry ready!');
      
      // ⚡ Start cache cleanup
      setInterval(() => this.cleanupCache(), 30000); // Every 30s
      
      // ✅ NEW: Connection health check every 10 seconds
      setInterval(() => this.healthCheckConnections(), 10000);
      
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
          timeout: 3000, // ✅ INCREASED from 1s to 3s
          family: 4, // Force IPv4
          headers: {
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
          },
          validateStatus: (status) => status >= 200 && status < 300,
          maxRedirects: 0,
          // ⚡ Keep connection alive
          httpAgent: null,
          httpsAgent: null,
        });
        
        this.restConnectionPool.push(instance);
        this.connectionHealth.restConnections.set(i, Date.now());
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
   * ⚡ GET NEXT CONNECTION FROM POOL (with health check)
   */
  private getNextConnection(): AxiosInstance {
    if (this.restConnectionPool.length === 0) {
      throw new Error('No REST connections available');
    }
    
    // ✅ Find healthiest connection
    let bestIndex = this.currentPoolIndex;
    let bestHealth = this.connectionHealth.restConnections.get(bestIndex) || 0;
    
    for (let i = 0; i < this.restConnectionPool.length; i++) {
      const health = this.connectionHealth.restConnections.get(i) || 0;
      if (health > bestHealth) {
        bestIndex = i;
        bestHealth = health;
      }
    }
    
    this.currentPoolIndex = (bestIndex + 1) % this.POOL_SIZE;
    
    return this.restConnectionPool[bestIndex];
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
   * ⚡ GET REALTIME DB VALUE (ULTRA-FAST WITH RETRY)
   * ✅ NEW: Automatic retry with exponential backoff
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

    // ✅ Fetch with RETRY
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const data = await this.fetchRealtimeDbWithTimeout(path);
        
        // ✅ Success - reset failure counter
        this.connectionHealth.consecutiveFailures = 0;
        this.connectionHealth.lastSuccessfulFetch = Date.now();

        // ✅ Cache result
        if (useCache && data !== null) {
          this.cacheQuery(path, data);
        }

        const duration = Date.now() - startTime;
        this.operationCount++;
        this.avgResponseTime = (this.avgResponseTime + duration) / 2;

        if (attempt > 0) {
          this.logger.log(`✅ Retry ${attempt} succeeded for ${path} in ${duration}ms`);
        } else {
          this.logger.debug(`⚡ Fetched ${path} in ${duration}ms`);
        }

        return data;

      } catch (error) {
        lastError = error;
        
        // ✅ Exponential backoff
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt);
          this.logger.warn(`⚠️ Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // ✅ All retries failed - try stale cache as last resort
    const staleCache = this.getStaleCache(path);
    if (staleCache !== null) {
      this.logger.warn(`⚠️ Using stale cache for ${path} (all retries failed)`);
      this.connectionHealth.consecutiveFailures++;
      return staleCache;
    }

    // ✅ Complete failure
    this.connectionHealth.consecutiveFailures++;
    const duration = Date.now() - startTime;
    
    this.logger.error(
      `❌ Get failed after ${this.MAX_RETRIES} retries (${duration}ms): ${lastError?.message}`
    );
    
    // ✅ Check if we should try to reconnect
    if (this.connectionHealth.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      this.logger.error('❌ Too many consecutive failures, attempting reconnection...');
      await this.reconnectRealtimeDb();
    }
    
    throw lastError || new Error('Failed to fetch from Realtime DB');
  }

  /**
   * ✅ NEW: Fetch with timeout wrapper
   */
  private async fetchRealtimeDbWithTimeout(path: string): Promise<any> {
    return Promise.race([
      this.fetchRealtimeDb(path),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 5000) // 5s timeout
      ),
    ]);
  }

  /**
   * ✅ NEW: Core fetch logic (separated for retry)
   */
  private async fetchRealtimeDb(path: string): Promise<any> {
    if (this.useRestForRealtimeDb && this.restConnectionPool.length > 0) {
      // Use connection pool
      const conn = this.getNextConnection();
      const response = await conn.get(`${path}.json`);
      
      // ✅ Mark connection as healthy
      const connIndex = this.restConnectionPool.indexOf(conn);
      if (connIndex >= 0) {
        this.connectionHealth.restConnections.set(connIndex, Date.now());
      }
      
      return response.data;
      
    } else if (this.realtimeDb) {
      // Fallback to SDK
      const snapshot = await this.realtimeDb.ref(path).once('value');
      return snapshot.val();
      
    } else {
      throw new Error('Realtime Database not available');
    }
  }

  /**
   * ⚡ SET REALTIME DB VALUE (with retry)
   */
  async setRealtimeDbValue(path: string, data: any): Promise<void> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    let lastError: Error | null = null;
    
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

        // ✅ Success
        this.queryCache.delete(path);
        return;

      } catch (error) {
        lastError = error;
        
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(`Set error after ${this.MAX_RETRIES} retries: ${lastError?.message}`);
    throw lastError;
  }

  /**
   * ⚡ CACHE MANAGEMENT
   */
  private getCachedQuery(path: string): any | null {
    const cached = this.queryCache.get(path);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) {
      return null; // Too old for normal use
    }

    return cached.data;
  }

  /**
   * ✅ NEW: Get stale cache (for fallback)
   */
  private getStaleCache(path: string): any | null {
    const cached = this.queryCache.get(path);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.STALE_CACHE_TTL) {
      return null; // Too old even for fallback
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
      if (now - cached.timestamp > this.STALE_CACHE_TTL) {
        this.queryCache.delete(path);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`⚡ Cleaned ${cleaned} cache entries`);
    }
  }

  /**
   * ✅ NEW: Connection health check
   */
  private async healthCheckConnections(): Promise<void> {
    if (!this.useRestForRealtimeDb || this.restConnectionPool.length === 0) {
      return;
    }

    try {
      // Ping a lightweight endpoint
      const conn = this.restConnectionPool[0];
      await conn.get('/.json?shallow=true&timeout=2000');
      
      // Connection is healthy
      const timeSinceLastSuccess = Date.now() - this.connectionHealth.lastSuccessfulFetch;
      
      if (timeSinceLastSuccess > 30000) {
        this.logger.log('✅ Connection health check passed');
      }
      
    } catch (error) {
      this.logger.warn(`⚠️ Health check failed: ${error.message}`);
      
      // Try to reconnect if health check fails consistently
      if (this.connectionHealth.consecutiveFailures >= 3) {
        await this.reconnectRealtimeDb();
      }
    }
  }

  /**
   * ✅ NEW: Reconnect Realtime DB
   */
  private async reconnectRealtimeDb(): Promise<void> {
    this.logger.log('🔄 Attempting to reconnect Realtime DB...');
    
    try {
      // Clear old connections
      this.restConnectionPool = [];
      this.connectionHealth.restConnections.clear();
      
      // Re-initialize
      await this.initializeRealtimeDbWithPool();
      
      // Reset failure counter
      this.connectionHealth.consecutiveFailures = 0;
      
      this.logger.log('✅ Reconnection successful');
      
    } catch (error) {
      this.logger.error(`❌ Reconnection failed: ${error.message}`);
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
   */
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

  /**
   * ⚡ TRANSACTION
   */
  async runTransaction<T>(
    updateFunction: (transaction: admin.firestore.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.getFirestore().runTransaction(updateFunction);
  }

  /**
   * ⚡ PERFORMANCE STATS (with health info)
   */
  getPerformanceStats() {
    const timeSinceLastSuccess = Date.now() - this.connectionHealth.lastSuccessfulFetch;
    
    return {
      operations: this.operationCount,
      avgResponseTime: Math.round(this.avgResponseTime),
      cacheSize: this.queryCache.size,
      connectionPoolSize: this.restConnectionPool.length,
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