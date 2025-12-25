// src/balance/balance.service.ts
// ✅ CRITICAL FIX - Balance calculation corrected

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { FirebaseService, BatchOperation } from '../firebase/firebase.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';
import { COLLECTIONS, BALANCE_TYPES } from '../common/constants';
import { CalculationUtil } from '../common/utils';
import { Balance } from '../common/interfaces';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);
  
  // ⚡ BALANCE CACHING
  private balanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private balanceHistoryCache: Map<string, { history: Balance[]; timestamp: number }> = new Map();
  
  // ✅ ADJUSTED TTLs - Balance harus lebih fresh untuk avoid race condition
  private readonly BALANCE_CACHE_TTL = 1000; // ✅ REDUCED to 1s for critical operations
  private readonly HISTORY_CACHE_TTL = 3000; // ✅ REDUCED to 3s

  constructor(private firebaseService: FirebaseService) {
    setInterval(() => this.cleanupCache(), 30000);
  }

  /**
   * ✅ FIXED: Create balance entry - ALWAYS WAIT for critical operations
   */
  async createBalanceEntry(userId: string, createBalanceDto: CreateBalanceDto, critical = true) {
    const db = this.firebaseService.getFirestore();

    // ✅ Quick balance check for withdrawals
    if (createBalanceDto.type === BALANCE_TYPES.WITHDRAWAL) {
      const currentBalance = await this.getCurrentBalance(userId);
      if (currentBalance < createBalanceDto.amount) {
        throw new BadRequestException('Insufficient balance for withdrawal');
      }
    }

    const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
    const balanceData = {
      id: balanceId,
      user_id: userId,
      type: createBalanceDto.type,
      amount: createBalanceDto.amount,
      description: createBalanceDto.description || '',
      createdAt: new Date().toISOString(),
    };

    // ✅ CRITICAL FIX: ALWAYS WAIT for deposits and withdrawals
    // Only use fire-and-forget for order-related operations
    const isCriticalOperation = 
      createBalanceDto.type === BALANCE_TYPES.DEPOSIT || 
      createBalanceDto.type === BALANCE_TYPES.WITHDRAWAL;

    if (isCriticalOperation || critical) {
      // Wait for write to complete
      await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData);
      this.logger.log(`✅ Balance written (critical): ${userId} - ${createBalanceDto.type} ${createBalanceDto.amount}`);
    } else {
      // Fire and forget for non-critical (order debits/profits)
      db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData)
        .then(() => {
          this.logger.debug(`✅ Balance written (async): ${userId} - ${createBalanceDto.type} ${createBalanceDto.amount}`);
        })
        .catch(err => {
          this.logger.error(`❌ Balance write failed: ${err.message}`);
        });
    }

    // ⚡ Invalidate cache immediately
    this.invalidateCache(userId);

    // ✅ CRITICAL FIX: Wait a bit for cache to clear before reading
    if (isCriticalOperation) {
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
    }

    // ⚡ Get new balance (will fetch fresh from DB)
    const currentBalance = await this.getCurrentBalance(userId);

    this.logger.log(`Balance updated for user ${userId}: ${createBalanceDto.type} ${createBalanceDto.amount} -> ${currentBalance}`);

    return {
      message: 'Balance transaction recorded successfully',
      transaction: balanceData,
      currentBalance,
    };
  }

  /**
   * ⚡ OPTIMIZED: Bulk create with batch write
   */
  async createMultipleBalanceEntries(
    userId: string,
    entries: CreateBalanceDto[],
  ) {
    const db = this.firebaseService.getFirestore();

    // Check balance for withdrawals
    const currentBalance = await this.getCurrentBalance(userId);
    const totalWithdrawals = entries
      .filter(e => e.type === BALANCE_TYPES.WITHDRAWAL)
      .reduce((sum, e) => sum + e.amount, 0);

    if (totalWithdrawals > currentBalance) {
      throw new BadRequestException('Insufficient balance for withdrawals');
    }

    // Prepare batch operations
    const operations: BatchOperation[] = [];
    const timestamp = new Date().toISOString();

    for (const entry of entries) {
      const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
      
      operations.push({
        type: 'set',
        collection: COLLECTIONS.BALANCE,
        docId: balanceId,
        data: {
          id: balanceId,
          user_id: userId,
          type: entry.type,
          amount: entry.amount,
          description: entry.description || '',
          createdAt: timestamp,
        },
      });
    }

    // Execute batch write
    await this.firebaseService.batchWrite(operations);

    // Invalidate cache
    this.invalidateCache(userId);

    // Wait a bit for consistency
    await new Promise(resolve => setTimeout(resolve, 100));

    const newBalance = await this.getCurrentBalance(userId);

    this.logger.log(`Batch balance update for user ${userId}: ${entries.length} entries -> ${newBalance}`);

    return {
      message: `${entries.length} balance transactions recorded successfully`,
      newBalance,
    };
  }

  /**
   * ✅ FIXED: Get current balance - Better cache management
   */
  async getCurrentBalance(userId: string): Promise<number> {
    // ✅ Try cache first but with shorter TTL
    const cached = this.balanceCache.get(userId);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.BALANCE_CACHE_TTL) {
        this.logger.debug(`⚡ Balance cache hit for ${userId}: ${cached.balance}`);
        return cached.balance;
      }
    }

    // ✅ Fetch fresh from database
    const db = this.firebaseService.getFirestore();

    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .get();

    const transactions = snapshot.docs.map(doc => doc.data() as Balance);
    const balance = CalculationUtil.calculateBalance(transactions);
    
    // ✅ Cache it
    this.balanceCache.set(userId, {
      balance,
      timestamp: Date.now(),
    });

    this.logger.debug(`📊 Balance calculated for ${userId}: ${balance} (from ${transactions.length} transactions)`);

    return balance;
  }

  /**
   * ⚡ OPTIMIZED: Get balance history with caching
   */
  async getBalanceHistory(userId: string, queryDto: QueryBalanceDto) {
    const { page = 1, limit = 20 } = queryDto;

    // Try cache for first page
    if (page === 1) {
      const cached = this.balanceHistoryCache.get(userId);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < this.HISTORY_CACHE_TTL) {
          const transactions = cached.history.slice(0, limit);
          const currentBalance = await this.getCurrentBalance(userId);
          
          return {
            currentBalance,
            transactions,
            pagination: {
              page,
              limit,
              total: cached.history.length,
              totalPages: Math.ceil(cached.history.length / limit),
            },
          };
        }
      }
    }

    // Fetch from database
    const db = this.firebaseService.getFirestore();

    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const allTransactions = snapshot.docs.map(doc => doc.data() as Balance);
    
    // Cache full history
    this.balanceHistoryCache.set(userId, {
      history: allTransactions,
      timestamp: Date.now(),
    });

    const total = allTransactions.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const transactions = allTransactions.slice(startIndex, endIndex);

    const currentBalance = await this.getCurrentBalance(userId);

    return {
      currentBalance,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * CACHED: Balance summary
   */
  async getBalanceSummary(userId: string) {
    // Try to use cached history
    const cached = this.balanceHistoryCache.get(userId);
    let transactions: Balance[];

    if (cached && (Date.now() - cached.timestamp) < this.HISTORY_CACHE_TTL) {
      transactions = cached.history;
    } else {
      const db = this.firebaseService.getFirestore();
      const snapshot = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .get();

      transactions = snapshot.docs.map(doc => doc.data() as Balance);
      
      // Cache it
      this.balanceHistoryCache.set(userId, {
        history: transactions,
        timestamp: Date.now(),
      });
    }

    const summary = {
      currentBalance: CalculationUtil.calculateBalance(transactions),
      totalDeposits: transactions
        .filter(t => t.type === BALANCE_TYPES.DEPOSIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalWithdrawals: transactions
        .filter(t => t.type === BALANCE_TYPES.WITHDRAWAL)
        .reduce((sum, t) => sum + t.amount, 0),
      totalOrderDebits: transactions
        .filter(t => t.type === BALANCE_TYPES.ORDER_DEBIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalOrderProfits: transactions
        .filter(t => t.type === BALANCE_TYPES.ORDER_PROFIT)
        .reduce((sum, t) => sum + t.amount, 0),
      transactionCount: transactions.length,
    };

    return summary;
  }

  /**
   * BULK CREATE (for settlement) - Always wait
   */
  async bulkCreateBalanceEntries(
    entries: Array<{
      userId: string;
      type: string;
      amount: number;
      description: string;
    }>,
  ): Promise<void> {
    const operations: BatchOperation[] = [];
    const timestamp = new Date().toISOString();

    for (const entry of entries) {
      const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);

      operations.push({
        type: 'set',
        collection: COLLECTIONS.BALANCE,
        docId: balanceId,
        data: {
          id: balanceId,
          user_id: entry.userId,
          type: entry.type,
          amount: entry.amount,
          description: entry.description,
          createdAt: timestamp,
        },
      });
    }

    // Always wait for bulk operations
    await this.firebaseService.batchWrite(operations);
    
    // Invalidate all affected users
    entries.forEach(entry => this.invalidateCache(entry.userId));
    
    this.logger.log(`Bulk created ${entries.length} balance entries`);
  }

  /**
   * ⚡ CACHE MANAGEMENT
   */
  private invalidateCache(userId: string): void {
    this.balanceCache.delete(userId);
    this.balanceHistoryCache.delete(userId);
    this.logger.debug(`🗑️ Cache invalidated for user ${userId}`);
  }

  private cleanupCache(): void {
    const now = Date.now();
    
    // Clean balance cache
    for (const [userId, cached] of this.balanceCache.entries()) {
      if (now - cached.timestamp > this.BALANCE_CACHE_TTL * 5) {
        this.balanceCache.delete(userId);
      }
    }

    // Clean history cache
    for (const [userId, cached] of this.balanceHistoryCache.entries()) {
      if (now - cached.timestamp > this.HISTORY_CACHE_TTL * 5) {
        this.balanceHistoryCache.delete(userId);
      }
    }

    if (this.balanceCache.size > 0 || this.balanceHistoryCache.size > 0) {
      this.logger.debug(`⚡ Balance cache: ${this.balanceCache.size}, History: ${this.balanceHistoryCache.size}`);
    }
  }

  /**
   * FORCE REFRESH (for testing/debugging)
   */
  async forceRefreshBalance(userId: string): Promise<number> {
    this.invalidateCache(userId);
    return this.getCurrentBalance(userId);
  }

  /**
   * PERFORMANCE STATS
   */
  getPerformanceStats() {
    return {
      balanceCacheSize: this.balanceCache.size,
      historyCacheSize: this.balanceHistoryCache.size,
      balanceCacheTTL: this.BALANCE_CACHE_TTL,
      historyCacheTTL: this.HISTORY_CACHE_TTL,
    };
  }
}