// src/balance/balance.service.ts

import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE, AFFILIATE_STATUS, AFFILIATE_CONFIG, USER_STATUS, WITHDRAWAL_STATUS, WITHDRAWAL_CONFIG } from '../common/constants';
import { CalculationUtil } from '../common/utils';
import { Balance, BalanceSummary, Affiliate, User, WithdrawalRequest } from '../common/interfaces';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);
  
  private realBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private demoBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  private readonly BALANCE_CACHE_TTL = 500;
  
  private userStatusService: any;

  private transactionLocks: Map<string, { promise: Promise<any>; startTime: number }> = new Map();
  private readonly LOCK_TIMEOUT = 30000;

  private writeStats = { 
    success: 0, 
    failed: 0, 
    queued: 0,
    lastSuccessTime: Date.now() 
  };
  
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 200;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;

  constructor(
    private firebaseService: FirebaseService,
  ) {
    setInterval(() => this.cleanupCache(), 30000);
  }

  setUserStatusService(service: any) {
    this.userStatusService = service;
  }

  async requestWithdrawal(userId: string, amount: number, description?: string) {
    const db = this.firebaseService.getFirestore();

    try {
      if (amount < WITHDRAWAL_CONFIG.MIN_AMOUNT) {
        throw new BadRequestException(
          `Minimum withdrawal amount is Rp ${WITHDRAWAL_CONFIG.MIN_AMOUNT.toLocaleString()}`
        );
      }

      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      const profile = user.profile || {};

      if (!profile.identityDocument?.isVerified) {
        throw new BadRequestException(
          'KTP/Identity verification required. Please upload and verify your KTP first.'
        );
      }

      if (!profile.selfieVerification?.isVerified) {
        throw new BadRequestException(
          'Selfie verification required. Please upload and verify your selfie first.'
        );
      }

      if (!profile.bankAccount?.accountNumber) {
        throw new BadRequestException(
          'Bank account required. Please add your bank account details first.'
        );
      }

      const currentBalance = await this.getCurrentBalance(userId, BALANCE_ACCOUNT_TYPE.REAL, true);
      
      if (currentBalance < amount) {
        throw new BadRequestException(
          `Insufficient balance. Available: Rp ${currentBalance.toLocaleString()}, Requested: Rp ${amount.toLocaleString()}`
        );
      }

      const pendingWithdrawal = await db.collection(COLLECTIONS.WITHDRAWAL_REQUESTS)
        .where('user_id', '==', userId)
        .where('status', '==', WITHDRAWAL_STATUS.PENDING)
        .limit(1)
        .get();

      if (!pendingWithdrawal.empty) {
        throw new BadRequestException(
          'You already have a pending withdrawal request. Please wait for admin approval.'
        );
      }

      const requestId = await this.firebaseService.generateId(COLLECTIONS.WITHDRAWAL_REQUESTS);
      const timestamp = new Date().toISOString();

      const withdrawalRequest: WithdrawalRequest = {
        id: requestId,
        user_id: userId,
        amount,
        status: WITHDRAWAL_STATUS.PENDING,
        description: description || 'Withdrawal request',
        
        userEmail: user.email,
        userName: profile.fullName,
        bankAccount: {
          bankName: profile.bankAccount.bankName!,
          accountNumber: profile.bankAccount.accountNumber!,
          accountHolderName: profile.bankAccount.accountHolderName!,
        },
        
        ktpVerified: true,
        selfieVerified: true,
        currentBalance,
        
        createdAt: timestamp,
      };

      await db.collection(COLLECTIONS.WITHDRAWAL_REQUESTS).doc(requestId).set(withdrawalRequest);

      this.logger.log(
        `✅ Withdrawal request created: ${requestId} - User: ${userId} - Amount: Rp ${amount.toLocaleString()}`
      );

      return {
        message: 'Withdrawal request submitted successfully. Waiting for admin approval.',
        request: {
          id: requestId,
          amount,
          status: WITHDRAWAL_STATUS.PENDING,
          bankAccount: {
            bankName: profile.bankAccount.bankName,
            accountNumber: this.maskBankAccount(profile.bankAccount.accountNumber),
            accountHolderName: profile.bankAccount.accountHolderName,
          },
          estimatedProcess: '1-2 business days',
          requirements: {
            minAmount: `Rp ${WITHDRAWAL_CONFIG.MIN_AMOUNT.toLocaleString()}`,
            ktpVerified: '✅ Verified',
            selfieVerified: '✅ Verified',
            bankAccount: '✅ Added',
          },
          createdAt: timestamp,
        },
      };

    } catch (error) {
      this.logger.error(`❌ requestWithdrawal error: ${error.message}`);
      throw error;
    }
  }

  async getMyWithdrawalRequests(userId: string) {
    const db = this.firebaseService.getFirestore();

    try {
      const snapshot = await db.collection(COLLECTIONS.WITHDRAWAL_REQUESTS)
        .where('user_id', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      const requests = snapshot.docs.map(doc => {
        const data = doc.data() as WithdrawalRequest;
        return {
          ...data,
          bankAccount: data.bankAccount ? {
            ...data.bankAccount,
            accountNumber: this.maskBankAccount(data.bankAccount.accountNumber),
          } : undefined,
        };
      });

      return {
        requests,
        summary: {
          total: requests.length,
          pending: requests.filter(r => r.status === WITHDRAWAL_STATUS.PENDING).length,
          approved: requests.filter(r => r.status === WITHDRAWAL_STATUS.APPROVED).length,
          rejected: requests.filter(r => r.status === WITHDRAWAL_STATUS.REJECTED).length,
          completed: requests.filter(r => r.status === WITHDRAWAL_STATUS.COMPLETED).length,
        },
      };

    } catch (error) {
      this.logger.error(`❌ getMyWithdrawalRequests error: ${error.message}`);
      throw error;
    }
  }

  async cancelWithdrawalRequest(userId: string, requestId: string) {
    const db = this.firebaseService.getFirestore();

    try {
      const requestDoc = await db.collection(COLLECTIONS.WITHDRAWAL_REQUESTS).doc(requestId).get();
      
      if (!requestDoc.exists) {
        throw new NotFoundException('Withdrawal request not found');
      }

      const request = requestDoc.data() as WithdrawalRequest;

      if (request.user_id !== userId) {
        throw new BadRequestException('Unauthorized to cancel this request');
      }

      if (request.status !== WITHDRAWAL_STATUS.PENDING) {
        throw new BadRequestException(
          `Cannot cancel request with status: ${request.status}`
        );
      }

      await db.collection(COLLECTIONS.WITHDRAWAL_REQUESTS).doc(requestId).delete();

      this.logger.log(`✅ Withdrawal request cancelled: ${requestId}`);

      return {
        message: 'Withdrawal request cancelled successfully',
      };

    } catch (error) {
      this.logger.error(`❌ cancelWithdrawalRequest error: ${error.message}`);
      throw error;
    }
  }

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

      if (type === BALANCE_TYPES.WITHDRAWAL && accountType === BALANCE_ACCOUNT_TYPE.REAL) {
        throw new BadRequestException(
          'Direct withdrawal not allowed for real account. Please use withdrawal request endpoint: POST /balance/withdrawal/request'
        );
      }

      if (type === BALANCE_TYPES.DEPOSIT && accountType === BALANCE_ACCOUNT_TYPE.REAL) {
        throw new BadRequestException(
          'Direct deposit not allowed for real account. Please use Midtrans payment: POST /payment/deposit'
        );
      }

      await this.acquireTransactionLock(userId, accountType);
      
      const operationPromise = (async () => {
        try {
          await this.autoMigrateIfNeeded(userId);

          const db = this.firebaseService.getFirestore();
          
          let affiliateInfo: {
            hasPending: boolean;
            affiliateId?: string;
            referrerId?: string;
            currentTotalDeposit: number;
            futureStatus: string;
            commissionAmount: number;
            isFirstDeposit: boolean;
          } = {
            hasPending: false,
            affiliateId: undefined,
            referrerId: undefined,
            currentTotalDeposit: 0,
            futureStatus: USER_STATUS.STANDARD,
            commissionAmount: 0,
            isFirstDeposit: false,
          };
          
          if (accountType === BALANCE_ACCOUNT_TYPE.REAL && type === BALANCE_TYPES.DEPOSIT) {
            affiliateInfo = await this.hasPendingAffiliateAndCalculateCommission(userId, amount);
            
            if (affiliateInfo.hasPending) {
              this.logger.log(`🎯 REAL DEPOSIT + PENDING AFFILIATE detected!`);
              this.logger.log(`   Current deposits: Rp ${affiliateInfo.currentTotalDeposit.toLocaleString()}`);
              this.logger.log(`   This deposit: Rp ${amount.toLocaleString()}`);
              this.logger.log(`   Total after: Rp ${(affiliateInfo.currentTotalDeposit + amount).toLocaleString()}`);
              this.logger.log(`   Future status: ${affiliateInfo.futureStatus.toUpperCase()}`);
              this.logger.log(`   Commission: Rp ${affiliateInfo.commissionAmount.toLocaleString()}`);
              this.logger.log(`   Is first deposit: ${affiliateInfo.isFirstDeposit ? 'YES ✅' : 'NO ⚠️'}`);
              
              if (!affiliateInfo.isFirstDeposit) {
                this.logger.warn(`⚠️ WARNING: Affiliate is PENDING but deposits already exist!`);
                this.logger.warn(`   This might indicate a data inconsistency`);
              }
            } else {
              this.logger.log(`ℹ️ No pending affiliate or already completed`);
            }
          }
          
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

            await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData);

            this.logger.log(`✅ Balance entry created: ${balanceId}`);

            if (accountType === BALANCE_ACCOUNT_TYPE.REAL && type === BALANCE_TYPES.DEPOSIT) {
              if (this.userStatusService) {
                try {
                  const statusUpdate = await this.userStatusService.updateUserStatus(userId);
                  
                  if (statusUpdate.changed) {
                    this.logger.log(
                      `🎉 User status upgraded: ${statusUpdate.oldStatus.toUpperCase()} → ${statusUpdate.newStatus.toUpperCase()}`
                    );
                  }
                } catch (error) {
                  this.logger.warn(`⚠️ Status update failed: ${error.message}`);
                }
              }
            }

            if (affiliateInfo.hasPending && affiliateInfo.affiliateId && affiliateInfo.referrerId) {
              await this.processAffiliate(
                userId,
                affiliateInfo.affiliateId,
                affiliateInfo.referrerId,
                affiliateInfo.futureStatus,
                affiliateInfo.commissionAmount
              );
            }
          }

          this.invalidateAllUserCaches(userId);

          await new Promise(resolve => setTimeout(resolve, 100));

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
            affiliateProcessed: affiliateInfo.hasPending,
            affiliateCommission: affiliateInfo.hasPending ? affiliateInfo.commissionAmount : 0,
            executionTime: duration,
          };

        } finally {
          this.releaseTransactionLock(userId, accountType);
        }
      })();

      this.setTransactionLock(userId, accountType, operationPromise);

      return await operationPromise;

    } catch (error) {
      this.logger.error(`❌ createBalanceEntry error: ${error.message}`, error.stack);
      
      this.releaseTransactionLock(userId, accountType);
      
      throw error;
    }
  }

  clearUserCache(userId: string): void {
    this.invalidateAllUserCaches(userId);
  }

  private invalidateCache(userId: string, accountType: 'real' | 'demo'): void {
    if (accountType === BALANCE_ACCOUNT_TYPE.REAL) {
      this.realBalanceCache.delete(userId);
    } else {
      this.demoBalanceCache.delete(userId);
    }
  }

  private invalidateAllUserCaches(userId: string): void {
    this.realBalanceCache.delete(userId);
    this.demoBalanceCache.delete(userId);
    
    if (this.userStatusService) {
      this.userStatusService.clearUserCache(userId);
    }
    
    this.logger.debug(`🗑️ Cleared all caches for user ${userId}`);
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

  private async hasPendingAffiliateAndCalculateCommission(
    userId: string, 
    depositAmount: number
  ): Promise<{
    hasPending: boolean;
    affiliateId?: string;
    referrerId?: string;
    currentTotalDeposit: number;
    futureStatus: string;
    commissionAmount: number;
    isFirstDeposit: boolean;
  }> {
    try {
      const db = this.firebaseService.getFirestore();
      
      const affiliateSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
        .where('referee_id', '==', userId)
        .where('status', '==', AFFILIATE_STATUS.PENDING)
        .limit(1)
        .get();

      if (affiliateSnapshot.empty) {
        const completedSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
          .where('referee_id', '==', userId)
          .where('status', '==', AFFILIATE_STATUS.COMPLETED)
          .limit(1)
          .get();

        if (!completedSnapshot.empty) {
          this.logger.log(`ℹ️ User ${userId} already has COMPLETED affiliate`);
        } else {
          this.logger.log(`ℹ️ No affiliate record for user ${userId}`);
        }

        return {
          hasPending: false,
          currentTotalDeposit: 0,
          futureStatus: USER_STATUS.STANDARD,
          commissionAmount: 0,
          isFirstDeposit: false,
        };
      }

      const affiliateDoc = affiliateSnapshot.docs[0];
      const affiliate = affiliateDoc.data() as Affiliate;

      this.logger.log(`✅ Found PENDING affiliate for user ${userId}`);
      this.logger.log(`   Affiliate ID: ${affiliate.id}`);
      this.logger.log(`   Referrer: ${affiliate.referrer_id}`);

      const balanceSnapshot = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .where('accountType', '==', BALANCE_ACCOUNT_TYPE.REAL)
        .where('type', '==', BALANCE_TYPES.DEPOSIT)
        .get();

      let currentTotalDeposit = 0;
      balanceSnapshot.forEach(doc => {
        const data = doc.data() as Balance;
        currentTotalDeposit += data.amount;
      });

      const isFirstDeposit = currentTotalDeposit === 0;
      
      if (!isFirstDeposit) {
        this.logger.warn(`⚠️ WARNING: Found PENDING affiliate but user already has deposits!`);
        this.logger.warn(`   Current deposits: Rp ${currentTotalDeposit.toLocaleString()}`);
      }

      this.logger.log(`   Current total deposit: Rp ${currentTotalDeposit.toLocaleString()}`);
      this.logger.log(`   This deposit amount: Rp ${depositAmount.toLocaleString()}`);
      this.logger.log(`   Is first deposit: ${isFirstDeposit ? 'YES ✅' : 'NO ⚠️'}`);

      const totalAfterDeposit = currentTotalDeposit + depositAmount;
      const futureStatus = this.determineFutureStatus(totalAfterDeposit);
      
      this.logger.log(`   Total AFTER deposit: Rp ${totalAfterDeposit.toLocaleString()}`);
      
      let commissionAmount: number;
      switch (futureStatus.toUpperCase()) {
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

      this.logger.log(`   Future status after deposit: ${futureStatus.toUpperCase()}`);
      this.logger.log(`   Commission to be paid: Rp ${commissionAmount.toLocaleString()}`);
      this.logger.log(`   📌 After payment, status → COMPLETED (no more commission)`);

      return {
        hasPending: true,
        affiliateId: affiliate.id,
        referrerId: affiliate.referrer_id,
        currentTotalDeposit,
        futureStatus,
        commissionAmount,
        isFirstDeposit,
      };

    } catch (error) {
      this.logger.error(`❌ hasPendingAffiliateAndCalculateCommission error: ${error.message}`, error.stack);
      return {
        hasPending: false,
        currentTotalDeposit: 0,
        futureStatus: USER_STATUS.STANDARD,
        commissionAmount: 0,
        isFirstDeposit: false,
      };
    }
  }

  private determineFutureStatus(totalDeposit: number): string {
    if (totalDeposit >= 1600000) return USER_STATUS.VIP;
    if (totalDeposit >= 160000) return USER_STATUS.GOLD;
    return USER_STATUS.STANDARD;
  }

  private async processAffiliate(
    userId: string,
    affiliateId: string,
    referrerId: string,
    futureStatus: string,
    commissionAmount: number
  ) {
    const db = this.firebaseService.getFirestore();

    try {
      this.logger.log(`🎁 Processing affiliate commission...`);
      this.logger.log(`   Affiliate ID: ${affiliateId}`);
      this.logger.log(`   Referrer: ${referrerId}`);
      this.logger.log(`   Referee: ${userId}`);
      this.logger.log(`   Referee Status: ${futureStatus.toUpperCase()}`);
      this.logger.log(`   Commission: Rp ${commissionAmount.toLocaleString()}`);

      const timestamp = new Date().toISOString();

      const affiliateDoc = await db.collection(COLLECTIONS.AFFILIATES).doc(affiliateId).get();
      
      if (!affiliateDoc.exists) {
        this.logger.error(`❌ Affiliate ${affiliateId} not found!`);
        return;
      }

      const affiliateData = affiliateDoc.data() as Affiliate;
      
      if (affiliateData.status !== AFFILIATE_STATUS.PENDING) {
        this.logger.warn(`⚠️ Affiliate ${affiliateId} is already ${affiliateData.status}!`);
        this.logger.warn(`   Skipping commission payment to prevent double-pay`);
        return;
      }

      await db.collection(COLLECTIONS.AFFILIATES)
        .doc(affiliateId)
        .update({
          status: AFFILIATE_STATUS.COMPLETED,
          commission_amount: commissionAmount,
          referee_status: futureStatus,
          completed_at: timestamp,
          updatedAt: timestamp,
        });

      this.logger.log(`✅ Affiliate record updated: PENDING → COMPLETED`);
      this.logger.log(`   📌 This user will NOT trigger commission again!`);

      const commissionBalanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
      
      await db.collection(COLLECTIONS.BALANCE).doc(commissionBalanceId).set({
        id: commissionBalanceId,
        user_id: referrerId,
        accountType: BALANCE_ACCOUNT_TYPE.REAL,
        type: BALANCE_TYPES.DEPOSIT,
        amount: commissionAmount,
        description: `Affiliate commission - Friend deposit (${futureStatus.toUpperCase()} level)`,
        createdAt: timestamp,
      });

      this.logger.log(`✅ Commission deposited to REAL account: ${commissionBalanceId}`);

      this.invalidateAllUserCaches(referrerId);

      this.logger.log(
        `🎉 AFFILIATE COMMISSION PAID SUCCESSFULLY!\n` +
        `   Referrer: ${referrerId} (+Rp ${commissionAmount.toLocaleString()} to REAL balance)\n` +
        `   Referee: ${userId} (${futureStatus.toUpperCase()})\n` +
        `   Status: PENDING → COMPLETED ✅\n` +
        `   📌 Future deposits from ${userId} will NOT trigger commission`
      );

    } catch (error) {
      this.logger.error(`❌ Affiliate processing error: ${error.message}`, error.stack);
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
      this.logger.error(`❌ Auto-migration error for user ${userId}: ${error.message}`, error.stack);
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
      this.logger.error(`❌ getCurrentBalance error: ${error.message}`, error.stack);
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
      this.logger.error(`❌ getBothBalances error: ${error.message}`, error.stack);
      
      return {
        realBalance: 0,
        demoBalance: 10000000,
        realTransactions: 0,
        demoTransactions: 1,
      };
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
        this.logger.error(`❌ Balance history query error: ${queryError.message}`, queryError.stack);
        
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
      this.logger.error(`❌ getBalanceHistory error: ${error.message}`, error.stack);
      
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
          .filter(t => 
            t.type === BALANCE_TYPES.DEPOSIT && 
            t.description && 
            t.description.toLowerCase().includes('affiliate commission')
          )
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
      this.logger.error(`❌ getBalanceSummary error: ${error.message}`, error.stack);
      
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
    this.invalidateAllUserCaches(userId);
    return this.getCurrentBalance(userId, accountType, true);
  }

  private maskBankAccount(accountNumber?: string): string {
    if (!accountNumber) return '****';
    if (accountNumber.length <= 4) return '****';
    
    const visible = accountNumber.slice(-4);
    const masked = '*'.repeat(accountNumber.length - 4);
    return masked + visible;
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