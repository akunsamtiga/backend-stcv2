// src/firebase/firebase.service.ts
// ✅ FIXED: Prioritize Admin SDK (like simulator) instead of REST API

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
  private readonly CACHE_TTL = 30000;
  private readonly STALE_CACHE_TTL = 120000;
  
  private connectionHealth = {
    lastSuccessfulFetch: Date.now(),
    consecutiveFailures: 0,
  };
  
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 200;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;
  
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

      this.logger.log('⚡ Initializing Firebase (ADMIN SDK MODE)...');

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
          databaseURL: this.configService.get('firebase.realtimeDbUrl'),
        });
      }

      // ============================================
      // FIRESTORE INITIALIZATION
      // ============================================
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

      // ============================================
      // REALTIME DATABASE INITIALIZATION
      // ✅ FIXED: Use Admin SDK (like simulator)
      // ============================================
      await this.initializeRealtimeDb();
      
      this.initialized = true;
      this.logger.log('✅ Firebase ADMIN SDK mode ready!');
      this.logger.log('💡 Using same method as simulator');
      
      this.startBackgroundTasks();
      
    } catch (error) {
      this.logger.error(`❌ Firebase initialization failed: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // ✅ FIXED: Simplified Realtime DB Init
  // Priority: Admin SDK (proven to work)
  // ============================================
  private async initializeRealtimeDb() {
    const realtimeDbUrl = this.configService.get('firebase.realtimeDbUrl');
    
    if (!realtimeDbUrl) {
      this.logger.warn('⚠️ Realtime DB URL not configured');
      return;
    }

    try {
      this.logger.log('⚡ Initializing Realtime DB via Admin SDK...');
      this.logger.log('   (Same method as simulator - proven to work)');
      
      // Initialize Admin SDK for Realtime DB
      this.realtimeDb = admin.database();
      
      // Test connection
      this.logger.log('🔍 Testing Realtime DB connection...');
      const testSnapshot = await this.realtimeDb.ref('/.info/connected').once('value');
      const isConnected = testSnapshot.val();
      
      if (!isConnected) {
        throw new Error('Realtime DB not connected');
      }
      
      // Additional test: try to read a path
      await this.realtimeDb.ref('/.info/serverTimeOffset').once('value');
      
      this.logger.log('✅ Realtime DB Admin SDK ready');
      this.logger.log('   ✅ Same method as simulator');
      this.logger.log('   ✅ Connection verified');
      
    } catch (error) {
      this.logger.error(`❌ Realtime DB initialization failed: ${error.message}`);
      this.logger.error('   Check:');
      this.logger.error('   1. Database URL is correct');
      this.logger.error('   2. Database exists in Firebase Console');
      this.logger.error('   3. Service account has permission');
      throw error;
    }
  }

  // ============================================
  // ✅ FIXED: Simplified Price Fetching
  // Use Admin SDK directly (like simulator)
  // ============================================
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

    let lastError: Error | null = null;
    
    // Retry logic
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const data = await this.fetchRealtimeDbWithTimeout(path);
        
        this.connectionHealth.consecutiveFailures = 0;
        this.connectionHealth.lastSuccessfulFetch = Date.now();

        // Cache result
        if (useCache && data !== null) {
          this.cacheQuery(path, data);
        }

        const duration = Date.now() - startTime;
        this.operationCount++;
        this.avgResponseTime = (this.avgResponseTime * 0.9) + (duration * 0.1);

        return data;

      } catch (error) {
        lastError = error;
        
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAY_MS * Math.pow(1.5, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // Try stale cache as last resort
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
      this.logger.error('❌ Too many failures, check connection...');
      // Don't reconnect automatically - just log
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

  // ============================================
  // ✅ FIXED: Simplified fetch using Admin SDK
  // ============================================
  private async fetchRealtimeDb(path: string): Promise<any> {
    if (!this.realtimeDb) {
      throw new Error('Realtime Database not available');
    }

    try {
      this.readCount++;
      
      // Use Admin SDK (same as simulator)
      const snapshot = await this.realtimeDb.ref(path).once('value');
      const data = snapshot.val();
      
      if (!data) {
        this.logger.debug(`No data at path: ${path}`);
        return null;
      }
      
      return data;
      
    } catch (error) {
      this.logger.error(`Admin SDK read error at ${path}: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // WRITE OPERATIONS
  // ============================================
  async setRealtimeDbValue(path: string, data: any, critical = false): Promise<void> {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    const writeOperation = async () => {
      for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
        try {
          if (!this.realtimeDb) {
            throw new Error('Realtime Database not available');
          }

          await this.realtimeDb.ref(path).set(data);
          
          this.writeCount++;
          this.queryCache.delete(path);
          return;

        } catch (error) {
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
    
    while (this.writeQueue.length > 0) {
      const batch = this.writeQueue.splice(0, 5);
      
      await Promise.allSettled(
        batch.map(write => write())
      );
    }
    
    this.isProcessingQueue = false;
  }

  // ============================================
  // CACHE MANAGEMENT
  // ============================================
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
    
    // Cleanup if too large
    if (this.queryCache.size > 300) {
      const oldestKeys = Array.from(this.queryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 50)
        .map(([key]) => key);
      
      oldestKeys.forEach(key => this.queryCache.delete(key));
    }
  }

  // ============================================
  // BACKGROUND TASKS
  // ============================================
  private startBackgroundTasks() {
    setInterval(() => this.cleanupCache(), 60000);
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

  private resetDailyStats(): void {
    const hoursSinceReset = (Date.now() - this.lastStatsReset) / 3600000;
    
    this.logger.log('📊 Daily Stats:');
    this.logger.log(`   • Reads: ${this.readCount} (${Math.round(this.readCount / hoursSinceReset)}/hour)`);
    this.logger.log(`   • Writes: ${this.writeCount} (${Math.round(this.writeCount / hoursSinceReset)}/hour)`);
    
    this.readCount = 0;
    this.writeCount = 0;
    this.lastStatsReset = Date.now();
  }

  // ============================================
  // FIRESTORE METHODS
  // ============================================
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
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
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

  // ============================================
  // PERFORMANCE STATS
  // ============================================
  getPerformanceStats() {
    const timeSinceLastSuccess = Date.now() - this.connectionHealth.lastSuccessfulFetch;
    const totalOps = this.operationCount + this.cacheHitRate;
    const cacheHitPercentage = totalOps > 0 ? Math.round((this.cacheHitRate / totalOps) * 100) : 0;
    const hoursSinceReset = (Date.now() - this.lastStatsReset) / 3600000;
    
    return {
      operations: this.operationCount,
      avgResponseTime: Math.round(this.avgResponseTime),
      cacheSize: this.queryCache.size,
      cacheHitRate: `${cacheHitPercentage}%`,
      writeQueueSize: this.writeQueue.length,
      connectionMethod: 'Admin SDK',
      firestoreReady: this.firestoreReady,
      realtimeDbReady: this.realtimeDb !== null,
      dailyStats: {
        reads: this.readCount,
        writes: this.writeCount,
        estimatedDailyReads: Math.round(this.readCount / hoursSinceReset * 24),
        estimatedDailyWrites: Math.round(this.writeCount / hoursSinceReset * 24),
        readsRemaining: 250000 - Math.round(this.readCount / hoursSinceReset * 24),
        writesRemaining: 100000 - Math.round(this.writeCount / hoursSinceReset * 24),
      },
      health: {
        consecutiveFailures: this.connectionHealth.consecutiveFailures,
        lastSuccessMs: timeSinceLastSuccess,
        isHealthy: this.connectionHealth.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES,
      },
    };
  }
}