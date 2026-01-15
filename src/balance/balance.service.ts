// src/balance/balance.service.ts - ✅ COMPLETE FIXED VERSION

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

  private transactionLocks: Map<string, { promise: Promise<any>; startTime: number }> = new Map();
  private readonly LOCK_TIMEOUT = 30000;

  constructor(
    private firebaseService: FirebaseService,
  ) {
    setInterval(() => this.cleanupCache(), 30000);
  }

  setUserStatusService(service: any) {
    this.userStatusService = service;
  }

  private async acquireTransactionLock(userId: string, accountType: string): Promise<void> {
    const lockKey = `${userId}_${accountType}`;
    
    const existingLock = this.transactionLocks.get(lockKey);
    if (existingLock) {
      const age = Date.now() - existingLock.startTime;
      
      if (age > this.LOCK_TIMEOUT) {
        this.logger.warn(`⚠️ Removing stale lock for ${lockKey} (age: ${age}ms)`);
        this.transactionLocks.delete(lockKey);
      } else {
        this.logger.debug(`⏳ Waiting for lock: ${lockKey}`);
        try {
          await existingLock.promise;
        } catch (error) {
          this.logger.debug(`Lock ${lockKey} finished with error, continuing`);
        }
      }
    }
  }

  private releaseTransactionLock(userId: string, accountType: string): void {
    const lockKey = `${userId}_${accountType}`;
    this.transactionLocks.delete(lockKey);
    this.logger.debug(`🔓 Released lock: ${lockKey}`);
  }

  private setTransactionLock(userId: string, accountType: string, promise: Promise<any>): void {
    const lockKey = `${userId}_${accountType}`;
    this.transactionLocks.set(lockKey, {
      promise,
      startTime: Date.now(),
    });
    this.logger.debug(`🔒 Acquired lock: ${lockKey}`);
  }

  // ✅ CRITICAL FIX: Method untuk check apakah ini first deposit
    private async isFirstRealDeposit(userId: string): Promise<boolean> {
    try {
      const db = this.firebaseService.getFirestore();
      
      // Check apakah ada deposit REAL sebelumnya
      const existingDeposits = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .where('accountType', '==', BALANCE_ACCOUNT_TYPE.REAL)
        .where('type', '==', BALANCE_TYPES.DEPOSIT)
        .limit(1)
        .get();

      const isFirst = existingDeposits.empty;
      
      if (isFirst) {
        this.logger.log(`🎯 FIRST DEPOSIT detected for user ${userId}`);
      } else {
        this.logger.log(`ℹ️ Not first deposit for user ${userId}`);
      }
      
      return isFirst;

    } catch (error) {
      this.logger.error(`❌ isFirstRealDeposit error: ${error.message}`);
      return false;
    }
  }


  // ✅ FIXED: Better affiliate processing with detailed logging
    private async checkAndProcessAffiliate(userId: string, isFirstDeposit: boolean) {
    if (!isFirstDeposit) {
      this.logger.debug(`ℹ️ Not first deposit for ${userId}, skipping affiliate check`);
      return;
    }

    const db = this.firebaseService.getFirestore();

    try {
      this.logger.log(`🔍 Checking affiliate record for user ${userId}...`);

      // Get affiliate record
      const affiliateSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
        .where('referee_id', '==', userId)
        .where('status', '==', AFFILIATE_STATUS.PENDING)
        .limit(1)
        .get();

      if (affiliateSnapshot.empty) {
        this.logger.log(`ℹ️ No pending affiliate record found for ${userId}`);
        return;
      }

      const affiliateDoc = affiliateSnapshot.docs[0];
      const affiliate = affiliateDoc.data() as Affiliate;

      this.logger.log(`✅ Found affiliate record: ${affiliate.id}`);
      this.logger.log(`   Referrer: ${affiliate.referrer_id}`);
      this.logger.log(`   Referee: ${affiliate.referee_id}`);

      // Get user status
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        this.logger.warn(`⚠️ User ${userId} not found for affiliate processing`);
        return;
      }

      const userData = userDoc.data();
      const userStatus = userData?.status || USER_STATUS.STANDARD;

      // Determine commission based on status
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

      this.logger.log(`💰 Commission to be paid: Rp ${commissionAmount.toLocaleString()}`);
      this.logger.log(`   User status: ${userStatus.toUpperCase()}`);

      const timestamp = new Date().toISOString();

      // Update affiliate record
      await db.collection(COLLECTIONS.AFFILIATES)
        .doc(affiliate.id)
        .update({
          status: AFFILIATE_STATUS.COMPLETED,
          commission_amount: commissionAmount,
          referee_status: userStatus,
          completed_at: timestamp,
          updatedAt: timestamp,
        });

      this.logger.log(`✅ Affiliate record updated to COMPLETED`);

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

      this.logger.log(`✅ Commission balance entry created: ${commissionBalanceId}`);

      // Clear cache
      this.realBalanceCache.delete(affiliate.referrer_id);

      this.logger.log(
        `🎉 AFFILIATE COMMISSION PAID SUCCESSFULLY!\n` +
        `   Referrer: ${affiliate.referrer_id}\n` +
        `   Referee: ${userId} (${userStatus.toUpperCase()})\n` +
        `   Commission: Rp ${commissionAmount.toLocaleString()}\n` +
        `   Balance ID: ${commissionBalanceId}`
      );

    } catch (error) {
      this.logger.error(`❌ Affiliate processing error: ${error.message}`);
      this.logger.error(error.stack);
    }
  }


  private async autoMigrateIfNeeded(userId: string): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();

      const balanceQuery = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .limit(5)
        .get();

      if (balanceQuery.empty) {
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
    }
  }

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

      await this.autoMigrateIfNeeded(userId);

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

      return balance;

    } catch (error) {
      this.logger.error(`❌ getCurrentBalance error: ${error.message}`);
      this.logger.error(error.stack);
      
      return 0;
    }
  }

  async getCurrentBalanceStrict(
    userId: string,
    accountType: 'real' | 'demo'
  ): Promise<number> {
    return this.getCurrentBalance(userId, accountType, true);
  }

  async getBothBalances(userId: string): Promise<BalanceSummary> {
    try {
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

    } catch (error) {
      this.logger.error(`❌ getBothBalances error: ${error.message}`);
      this.logger.error(error.stack);
      
      return {
        realBalance: 0,
        demoBalance: 10000000,
        realTransactions: 0,
        demoTransactions: 1,
      };
    }
  }

  /**
   * ✅ CRITICAL FIX: Atomic balance entry dengan proper affiliate processing
   */
    async createBalanceEntry(
    userId: string, 
    createBalanceDto: CreateBalanceDto, 
    critical = true
  ) {
    const startTime = Date.now();
    const { accountType, amount, type } = createBalanceDto;
    const lockKey = `${userId}_${accountType}`;
    
    try {
      if (accountType !== BALANCE_ACCOUNT_TYPE.REAL && accountType !== BALANCE_ACCOUNT_TYPE.DEMO) {
        throw new BadRequestException('Invalid account type. Must be "real" or "demo"');
      }

      await this.acquireTransactionLock(userId, accountType);
      
      const operationPromise = (async () => {
        try {
          await this.autoMigrateIfNeeded(userId);

          const db = this.firebaseService.getFirestore();
          
          // ✅ CRITICAL FIX: Check first deposit SEBELUM create entry
          let isFirstDeposit = false;
          
          if (accountType === BALANCE_ACCOUNT_TYPE.REAL && type === BALANCE_TYPES.DEPOSIT) {
            isFirstDeposit = await this.isFirstRealDeposit(userId);
            
            if (isFirstDeposit) {
              this.logger.log(`🎯 THIS IS FIRST REAL DEPOSIT for user ${userId}!`);
            }
          }
          
          // Handle withdrawal with transaction
          if (type === BALANCE_TYPES.WITHDRAWAL) {
            await db.runTransaction(async (transaction) => {
              const balanceSnapshot = await transaction.get(
                db.collection(COLLECTIONS.BALANCE)
                  .where('user_id', '==', userId)
                  .where('accountType', '==', accountType)
              );

              const transactions = balanceSnapshot.docs.map(doc => doc.data() as Balance);
              const currentBalance = CalculationUtil.calculateBalance(transactions);

              if (currentBalance < amount) {
                throw new BadRequestException(
                  `Insufficient ${accountType} balance. Available: ${currentBalance}, Required: ${amount}`
                );
              }

              const balanceId = db.collection(COLLECTIONS.BALANCE).doc().id;
              const balanceData = {
                id: balanceId,
                user_id: userId,
                accountType,
                type: BALANCE_TYPES.WITHDRAWAL,
                amount,
                description: createBalanceDto.description || '',
                createdAt: new Date().toISOString(),
              };

              const balanceRef = db.collection(COLLECTIONS.BALANCE).doc(balanceId);
              transaction.set(balanceRef, balanceData);
            });

            this.logger.log(`✅ Withdrawal completed: ${userId} - ${accountType} - ${amount}`);

          } else {
            // ✅ CREATE DEPOSIT ENTRY
            const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
            const balanceData = {
              id: balanceId,
              user_id: userId,
              accountType,
              type,
              amount,
              description: createBalanceDto.description || '',
              createdAt: new Date().toISOString(),
            };

            // ✅ SAVE DEPOSIT FIRST
            await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData);

            this.logger.log(`✅ Balance entry created: ${balanceId}`);

            // ✅ CRITICAL FIX: Process affiliate AFTER entry created
            if (isFirstDeposit) {
              this.logger.log(`🎁 Processing affiliate commission for first deposit...`);
              
              // ✅ ADD DELAY to ensure database consistency
              await new Promise(resolve => setTimeout(resolve, 500));
              
              await this.checkAndProcessAffiliate(userId, true);
            }

            // Update user status if real deposit
            if (accountType === BALANCE_ACCOUNT_TYPE.REAL && type === BALANCE_TYPES.DEPOSIT) {
              if (this.userStatusService) {
                try {
                  await this.userStatusService.updateUserStatus(userId);
                } catch (error) {
                  this.logger.warn(`⚠️ Status update failed: ${error.message}`);
                }
              }
            }
          }

          // Invalidate cache
          this.invalidateCache(userId, accountType);

          // Wait for cache to clear
          await new Promise(resolve => setTimeout(resolve, 100));

          // Get updated balance
          const currentBalance = await this.getCurrentBalance(userId, accountType, true);

          const duration = Date.now() - startTime;
          
          this.logger.log(
            `✅ Balance ${type} completed in ${duration}ms: ${userId} - ${accountType} - ${amount} (New: ${currentBalance})`
          );

          return {
            message: `${accountType} balance ${type} recorded successfully`,
            transaction: {
              user_id: userId,
              accountType,
              type,
              amount,
            },
            currentBalance,
            accountType,
            affiliateProcessed: isFirstDeposit,
            executionTime: duration,
          };

        } finally {
          this.releaseTransactionLock(userId, accountType);
        }
      })();

      this.setTransactionLock(userId, accountType, operationPromise);

      return await operationPromise;

    } catch (error) {
      this.logger.error(`❌ createBalanceEntry error: ${error.message}`);
      
      this.releaseTransactionLock(userId, accountType);
      
      throw error;
    }
  }


  async getBalanceHistory(
    userId: string, 
    queryDto: QueryBalanceDto,
    accountType?: 'real' | 'demo'
  ) {
    try {
      await this.autoMigrateIfNeeded(userId);

      const { page = 1, limit = 20 } = queryDto;
      const db = this.firebaseService.getFirestore();
      
      try {
        let query = db.collection(COLLECTIONS.BALANCE)
          .where('user_id', '==', userId);

        if (accountType) {
          query = query.where('accountType', '==', accountType) as any;
        }

        const snapshot = await query.get();
        
        let allTransactions = snapshot.docs.map(doc => doc.data() as Balance);
        
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

    for (const [lockKey, lockData] of this.transactionLocks.entries()) {
      const age = now - lockData.startTime;
      if (age > this.LOCK_TIMEOUT) {
        this.transactionLocks.delete(lockKey);
        this.logger.warn(`⚠️ Cleaned up stale transaction lock: ${lockKey} (age: ${age}ms)`);
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
      activeLocks: this.transactionLocks.size,
      lockTimeout: this.LOCK_TIMEOUT,
    };
  }
}