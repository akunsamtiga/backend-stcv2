// src/balance/balance.service.ts
// ✅ UPDATED: Backward compatibility untuk akun lama
// Auto-migrate accountType saat data diakses

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { FirebaseService, BatchOperation } from '../firebase/firebase.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE } from '../common/constants';
import { CalculationUtil } from '../common/utils';
import { Balance, BalanceSummary } from '../common/interfaces';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);
  
  private realBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private demoBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private balanceHistoryCache: Map<string, { history: Balance[]; timestamp: number }> = new Map();
  
  private readonly BALANCE_CACHE_TTL = 1000;
  private readonly HISTORY_CACHE_TTL = 3000;

  constructor(private firebaseService: FirebaseService) {
    setInterval(() => this.cleanupCache(), 30000);
  }

  /**
   * ✅ HELPER: Auto-migrate old records without accountType
   */
  private async autoMigrateIfNeeded(userId: string): Promise<void> {
    const db = this.firebaseService.getFirestore();

    try {
      // Check if user has any records without accountType
      const oldRecordsQuery = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .limit(100)
        .get();

      if (oldRecordsQuery.empty) {
        return;
      }

      let needsMigration = false;
      const batch = db.batch();
      let batchCount = 0;

      for (const doc of oldRecordsQuery.docs) {
        const data = doc.data();

        // ✅ Auto-add accountType='real' to old records
        if (!data.accountType) {
          batch.update(doc.ref, { accountType: 'real' });
          batchCount++;
          needsMigration = true;
        }
      }

      if (needsMigration) {
        await batch.commit();
        this.logger.log(
          `✅ Auto-migrated ${batchCount} old balance records for user ${userId}`
        );
      }

      // ✅ Check if user needs demo balance
      const demoBalanceQuery = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .where('accountType', '==', 'demo')
        .limit(1)
        .get();

      if (demoBalanceQuery.empty) {
        // Create demo balance
        const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
        const timestamp = new Date().toISOString();

        await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set({
          id: balanceId,
          user_id: userId,
          accountType: 'demo',
          type: BALANCE_TYPES.DEPOSIT,
          amount: 10000,
          description: 'Initial demo balance (auto-created)',
          createdAt: timestamp,
        });

        this.logger.log(`✅ Auto-created demo balance for user ${userId}`);
      }

    } catch (error) {
      // Don't fail if migration fails - just log it
      this.logger.warn(`Auto-migration warning for user ${userId}: ${error.message}`);
    }
  }

  /**
   * ✅ GET CURRENT BALANCE - With Auto-migration
   */
  async getCurrentBalance(
    userId: string, 
    accountType: 'real' | 'demo'
  ): Promise<number> {
    // ✅ Auto-migrate old records first
    await this.autoMigrateIfNeeded(userId);

    // ✅ Select correct cache
    const cache = accountType === BALANCE_ACCOUNT_TYPE.REAL 
      ? this.realBalanceCache 
      : this.demoBalanceCache;

    const cached = cache.get(userId);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.BALANCE_CACHE_TTL) {
        this.logger.debug(`⚡ ${accountType} balance cache hit: ${userId} = ${cached.balance}`);
        return cached.balance;
      }
    }

    // ✅ Fetch from database with account type filter
    const db = this.firebaseService.getFirestore();
    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .where('accountType', '==', accountType)
      .get();

    const transactions = snapshot.docs.map(doc => doc.data() as Balance);
    const balance = CalculationUtil.calculateBalance(transactions);
    
    cache.set(userId, {
      balance,
      timestamp: Date.now(),
    });

    this.logger.debug(
      `📊 ${accountType.toUpperCase()} balance: ${userId} = ${balance} (${transactions.length} txs)`
    );

    return balance;
  }

  /**
   * ✅ GET BOTH BALANCES - With Auto-migration
   */
  async getBothBalances(userId: string): Promise<BalanceSummary> {
    // ✅ Auto-migrate first
    await this.autoMigrateIfNeeded(userId);

    const [realBalance, demoBalance] = await Promise.all([
      this.getCurrentBalance(userId, BALANCE_ACCOUNT_TYPE.REAL),
      this.getCurrentBalance(userId, BALANCE_ACCOUNT_TYPE.DEMO),
    ]);

    const db = this.firebaseService.getFirestore();
    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .get();

    const transactions = snapshot.docs.map(doc => doc.data() as Balance);
    const realTransactions = transactions.filter(t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL).length;
    const demoTransactions = transactions.filter(t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO).length;

    return {
      realBalance,
      demoBalance,
      realTransactions,
      demoTransactions,
    };
  }

  /**
   * ✅ CREATE BALANCE ENTRY
   */
  async createBalanceEntry(
    userId: string, 
    createBalanceDto: CreateBalanceDto, 
    critical = true
  ) {
    const db = this.firebaseService.getFirestore();
    const { accountType } = createBalanceDto;

    // ✅ Validate account type
    if (accountType !== BALANCE_ACCOUNT_TYPE.REAL && accountType !== BALANCE_ACCOUNT_TYPE.DEMO) {
      throw new BadRequestException('Invalid account type. Must be "real" or "demo"');
    }

    // ✅ Auto-migrate if needed (before checking balance)
    await this.autoMigrateIfNeeded(userId);

    // ✅ Check balance for withdrawals
    if (createBalanceDto.type === BALANCE_TYPES.WITHDRAWAL) {
      const currentBalance = await this.getCurrentBalance(userId, accountType);
      if (currentBalance < createBalanceDto.amount) {
        throw new BadRequestException(
          `Insufficient ${accountType} balance for withdrawal. Available: ${currentBalance}`
        );
      }
    }

    const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
    const balanceData = {
      id: balanceId,
      user_id: userId,
      accountType,
      type: createBalanceDto.type,
      amount: createBalanceDto.amount,
      description: createBalanceDto.description || '',
      createdAt: new Date().toISOString(),
    };

    const isCriticalOperation = 
      createBalanceDto.type === BALANCE_TYPES.DEPOSIT || 
      createBalanceDto.type === BALANCE_TYPES.WITHDRAWAL;

    if (isCriticalOperation || critical) {
      await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData);
      this.logger.log(
        `✅ ${accountType} balance written: ${userId} - ${createBalanceDto.type} ${createBalanceDto.amount}`
      );
    } else {
      db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData)
        .then(() => {
          this.logger.debug(
            `✅ ${accountType} balance written (async): ${userId} - ${createBalanceDto.type}`
          );
        })
        .catch(err => {
          this.logger.error(`❌ ${accountType} balance write failed: ${err.message}`);
        });
    }

    this.invalidateCache(userId, accountType);

    if (isCriticalOperation) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const currentBalance = await this.getCurrentBalance(userId, accountType);

    this.logger.log(
      `${accountType.toUpperCase()} balance updated: ${userId} - ${createBalanceDto.type} ${createBalanceDto.amount} -> ${currentBalance}`
    );

    return {
      message: `${accountType} balance transaction recorded successfully`,
      transaction: balanceData,
      currentBalance,
      accountType,
    };
  }

  /**
   * ✅ GET BALANCE HISTORY - With Auto-migration
   */
  async getBalanceHistory(
    userId: string, 
    queryDto: QueryBalanceDto,
    accountType?: 'real' | 'demo'
  ) {
    // ✅ Auto-migrate first
    await this.autoMigrateIfNeeded(userId);

    const { page = 1, limit = 20 } = queryDto;

    const db = this.firebaseService.getFirestore();
    let query = db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId);

    if (accountType) {
      query = query.where('accountType', '==', accountType) as any;
    }

    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .get();

    const allTransactions = snapshot.docs.map(doc => doc.data() as Balance);
    
    const total = allTransactions.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const transactions = allTransactions.slice(startIndex, endIndex);

    let currentBalances: any = {};
    
    if (accountType) {
      currentBalances[accountType] = await this.getCurrentBalance(userId, accountType);
    } else {
      const summary = await this.getBothBalances(userId);
      currentBalances = {
        real: summary.realBalance,
        demo: summary.demoBalance,
      };
    }

    return {
      currentBalances,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      filter: accountType ? { accountType } : { accountType: 'all' },
    };
  }

  /**
   * ✅ GET BALANCE SUMMARY
   */
  async getBalanceSummary(userId: string) {
    // ✅ Auto-migrate first
    await this.autoMigrateIfNeeded(userId);

    const db = this.firebaseService.getFirestore();
    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .get();

    const transactions = snapshot.docs.map(doc => doc.data() as Balance);

    const realTransactions = transactions.filter(t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoTransactions = transactions.filter(t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const realSummary = {
      currentBalance: CalculationUtil.calculateBalance(realTransactions),
      totalDeposits: realTransactions
        .filter(t => t.type === BALANCE_TYPES.DEPOSIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalWithdrawals: realTransactions
        .filter(t => t.type === BALANCE_TYPES.WITHDRAWAL)
        .reduce((sum, t) => sum + t.amount, 0),
      totalOrderDebits: realTransactions
        .filter(t => t.type === BALANCE_TYPES.ORDER_DEBIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalOrderProfits: realTransactions
        .filter(t => t.type === BALANCE_TYPES.ORDER_PROFIT)
        .reduce((sum, t) => sum + t.amount, 0),
      transactionCount: realTransactions.length,
    };

    const demoSummary = {
      currentBalance: CalculationUtil.calculateBalance(demoTransactions),
      totalDeposits: demoTransactions
        .filter(t => t.type === BALANCE_TYPES.DEPOSIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalWithdrawals: demoTransactions
        .filter(t => t.type === BALANCE_TYPES.WITHDRAWAL)
        .reduce((sum, t) => sum + t.amount, 0),
      totalOrderDebits: demoTransactions
        .filter(t => t.type === BALANCE_TYPES.ORDER_DEBIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalOrderProfits: demoTransactions
        .filter(t => t.type === BALANCE_TYPES.ORDER_PROFIT)
        .reduce((sum, t) => sum + t.amount, 0),
      transactionCount: demoTransactions.length,
    };

    return {
      real: realSummary,
      demo: demoSummary,
      total: {
        transactionCount: transactions.length,
        combinedBalance: realSummary.currentBalance + demoSummary.currentBalance,
      },
    };
  }

  /**
   * BULK CREATE
   */
  async bulkCreateBalanceEntries(
    entries: Array<{
      userId: string;
      accountType: 'real' | 'demo';
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
          accountType: entry.accountType,
          type: entry.type,
          amount: entry.amount,
          description: entry.description,
          createdAt: timestamp,
        },
      });
    }

    await this.firebaseService.batchWrite(operations);
    
    const uniqueUsers = [...new Set(entries.map(e => e.userId))];
    uniqueUsers.forEach(userId => {
      const hasReal = entries.some(e => e.userId === userId && e.accountType === BALANCE_ACCOUNT_TYPE.REAL);
      const hasDemo = entries.some(e => e.userId === userId && e.accountType === BALANCE_ACCOUNT_TYPE.DEMO);
      
      if (hasReal) this.invalidateCache(userId, BALANCE_ACCOUNT_TYPE.REAL);
      if (hasDemo) this.invalidateCache(userId, BALANCE_ACCOUNT_TYPE.DEMO);
    });
    
    this.logger.log(`Bulk created ${entries.length} balance entries`);
  }

  /**
   * CACHE MANAGEMENT
   */
  private invalidateCache(userId: string, accountType: 'real' | 'demo'): void {
    if (accountType === BALANCE_ACCOUNT_TYPE.REAL) {
      this.realBalanceCache.delete(userId);
    } else {
      this.demoBalanceCache.delete(userId);
    }
    this.balanceHistoryCache.delete(userId);
    this.logger.debug(`🗑️ ${accountType} cache invalidated for ${userId}`);
  }

  private cleanupCache(): void {
    const now = Date.now();
    const maxAge = this.BALANCE_CACHE_TTL * 5;
    
    for (const [userId, cached] of this.realBalanceCache.entries()) {
      if (now - cached.timestamp > maxAge) {
        this.realBalanceCache.delete(userId);
      }
    }

    for (const [userId, cached] of this.demoBalanceCache.entries()) {
      if (now - cached.timestamp > maxAge) {
        this.demoBalanceCache.delete(userId);
      }
    }

    for (const [userId, cached] of this.balanceHistoryCache.entries()) {
      if (now - cached.timestamp > this.HISTORY_CACHE_TTL * 5) {
        this.balanceHistoryCache.delete(userId);
      }
    }
  }

  async forceRefreshBalance(userId: string, accountType: 'real' | 'demo'): Promise<number> {
    this.invalidateCache(userId, accountType);
    return this.getCurrentBalance(userId, accountType);
  }

  getPerformanceStats() {
    return {
      realBalanceCacheSize: this.realBalanceCache.size,
      demoBalanceCacheSize: this.demoBalanceCache.size,
      historyCacheSize: this.balanceHistoryCache.size,
      balanceCacheTTL: this.BALANCE_CACHE_TTL,
      historyCacheTTL: this.HISTORY_CACHE_TTL,
    };
  }
}