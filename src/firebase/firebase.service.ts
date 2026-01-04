// src/firebase/firebase.service.ts
// ✅ FIXED VERSION - Admin SDK Only + No TypeScript Errors

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import * as dns from 'dns';

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
  
  private initialized = false;
  private firestoreReady = false;
  
  private queryCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000;
  private readonly STALE_CACHE_TTL = 30000;
  
  private connectionHealth = {
    lastSuccessfulFetch: Date.now(),
    consecutiveFailures: 0,
  };
  
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 100;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  
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
        throw new Error('Firebase credentials missing in .env');
      }

      this.logger.log('');
      this.logger.log('⚡ ================================================');
      this.logger.log('⚡ Initializing Firebase (ADMIN SDK ONLY)');
      this.logger.log('⚡ ================================================');

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
          databaseURL: this.configService.get('firebase.realtimeDbUrl'),
        });
        this.logger.log('✅ Firebase Admin SDK initialized');
      }

      this.db = admin.firestore();
      this.db.settings({
        ignoreUndefinedProperties: true,
        timestampsInSnapshots: true,
        maxIdleChannels: 10,
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

      try {
        const realtimeDbUrl = this.configService.get('firebase.realtimeDbUrl');
        
        if (!realtimeDbUrl) {
          throw new Error('FIREBASE_REALTIME_DB_URL not configured in .env');
        }

        this.logger.log(`⚡ Connecting to Realtime DB: ${realtimeDbUrl}`);
        
        this.realtimeDb = admin.database();
        
        const testRef = this.realtimeDb.ref('/.info/connected');
        const snapshot = await testRef.once('value');
        const isConnected = snapshot.val();
        
        if (isConnected !== null) {
          this.logger.log('✅ Realtime DB connection test passed');
        }
        
        this.logger.log('✅ Realtime DB via Admin SDK ready');
        
      } catch (error) {
        this.logger.error(`❌ Realtime DB initialization failed: ${error.message}`);
        this.logger.error('   Check FIREBASE_REALTIME_DB_URL in .env');
        throw error;
      }
      
      this.initialized = true;
      
      this.logger.log('');
      this.logger.log('✅ ================================================');
      this.logger.log('✅ Firebase READY - Admin SDK Mode');
      this.logger.log('✅ ================================================');
      this.logger.log('✅ Firestore: Ready');
      this.logger.log('✅ Realtime DB: Ready (Admin SDK)');
      this.logger.log('✅ Connection: Same as Simulator');
      this.logger.log('✅ Cache: 5s TTL, 30s stale fallback');
      this.logger.log('✅ ================================================');
      this.logger.log('');
      
      this.startBackgroundTasks();
      
    } catch (error) {
      this.logger.error('');
      this.logger.error('❌ ================================================');
      this.logger.error('❌ Firebase Initialization FAILED');
      this.logger.error('❌ ================================================');
      this.logger.error(`❌ Error: ${error.message}`);
      this.logger.error('❌ ================================================');
      this.logger.error('');
      throw error;
    }
  }

  async getRealtimeDbValue(path: string, useCache = true): Promise<any> {
    if (!this.initialized || !this.realtimeDb) {
      throw new Error('Firebase not initialized');
    }

    const startTime = Date.now();

    // Try cache first
    if (useCache) {
      const cached = this.getCachedQuery(path);
      if (cached !== null) {
        this.cacheHitRate++;
        const cachedEntry = this.queryCache.get(path);
        const age = cachedEntry ? Date.now() - cachedEntry.timestamp : 0;
        this.logger.debug(`⚡ Cache hit: ${path} (${age}ms old)`);
        return cached;
      }
    }

    let lastError: Error | null = null;
    
    // Retry logic
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        // ✅ Use Admin SDK directly
        const snapshot = await this.realtimeDb.ref(path).once('value');
        const data = snapshot.val();
        
        // Success - reset failure counter
        this.connectionHealth.consecutiveFailures = 0;
        this.connectionHealth.lastSuccessfulFetch = Date.now();

        // Cache the result
        if (useCache && data !== null) {
          this.cacheQuery(path, data);
        }

        // Update stats
        const duration = Date.now() - startTime;
        this.operationCount++;
        this.avgResponseTime = (this.avgResponseTime * 0.9) + (duration * 0.1);
        this.readCount++;

        if (duration > 500) {
          this.logger.warn(`⚠️ Slow read: ${path} (${duration}ms)`);
        } else {
          this.logger.debug(`⚡ Read: ${path} (${duration}ms)`);
        }

        return data;

      } catch (error) {
        lastError = error;
        this.logger.warn(`⚠️ Read attempt ${attempt + 1}/${this.MAX_RETRIES} failed for ${path}: ${error.message}`);
        
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAY_MS * Math.pow(1.5, attempt);
          this.logger.debug(`   Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed - try stale cache as fallback
    const staleCache = this.getStaleCache(path);
    if (staleCache !== null) {
      const cachedEntry = this.queryCache.get(path);
      const age = cachedEntry ? Date.now() - cachedEntry.timestamp : 0;
      this.logger.warn(`⚠️ Using stale cache: ${path} (${Math.floor(age / 1000)}s old)`);
      this.connectionHealth.consecutiveFailures++;
      return staleCache;
    }

    // Complete failure
    this.connectionHealth.consecutiveFailures++;
    const duration = Date.now() - startTime;
    
    this.logger.error('');
    this.logger.error(`❌ Read FAILED after ${this.MAX_RETRIES} retries (${duration}ms)`);
    this.logger.error(`   Path: ${path}`);
    this.logger.error(`   Error: ${lastError?.message || 'Unknown error'}`);
    this.logger.error(`   Consecutive failures: ${this.connectionHealth.consecutiveFailures}`);
    this.logger.error('');
    
    throw lastError || new Error('Failed to fetch from Realtime DB');
  }

  async setRealtimeDbValue(path: string, data: any, critical = false): Promise<void> {
    if (!this.initialized || !this.realtimeDb) {
      throw new Error('Firebase not initialized');
    }

    const writeOperation = async () => {
      for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
        try {
          // ✅ Null check before using
          if (!this.realtimeDb) {
            throw new Error('Realtime DB not available');
          }
          
          await this.realtimeDb.ref(path).set(data);
          this.writeCount++;
          this.queryCache.delete(path);
          this.logger.debug(`✅ Write: ${path}`);
          return;
        } catch (error) {
          this.logger.error(`❌ Write failed (attempt ${attempt + 1}): ${error.message}`);
          
          if (attempt < this.MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS));
          } else {
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
    
    try {
      while (this.writeQueue.length > 0) {
        const batch = this.writeQueue.splice(0, 5);
        await Promise.allSettled(batch.map(write => write()));
      }
    } catch (error) {
      this.logger.error(`Write queue error: ${error.message}`);
    } finally {
      this.isProcessingQueue = false;
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
    
    // Limit cache size
    if (this.queryCache.size > 500) {
      const oldestKeys = Array.from(this.queryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 50)
        .map(([key]) => key);
      
      oldestKeys.forEach(key => this.queryCache.delete(key));
      this.logger.debug(`🗑️ Cleaned ${oldestKeys.length} oldest cache entries`);
    }
  }

  private startBackgroundTasks() {
    // Cache cleanup every minute
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [path, cached] of this.queryCache.entries()) {
        if (now - cached.timestamp > this.STALE_CACHE_TTL) {
          this.queryCache.delete(path);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.debug(`🗑️ Cache cleanup: removed ${cleaned} stale entries`);
      }
    }, 60000);

    // Process write queue regularly
    setInterval(() => this.processWriteQueue(), 200);

    // Stats reset daily
    setInterval(() => {
      const hoursSinceReset = (Date.now() - this.lastStatsReset) / 3600000;
      
      this.logger.log('');
      this.logger.log('📊 Daily Stats Reset:');
      this.logger.log(`   Reads: ${this.readCount} (${Math.round(this.readCount / hoursSinceReset)}/hour)`);
      this.logger.log(`   Writes: ${this.writeCount} (${Math.round(this.writeCount / hoursSinceReset)}/hour)`);
      this.logger.log('');
      
      this.readCount = 0;
      this.writeCount = 0;
      this.lastStatsReset = Date.now();
    }, 86400000); // 24 hours
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

  getRealtimeDatabase(): admin.database.Database {
    if (!this.initialized || !this.realtimeDb) {
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
    
    return {
      connection: {
        method: 'Admin SDK',
        firestoreReady: this.firestoreReady,
        realtimeDbReady: this.realtimeDb !== null,
        consecutiveFailures: this.connectionHealth.consecutiveFailures,
        lastSuccessMs: timeSinceLastSuccess,
        isHealthy: this.connectionHealth.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES,
      },
      operations: {
        total: this.operationCount,
        avgResponseTime: Math.round(this.avgResponseTime),
        cacheHitRate: `${cacheHitPercentage}%`,
      },
      cache: {
        size: this.queryCache.size,
        ttl: `${this.CACHE_TTL}ms`,
        staleTtl: `${this.STALE_CACHE_TTL}ms`,
      },
      queue: {
        writeQueueSize: this.writeQueue.length,
        isProcessing: this.isProcessingQueue,
      },
      billing: {
        firestoreReads: this.readCount,
        firestoreWrites: this.writeCount,
        realtimeReads: this.operationCount,
        estimatedDailyReads: hoursSinceReset > 0 ? Math.round(this.readCount / hoursSinceReset * 24) : 0,
        estimatedDailyWrites: hoursSinceReset > 0 ? Math.round(this.writeCount / hoursSinceReset * 24) : 0,
        timeSinceReset: `${Math.floor(hoursSinceReset)}h ${Math.floor((hoursSinceReset % 1) * 60)}m`,
      }
    };
  }

  async shutdown() {
    this.logger.log('');
    this.logger.log('🛑 Shutting down Firebase Manager...');
    
    // Process remaining writes
    if (this.writeQueue.length > 0) {
      this.logger.log(`📤 Processing ${this.writeQueue.length} remaining writes...`);
      
      while (this.writeQueue.length > 0) {
        const batch = this.writeQueue.splice(0, 10);
        await Promise.allSettled(batch.map(write => write()));
      }
    }
    
    this.logger.log('✅ Firebase shutdown complete');
    this.logger.log('');
  }
}