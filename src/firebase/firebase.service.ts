// src/firebase/firebase.service.ts

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

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
  private realtimeDb: admin.database.Database;
  
  private initialized = false;
  private firestoreReady = false;
  
  // Cache management
  private queryCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds
  private readonly STALE_CACHE_TTL = 120000; // 2 minutes
  
  // Statistics
  private readCount = 0;
  private writeCount = 0;
  private cacheHitRate = 0;
  private lastStatsReset = Date.now();
  
  // Write queue for async operations
  private writeQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      const serviceAccount = {
        projectId: this.configService.get('firebase.projectId'),
        privateKey: this.configService.get('firebase.privateKey'),
        clientEmail: this.configService.get('firebase.clientEmail'),
      };

      if (!serviceAccount.projectId || !serviceAccount.privateKey || !serviceAccount.clientEmail) {
        throw new Error('Firebase credentials missing in configuration');
      }

      this.logger.log('⚡ Initializing Firebase Admin SDK...');

      // Initialize Firebase Admin (only once)
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
          databaseURL: this.configService.get('firebase.realtimeDbUrl'),
        });
      }

      // Initialize Firestore
      this.db = admin.firestore();
      this.db.settings({
        ignoreUndefinedProperties: true,
        timestampsInSnapshots: true,
      });

      // Test Firestore connection
      try {
        await Promise.race([
          this.db.collection('_health_check').limit(1).get(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);
        this.firestoreReady = true;
        this.logger.log('✅ Firestore ready');
      } catch (error) {
        this.logger.warn(`⚠️ Firestore test failed: ${error.message}`);
        this.firestoreReady = true; // Continue anyway
      }

      // ✅ Initialize Realtime Database (Admin SDK - like test-firebase.ts)
      this.realtimeDb = admin.database();
      
      // Test Realtime DB connection
      try {
        await this.realtimeDb.ref('/.info/connected').once('value');
        this.logger.log('✅ Realtime Database ready (Admin SDK)');
      } catch (error) {
        this.logger.warn(`⚠️ Realtime DB test warning: ${error.message}`);
        // Continue anyway - will retry on actual usage
      }
      
      this.initialized = true;
      this.logger.log('✅ Firebase initialized successfully!');
      
      // Start background tasks
      this.startBackgroundTasks();
      
    } catch (error) {
      this.logger.error(`❌ Firebase initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ SIMPLIFIED: Get Realtime DB value using Admin SDK directly
   */
  async getRealtimeDbValue(path: string, useCache = true): Promise<any> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const startTime = Date.now();

    // Check cache first
    if (useCache) {
      const cached = this.getCachedQuery(path);
      if (cached !== null) {
        this.cacheHitRate++;
        this.logger.debug(`⚡ Cache hit: ${path}`);
        return cached;
      }
    }

    try {
      // ✅ Use Admin SDK directly (like test-firebase.ts)
      const snapshot = await Promise.race([
        this.realtimeDb.ref(path).once('value'),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 3000)
        )
      ]);

      const data = snapshot.val();
      
      // Cache the result
      if (useCache && data !== null) {
        this.cacheQuery(path, data);
      }

      const duration = Date.now() - startTime;
      this.readCount++;

      this.logger.debug(`✅ Read ${path} in ${duration}ms`);
      
      return data;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Try to use stale cache
      const staleCache = this.getStaleCache(path);
      if (staleCache !== null) {
        this.logger.warn(`⚠️ Using stale cache for ${path}`);
        return staleCache;
      }
      
      this.logger.error(`❌ Read failed after ${duration}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ SIMPLIFIED: Set Realtime DB value using Admin SDK directly
   */
  async setRealtimeDbValue(path: string, data: any, critical = false): Promise<void> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const writeOperation = async () => {
      try {
        // ✅ Use Admin SDK directly (like test-firebase.ts)
        await this.realtimeDb.ref(path).set(data);
        
        this.writeCount++;
        
        // Clear cache for this path
        this.queryCache.delete(path);
        
        this.logger.debug(`✅ Write to ${path} successful`);
        
      } catch (error) {
        this.logger.error(`❌ Write to ${path} failed: ${error.message}`);
        throw error;
      }
    };

    // Execute immediately if critical, otherwise queue
    if (critical) {
      await writeOperation();
    } else {
      this.writeQueue.push(writeOperation);
      this.processWriteQueue();
    }
  }

  /**
   * Process write queue in background
   */
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

  /**
   * Cache management
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
    
    // Cleanup if cache too large
    if (this.queryCache.size > 300) {
      const oldestKeys = Array.from(this.queryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 50)
        .map(([key]) => key);
      
      oldestKeys.forEach(key => this.queryCache.delete(key));
    }
  }

  /**
   * Background tasks
   */
  private startBackgroundTasks() {
    // Cleanup cache every minute
    setInterval(() => this.cleanupCache(), 60000);
    
    // Process write queue every 200ms
    setInterval(() => this.processWriteQueue(), 200);
    
    // Reset daily stats
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

  private resetDailyStats(): void {
    const hoursSinceReset = (Date.now() - this.lastStatsReset) / 3600000;
    
    this.logger.log('📊 Daily Stats:');
    this.logger.log(`   • Reads: ${this.readCount} (${Math.round(this.readCount / hoursSinceReset)}/hour)`);
    this.logger.log(`   • Writes: ${this.writeCount} (${Math.round(this.writeCount / hoursSinceReset)}/hour)`);
    
    this.readCount = 0;
    this.writeCount = 0;
    this.lastStatsReset = Date.now();
  }

  /**
   * Firestore methods (unchanged)
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
    
    this.readCount++;
    return this.db;
  }

  /**
   * ✅ FIXED: Return Admin SDK instance directly (no error)
   */
  getRealtimeDatabase(): admin.database.Database {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }
    if (!this.realtimeDb) {
      throw new Error('Realtime Database not initialized');
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

  /**
   * Performance stats
   */
  getPerformanceStats() {
    const hoursSinceReset = (Date.now() - this.lastStatsReset) / 3600000;
    
    return {
      initialized: this.initialized,
      firestoreReady: this.firestoreReady,
      realtimeDbReady: !!this.realtimeDb,
      cacheSize: this.queryCache.size,
      writeQueueSize: this.writeQueue.length,
      dailyStats: {
        reads: this.readCount,
        writes: this.writeCount,
        estimatedDailyReads: Math.round(this.readCount / hoursSinceReset * 24),
        estimatedDailyWrites: Math.round(this.writeCount / hoursSinceReset * 24),
        readsRemaining: 50000 - Math.round(this.readCount / hoursSinceReset * 24),
        writesRemaining: 20000 - Math.round(this.writeCount / hoursSinceReset * 24),
      },
    };
  }
}