import { Injectable, BadRequestException, Logger, forwardRef, Inject } from '@nestjs/common';
import { FirebaseService, BatchOperation } from '../firebase/firebase.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE, AFFILIATE_STATUS, AFFILIATE_CONFIG } from '../common/constants';
import { CalculationUtil } from '../common/utils';
import { Balance, BalanceSummary, Affiliate } from '../common/interfaces';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);
  
  private realBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private demoBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private balanceHistoryCache: Map<string, { history: Balance[]; timestamp: number }> = new Map();
  
  private readonly BALANCE_CACHE_TTL = 500;
  private readonly HISTORY_CACHE_TTL = 2000;
  
  private userStatusService: any;

  constructor(
    private firebaseService: FirebaseService,
  ) {
    setInterval(() => this.cleanupCache(), 30000);
  }

  setUserStatusService(service: any) {
    this.userStatusService = service;
  }

  private async checkAndProcessAffiliate(userId: string, isFirstDeposit: boolean) {
    if (!isFirstDeposit) return;

    const db = this.firebaseService.getFirestore();

    try {
      const affiliateSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
        .where('referee_id', '==', userId)
        .where('status', '==', AFFILIATE_STATUS.PENDING)
        .limit(1)
        .get();

      if (affiliateSnapshot.empty) {
        this.logger.debug(`No pending affiliate for user ${userId}`);
        return;
      }

      const affiliateDoc = affiliateSnapshot.docs[0];
      const affiliate = affiliateDoc.data() as Affiliate;
      const timestamp = new Date().toISOString();

      await db.collection(COLLECTIONS.AFFILIATES)
        .doc(affiliate.id)
        .update({
          status: AFFILIATE_STATUS.COMPLETED,
          completed_at: timestamp,
        });

      const commissionBalanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
      
      await db.collection(COLLECTIONS.BALANCE).doc(commissionBalanceId).set({
        id: commissionBalanceId,
        user_id: affiliate.referrer_id,
        accountType: BALANCE_ACCOUNT_TYPE.REAL,
        type: BALANCE_TYPES.AFFILIATE_COMMISSION,
        amount: AFFILIATE_CONFIG.COMMISSION_AMOUNT,
        description: `Affiliate commission - Friend deposit activated`,
        createdAt: timestamp,
      });

      this.realBalanceCache.delete(affiliate.referrer_id);

      this.logger.log(`🎁 Affiliate commission paid: ${AFFILIATE_CONFIG.COMMISSION_AMOUNT} to ${affiliate.referrer_id}`);
      this.logger.log(`   Referee: ${userId} made first deposit`);

    } catch (error) {
      this.logger.error(`❌ Affiliate processing error: ${error.message}`);
    }
  }

  private async autoMigrateIfNeeded(userId: string): Promise<void> {
    const db = this.firebaseService.getFirestore();

    try {
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

      const demoBalanceQuery = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .where('accountType', '==', 'demo')
        .limit(1)
        .get();

      if (demoBalanceQuery.empty) {
        const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
        const timestamp = new Date().toISOString();

        await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set({
          id: balanceId,
          user_id: userId,
          accountType: 'demo',
          type: BALANCE_TYPES.DEPOSIT,
          amount: 10000000,
          description: 'Initial demo balance (auto-created)',
          createdAt: timestamp,
        });

        this.logger.log(`✅ Auto-created demo balance (10M) for user ${userId}`);
      }

    } catch (error) {
      this.logger.warn(`Auto-migration warning for user ${userId}: ${error.message}`);
    }
  }

  async getCurrentBalance(
    userId: string, 
    accountType: 'real' | 'demo',
    forceRefresh = false
  ): Promise<number> {
    await this.autoMigrateIfNeeded(userId);

    const cache = accountType === BALANCE_ACCOUNT_TYPE.REAL 
      ? this.realBalanceCache 
      : this.demoBalanceCache;

    if (!forceRefresh) {
      const cached = cache.get(userId);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < this.BALANCE_CACHE_TTL) {
          this.logger.debug(`⚡ ${accountType} balance cache hit: ${userId} = ${cached.balance} (${age}ms old)`);
          return cached.balance;
        }
      }
    }

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

    this.logger.log(
      `📊 ${accountType.toUpperCase()} balance (FRESH): ${userId} = ${balance} (${transactions.length} txs)`
    );

    return balance;
  }

  async getCurrentBalanceStrict(
    userId: string,
    accountType: 'real' | 'demo'
  ): Promise<number> {
    return this.getCurrentBalance(userId, accountType, true);
  }

  async getBothBalances(userId: string): Promise<BalanceSummary> {
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

  async createBalanceEntry(
    userId: string, 
    createBalanceDto: CreateBalanceDto, 
    critical = true
  ) {
    const db = this.firebaseService.getFirestore();
    const { accountType } = createBalanceDto;

    if (accountType !== BALANCE_ACCOUNT_TYPE.REAL && accountType !== BALANCE_ACCOUNT_TYPE.DEMO) {
      throw new BadRequestException('Invalid account type. Must be "real" or "demo"');
    }

    await this.autoMigrateIfNeeded(userId);

    if (createBalanceDto.type === BALANCE_TYPES.WITHDRAWAL) {
      const currentBalance = await this.getCurrentBalanceStrict(userId, accountType);
      
      if (currentBalance < createBalanceDto.amount) {
        throw new BadRequestException(
          `Insufficient ${accountType} balance for withdrawal. Available: ${currentBalance}, Required: ${createBalanceDto.amount}`
        );
      }
    }

    const isFirstRealDeposit = accountType === BALANCE_ACCOUNT_TYPE.REAL && 
                                createBalanceDto.type === BALANCE_TYPES.DEPOSIT;

    let wasFirstDeposit = false;

    if (isFirstRealDeposit) {
      const existingDeposits = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .where('accountType', '==', BALANCE_ACCOUNT_TYPE.REAL)
        .where('type', '==', BALANCE_TYPES.DEPOSIT)
        .limit(1)
        .get();

      wasFirstDeposit = existingDeposits.empty;
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
      createBalanceDto.type === BALANCE_TYPES.WITHDRAWAL ||
      createBalanceDto.type === BALANCE_TYPES.ORDER_DEBIT;

    if (isCriticalOperation || critical) {
      await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData);
      this.logger.log(
        `✅ ${accountType} balance written (SYNC): ${userId} - ${createBalanceDto.type} ${createBalanceDto.amount}`
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

    const currentBalance = await this.getCurrentBalance(userId, accountType, true);

    if (accountType === BALANCE_ACCOUNT_TYPE.REAL && 
        createBalanceDto.type === BALANCE_TYPES.DEPOSIT) {
      
      if (wasFirstDeposit) {
        this.logger.log(`🎁 First deposit detected for user ${userId}, checking affiliate...`);
        await this.checkAndProcessAffiliate(userId, true);
      }

      if (this.userStatusService) {
        try {
          const statusUpdate = await this.userStatusService.updateUserStatus(userId);
          
          if (statusUpdate.changed) {
            this.logger.log(
              `🎉 User ${userId} upgraded: ${statusUpdate.oldStatus.toUpperCase()} → ${statusUpdate.newStatus.toUpperCase()}`
            );
          }
        } catch (error) {
          this.logger.warn(`⚠️ Status update failed for ${userId}: ${error.message}`);
        }
      }
    }

    this.logger.log(
      `${accountType.toUpperCase()} balance updated: ${userId} - ${createBalanceDto.type} ${createBalanceDto.amount} -> NEW: ${currentBalance}`
    );

    return {
      message: `${accountType} balance transaction recorded successfully`,
      transaction: balanceData,
      currentBalance,
      accountType,
      affiliateProcessed: wasFirstDeposit,
    };
  }

  async getBalanceHistory(
    userId: string, 
    queryDto: QueryBalanceDto,
    accountType?: 'real' | 'demo'
  ) {
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

  async getBalanceSummary(userId: string) {
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
      totalAffiliateCommissions: realTransactions
        .filter(t => t.type === BALANCE_TYPES.AFFILIATE_COMMISSION)
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

  private invalidateCache(userId: string, accountType: 'real' | 'demo'): void {
    if (accountType === BALANCE_ACCOUNT_TYPE.REAL) {
      this.realBalanceCache.delete(userId);
    } else {
      this.demoBalanceCache.delete(userId);
    }
    this.balanceHistoryCache.delete(userId);
    this.logger.debug(`🗑️ ${accountType} cache CLEARED for ${userId}`);
  }

  clearUserCache(userId: string): void {
    this.realBalanceCache.delete(userId);
    this.demoBalanceCache.delete(userId);
    this.balanceHistoryCache.delete(userId);
    this.logger.log(`🗑️ ALL cache cleared for user ${userId}`);
  }

  private cleanupCache(): void {
    const now = Date.now();
    const maxAge = this.BALANCE_CACHE_TTL * 10;
    
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
    return this.getCurrentBalance(userId, accountType, true);
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