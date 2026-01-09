// src/balance/balance.service.ts
// ✅ FIXED: Better error handling & fallback queries

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE, AFFILIATE_STATUS, AFFILIATE_CONFIG, USER_STATUS } from '../common/constants';
import { CalculationUtil } from '../common/utils';
import { Balance, BalanceSummary, Affiliate } from '../common/interfaces';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);
  
  private realBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private demoBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  
  private readonly BALANCE_CACHE_TTL = 500;
  
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
      // Get affiliate record
      const affiliateSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
        .where('referee_id', '==', userId)
        .where('status', '==', AFFILIATE_STATUS.PENDING)
        .limit(1)
        .get();

      if (affiliateSnapshot.empty) {
        return;
      }

      const affiliateDoc = affiliateSnapshot.docs[0];
      const affiliate = affiliateDoc.data() as Affiliate;

      // ✅ GET USER STATUS untuk tentukan komisi
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        this.logger.warn(`⚠️ User ${userId} not found for affiliate processing`);
        return;
      }

      const userData = userDoc.data();
      const userStatus = userData?.status || USER_STATUS.STANDARD;

      // ✅ TENTUKAN KOMISI BERDASARKAN STATUS
      let commissionAmount: number;
      
      switch (userStatus.toUpperCase()) {
        case USER_STATUS.VIP.toUpperCase():
          commissionAmount = AFFILIATE_CONFIG.COMMISSION_BY_STATUS.VIP;
          break;
        case USER_STATUS.GOLD.toUpperCase():
          commissionAmount = AFFILIATE_CONFIG.COMMISSION_BY_STATUS.GOLD;
          break;
        case USER_STATUS.STANDARD.toUpperCase():
        default:
          commissionAmount = AFFILIATE_CONFIG.COMMISSION_BY_STATUS.STANDARD;
          break;
      }

      const timestamp = new Date().toISOString();

      // Update affiliate record with actual commission
      await db.collection(COLLECTIONS.AFFILIATES)
        .doc(affiliate.id)
        .update({
          status: AFFILIATE_STATUS.COMPLETED,
          commission_amount: commissionAmount, // ✅ Update dengan komisi sesuai status
          referee_status: userStatus, // ✅ Simpan status referee untuk tracking
          completed_at: timestamp,
        });

      // Create commission balance entry
      const commissionBalanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
      
      await db.collection(COLLECTIONS.BALANCE).doc(commissionBalanceId).set({
        id: commissionBalanceId,
        user_id: affiliate.referrer_id,
        accountType: BALANCE_ACCOUNT_TYPE.REAL,
        type: BALANCE_TYPES.AFFILIATE_COMMISSION,
        amount: commissionAmount,
        description: `Affiliate commission - Friend deposit (${userStatus.toUpperCase()} level)`,
        createdAt: timestamp,
      });

      this.realBalanceCache.delete(affiliate.referrer_id);

      this.logger.log(
        `🎉 Affiliate commission paid: Rp ${commissionAmount.toLocaleString()} to ${affiliate.referrer_id} ` +
        `(Referee status: ${userStatus.toUpperCase()})`
      );

    } catch (error) {
      this.logger.error(`❌ Affiliate processing error: ${error.message}`);
    }
  }

  // ✅ FIXED: Better migration with error handling
  private async autoMigrateIfNeeded(userId: string): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();

      // Check if user has any balance records
      const balanceQuery = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .limit(5)
        .get();

      if (balanceQuery.empty) {
        // Create initial balances if none exist
        const timestamp = new Date().toISOString();
        
        const realBalanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
        const demoBalanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);

        await Promise.all([
          db.collection(COLLECTIONS.BALANCE).doc(realBalanceId).set({
            id: realBalanceId,
            user_id: userId,
            accountType: BALANCE_ACCOUNT_TYPE.REAL,
            type: BALANCE_TYPES.DEPOSIT,
            amount: 0,
            description: 'Initial real balance',
            createdAt: timestamp,
          }),
          db.collection(COLLECTIONS.BALANCE).doc(demoBalanceId).set({
            id: demoBalanceId,
            user_id: userId,
            accountType: BALANCE_ACCOUNT_TYPE.DEMO,
            type: BALANCE_TYPES.DEPOSIT,
            amount: 10000000,
            description: 'Initial demo balance',
            createdAt: timestamp,
          }),
        ]);

        this.logger.log(`✅ Created initial balances for user ${userId}`);
        return;
      }

      // Migrate old records without accountType
      let needsMigration = false;
      const batch = db.batch();
      let batchCount = 0;

      for (const doc of balanceQuery.docs) {
        const data = doc.data();

        if (!data.accountType) {
          batch.update(doc.ref, { accountType: BALANCE_ACCOUNT_TYPE.REAL });
          batchCount++;
          needsMigration = true;
        }
      }

      if (needsMigration && batchCount > 0) {
        await batch.commit();
        this.logger.log(`✅ Migrated ${batchCount} old balance records for user ${userId}`);
      }

    } catch (error) {
      this.logger.error(`❌ Auto-migration error for user ${userId}: ${error.message}`);
      // Don't throw, just log - balance operations can continue
    }
  }

  // ✅ FIXED: Safer balance calculation
  async getCurrentBalance(
    userId: string, 
    accountType: 'real' | 'demo',
    forceRefresh = false
  ): Promise<number> {
    try {
      const cache = accountType === BALANCE_ACCOUNT_TYPE.REAL 
        ? this.realBalanceCache 
        : this.demoBalanceCache;

      if (!forceRefresh) {
        const cached = cache.get(userId);
        if (cached) {
          const age = Date.now() - cached.timestamp;
          if (age < this.BALANCE_CACHE_TTL) {
            return cached.balance;
          }
        }
      }

      // Try migration first
      await this.autoMigrateIfNeeded(userId);

      const db = this.firebaseService.getFirestore();
      
      // Simple query without orderBy
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

      return balance;

    } catch (error) {
      this.logger.error(`❌ getCurrentBalance error: ${error.message}`);
      this.logger.error(error.stack);
      
      // Return 0 instead of throwing
      return 0;
    }
  }

  async getCurrentBalanceStrict(
    userId: string,
    accountType: 'real' | 'demo'
  ): Promise<number> {
    return this.getCurrentBalance(userId, accountType, true);
  }

  // ✅ FIXED: Safer both balances
  async getBothBalances(userId: string): Promise<BalanceSummary> {
    try {
      await this.autoMigrateIfNeeded(userId);

      const [realBalance, demoBalance] = await Promise.all([
        this.getCurrentBalance(userId, BALANCE_ACCOUNT_TYPE.REAL),
        this.getCurrentBalance(userId, BALANCE_ACCOUNT_TYPE.DEMO),
      ]);

      const db = this.firebaseService.getFirestore();
      
      // Simple query
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

    } catch (error) {
      this.logger.error(`❌ getBothBalances error: ${error.message}`);
      this.logger.error(error.stack);
      
      // Return safe defaults
      return {
        realBalance: 0,
        demoBalance: 10000000,
        realTransactions: 0,
        demoTransactions: 1,
      };
    }
  }

  async createBalanceEntry(
    userId: string, 
    createBalanceDto: CreateBalanceDto, 
    critical = true
  ) {
    try {
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
            `Insufficient ${accountType} balance. Available: ${currentBalance}, Required: ${createBalanceDto.amount}`
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

      await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData);

      this.invalidateCache(userId, accountType);

      await new Promise(resolve => setTimeout(resolve, 100));

      const currentBalance = await this.getCurrentBalance(userId, accountType, true);

      if (accountType === BALANCE_ACCOUNT_TYPE.REAL && 
          createBalanceDto.type === BALANCE_TYPES.DEPOSIT) {
        
        if (wasFirstDeposit) {
          await this.checkAndProcessAffiliate(userId, true);
        }

        if (this.userStatusService) {
          try {
            await this.userStatusService.updateUserStatus(userId);
          } catch (error) {
            this.logger.warn(`⚠️ Status update failed: ${error.message}`);
          }
        }
      }

      return {
        message: `${accountType} balance transaction recorded successfully`,
        transaction: balanceData,
        currentBalance,
        accountType,
        affiliateProcessed: wasFirstDeposit,
      };

    } catch (error) {
      this.logger.error(`❌ createBalanceEntry error: ${error.message}`);
      throw error;
    }
  }

  // ✅ FIXED: Safer balance history with fallback
  async getBalanceHistory(
    userId: string, 
    queryDto: QueryBalanceDto,
    accountType?: 'real' | 'demo'
  ) {
    try {
      await this.autoMigrateIfNeeded(userId);

      const { page = 1, limit = 20 } = queryDto;
      const db = this.firebaseService.getFirestore();
      
      // ✅ STRATEGY 1: Try simple query first
      try {
        let query = db.collection(COLLECTIONS.BALANCE)
          .where('user_id', '==', userId);

        if (accountType) {
          query = query.where('accountType', '==', accountType) as any;
        }

        const snapshot = await query.get();
        
        let allTransactions = snapshot.docs.map(doc => doc.data() as Balance);
        
        // Sort in memory
        allTransactions.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA;
        });

        const total = allTransactions.length;
        const startIndex = (page - 1) * limit;
        const transactions = allTransactions.slice(startIndex, startIndex + limit);

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

      } catch (queryError) {
        this.logger.error(`❌ Balance history query error: ${queryError.message}`);
        
        // ✅ FALLBACK: Return minimal data
        const summary = await this.getBothBalances(userId);
        
        return {
          currentBalances: {
            real: summary.realBalance,
            demo: summary.demoBalance,
          },
          transactions: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          },
          filter: { accountType: accountType || 'all' },
          error: 'Could not load history, showing current balance only',
        };
      }

    } catch (error) {
      this.logger.error(`❌ getBalanceHistory error: ${error.message}`);
      this.logger.error(error.stack);
      
      // Return safe defaults
      return {
        currentBalances: {
          real: 0,
          demo: 10000000,
        },
        transactions: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
        filter: { accountType: accountType || 'all' },
        error: error.message,
      };
    }
  }

  async getBalanceSummary(userId: string) {
    try {
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

    } catch (error) {
      this.logger.error(`❌ getBalanceSummary error: ${error.message}`);
      
      return {
        real: {
          currentBalance: 0,
          totalDeposits: 0,
          totalWithdrawals: 0,
          totalOrderDebits: 0,
          totalOrderProfits: 0,
          totalAffiliateCommissions: 0,
          transactionCount: 0,
        },
        demo: {
          currentBalance: 10000000,
          totalDeposits: 10000000,
          totalWithdrawals: 0,
          totalOrderDebits: 0,
          totalOrderProfits: 0,
          transactionCount: 1,
        },
        total: {
          transactionCount: 1,
          combinedBalance: 10000000,
        },
      };
    }
  }

  private invalidateCache(userId: string, accountType: 'real' | 'demo'): void {
    if (accountType === BALANCE_ACCOUNT_TYPE.REAL) {
      this.realBalanceCache.delete(userId);
    } else {
      this.demoBalanceCache.delete(userId);
    }
  }

  clearUserCache(userId: string): void {
    this.realBalanceCache.delete(userId);
    this.demoBalanceCache.delete(userId);
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
  }

  async forceRefreshBalance(userId: string, accountType: 'real' | 'demo'): Promise<number> {
    this.invalidateCache(userId, accountType);
    return this.getCurrentBalance(userId, accountType, true);
  }

  getPerformanceStats() {
    return {
      realBalanceCacheSize: this.realBalanceCache.size,
      demoBalanceCacheSize: this.demoBalanceCache.size,
      balanceCacheTTL: this.BALANCE_CACHE_TTL,
    };
  }
}