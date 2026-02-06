// src/order-schedule/order-schedule-executor.service.ts
// ✅ VERSI FINAL - MARTINGALE PER WAKTU (INDEPENDENT)
// Setiap scheduledTime punya state martingale sendiri-sendiri

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Firestore } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service';
import { OrderScheduleService } from './order-schedule.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { AssetsService } from '../assets/assets.service';
import { ScheduleStatus, TrendType } from './dto/create-order-schedule.dto';
import { OrderSchedule, ScheduleExecution } from './entities/order-schedule.entity';

@Injectable()
export class OrderScheduleExecutorService {
  private readonly logger = new Logger(OrderScheduleExecutorService.name);
  
  private readonly schedulesCollection = 'order_schedules';
  private readonly executionsCollection = 'schedule_executions';
  private readonly ordersCollection = 'binary_orders';
  private readonly assetsCollection = 'assets';

  private isProcessingSchedules = false;
  private isCheckingResults = false;
  
  // ✅ Track processed schedules untuk avoid duplicate
  // Key: "scheduleId:scheduledTime" (e.g., "abc123:09:00")
  // Ini memastikan setiap kombinasi schedule+time di-track terpisah
  private processedToday: Set<string> = new Set();
  
  private checkResultsRunCount = 0;
  private processSchedulesRunCount = 0;

  constructor(
    private firebaseService: FirebaseService,
    private orderScheduleService: OrderScheduleService,
    private priceFetcherService: PriceFetcherService,
    private assetsService: AssetsService,
  ) {
    this.logger.log('✅ OrderScheduleExecutorService initialized');
    this.logger.log('🎯 MARTINGALE MODE: Independent per scheduled time');
    this.logger.log('📝 Example:');
    this.logger.log('   - 09:00 LOSS → 09:00 step 1 (amount 20k)');
    this.logger.log('   - 10:00 WIN  → 10:00 step 0 (amount 10k) ← independent!');
    this.logger.log('   - 14:00 LOSS → 14:00 step 1 (amount 20k) ← independent!');
    this.logger.log('🔧 Features: 10s check, missed recovery, retry mechanism');
    
    this.resetProcessedDaily();
  }

  private get db(): Firestore {
    return this.firebaseService.getFirestore();
  }

  // ============================================================================
  // CRON: Check scheduled orders setiap 10 detik
  // ============================================================================

  @Cron('*/10 * * * * *')
  async handleScheduledOrders() {
    if (this.isProcessingSchedules) {
      if (this.processSchedulesRunCount % 60 === 0) {
        this.logger.warn('⏭️ Skipping - previous execution still running');
      }
      this.processSchedulesRunCount++;
      return;
    }

    this.isProcessingSchedules = true;

    try {
      if (this.processSchedulesRunCount % 6 === 0) {
        this.logger.debug(`🔍 Checking scheduled orders (run #${this.processSchedulesRunCount})...`);
      }

      const currentTime = this.getCurrentTime();
      const activeSchedules = await this.getActiveSchedules();

      if (activeSchedules.length > 0) {
        this.logger.log(`📊 Found ${activeSchedules.length} active schedules at ${currentTime}`);
      }

      for (const schedule of activeSchedules) {
        await this.processSchedule(schedule, currentTime);
      }

      // ✅ Recover missed schedules dalam 5 menit terakhir
      await this.recoverMissedSchedules(currentTime);

      this.processSchedulesRunCount++;
    } catch (error) {
      this.logger.error(`❌ Error in handleScheduledOrders: ${error.message}`, error.stack);
    } finally {
      this.isProcessingSchedules = false;
    }
  }

  // ============================================================================
  // RECOVERY untuk Missed Schedules
  // ============================================================================

  private async recoverMissedSchedules(currentTime: string) {
    try {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      
      const activeSchedules = await this.getActiveSchedules();
      
      for (const schedule of activeSchedules) {
        for (const scheduledOrder of schedule.schedules) {
          const scheduleTime = this.parseTimeToDate(scheduledOrder.time);
          
          if (scheduleTime > fiveMinutesAgo && scheduleTime < now) {
            const cacheKey = `${schedule.id}:${scheduledOrder.time}`;
            
            if (this.processedToday.has(cacheKey)) {
              continue; // Sudah diproses
            }
            
            const alreadyExecuted = await this.checkAlreadyExecutedToday(
              schedule.id,
              scheduledOrder.time
            );
            
            if (!alreadyExecuted) {
              this.logger.warn(
                `⚠️ Recovering missed schedule: ${schedule.id.slice(-8)} ` +
                `at ${scheduledOrder.time} (${scheduledOrder.trend})`
              );
              
              await this.executeOrder(schedule, scheduledOrder.trend, scheduledOrder.time);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`❌ Error in recoverMissedSchedules: ${error.message}`);
    }
  }

  // ============================================================================
  // CRON: Check order results setiap 10 detik
  // ============================================================================

  @Cron('*/10 * * * * *')
  async checkPendingExecutions() {
    if (this.isCheckingResults) {
      return;
    }

    this.isCheckingResults = true;

    try {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const executionsSnapshot = await this.db
        .collection(this.executionsCollection)
        .where('status', '==', 'executed')
        .where('createdAt', '>=', twoHoursAgo)
        .limit(100)
        .get();

      const pendingExecutions = executionsSnapshot.docs.filter(doc => {
        const data = doc.data();
        return !data.result && data.orderId;
      });

      if (pendingExecutions.length === 0) {
        if (this.checkResultsRunCount % 6 === 0) {
          this.logger.debug(`⏰ Check results #${this.checkResultsRunCount}: No pending executions`);
        }
        this.checkResultsRunCount++;
        this.isCheckingResults = false;
        return;
      }

      this.logger.log(
        `🔍 Checking ${pendingExecutions.length} pending executions for results`
      );

      const batchSize = 10;
      for (let i = 0; i < pendingExecutions.length; i += batchSize) {
        const batch = pendingExecutions.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(async (execDoc) => {
            const execution = execDoc.data() as ScheduleExecution;
            
            try {
              await this.checkOrderResultWithRetry(
                execution.scheduleId,
                execution.orderId!,
                execution.id,
                execution.scheduledTime // ✅ Pass scheduledTime untuk update state yang benar
              );
            } catch (error) {
              this.logger.error(
                `Error checking execution ${execution.id.slice(-8)}: ${error.message}`
              );
            }
          })
        );
      }

      this.checkResultsRunCount++;
      
    } catch (error) {
      this.logger.error(`❌ Error in checkPendingExecutions: ${error.message}`, error.stack);
    } finally {
      this.isCheckingResults = false;
    }
  }

  // ============================================================================
  // Helper: Get Active Schedules
  // ============================================================================

  private async getActiveSchedules(): Promise<OrderSchedule[]> {
    try {
      const snapshot = await this.db
        .collection(this.schedulesCollection)
        .where('status', '==', ScheduleStatus.ACTIVE)
        .where('isActive', '==', true)
        .get();

      return snapshot.docs.map(doc => doc.data() as OrderSchedule);
    } catch (error) {
      this.logger.error(`❌ Error fetching active schedules: ${error.message}`);
      return [];
    }
  }

  // ============================================================================
  // Process 1 Schedule
  // ============================================================================

  private async processSchedule(schedule: OrderSchedule, currentTime: string) {
    try {
      // Check stop loss/profit
      const shouldStop = await this.orderScheduleService.checkStopLossProfit(schedule.id);
      if (shouldStop) {
        this.logger.log(`🛑 Schedule ${schedule.id.slice(-8)} stopped (stop loss/profit)`);
        return;
      }

      // ✅ Filter orders untuk waktu sekarang
      const scheduledOrders = schedule.schedules.filter(s => s.time === currentTime);

      if (scheduledOrders.length === 0) {
        return;
      }

      this.logger.log(
        `📋 Found ${scheduledOrders.length} orders at ${currentTime} ` +
        `for schedule ${schedule.id.slice(-8)}`
      );

      // ✅ Execute setiap scheduled order
      // PENTING: Setiap scheduledOrder.time punya martingale state sendiri!
      for (const scheduledOrder of scheduledOrders) {
        const cacheKey = `${schedule.id}:${scheduledOrder.time}`;
        
        // Check in-memory cache
        if (this.processedToday.has(cacheKey)) {
          this.logger.debug(
            `⏭️ Skipping ${scheduledOrder.time} - already processed (cache) ` +
            `for schedule ${schedule.id.slice(-8)}`
          );
          continue;
        }

        // Check database
        const alreadyExecuted = await this.checkAlreadyExecutedToday(
          schedule.id,
          scheduledOrder.time
        );

        if (alreadyExecuted) {
          this.logger.log(
            `⏭️ Skipping ${scheduledOrder.time} - already executed today ` +
            `for schedule ${schedule.id.slice(-8)}`
          );
          this.processedToday.add(cacheKey);
          continue;
        }

        // ✅ Execute order dengan scheduledTime
        await this.executeOrder(schedule, scheduledOrder.trend, scheduledOrder.time);
        
        // Mark as processed
        this.processedToday.add(cacheKey);
      }
    } catch (error) {
      this.logger.error(
        `❌ Error processing schedule ${schedule.id.slice(-8)}: ${error.message}`,
        error.stack
      );
    }
  }

  // ============================================================================
  // Check if Already Executed Today
  // ============================================================================

  private async checkAlreadyExecutedToday(
    scheduleId: string,
    scheduledTime: string
  ): Promise<boolean> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await this.db
        .collection(this.executionsCollection)
        .where('scheduleId', '==', scheduleId)
        .where('scheduledTime', '==', scheduledTime) // ✅ Filter by scheduledTime
        .get();

      return snapshot.docs.some((doc) => {
        const data = doc.data();
        const executedAt = data.executedAt?.toDate?.() ?? new Date(data.executedAt);
        return executedAt >= today;
      });
    } catch (error) {
      this.logger.error(`Error checking execution history: ${error.message}`);
      return false;
    }
  }

  // ============================================================================
  // ✅ EXECUTE ORDER - dengan Martingale per scheduledTime
  // ============================================================================

  private async executeOrder(
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string // ✅ Key parameter - ini yang menentukan state mana yang dipakai
  ) {
    const executionId = uuidv4();
    const maxRetries = 3;
    let lastError: Error | null = null;

    this.logger.log(
      `🚀 Executing order for schedule ${schedule.id.slice(-8)} ` +
      `at ${scheduledTime}, trend: ${trend.toUpperCase()}`
    );

    // ✅ Retry mechanism
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // ✅ CRITICAL: Get martingale state untuk scheduledTime ini
        // Setiap scheduledTime punya state terpisah!
        const orderState = this.orderScheduleService.getOrderMartingaleState(
          schedule, 
          scheduledTime
        );
        
        this.logger.log(
          `📊 Order ${scheduledTime} martingale state:` +
          ` Step=${orderState.currentStep},` +
          ` ConsecutiveLosses=${orderState.consecutiveLosses},` +
          ` LastResult=${orderState.lastResult || 'none'}`
        );
        
        // ✅ Calculate amount berdasarkan step untuk waktu INI
        const amount = this.orderScheduleService.calculateMartingaleAmount(
          schedule.amount,
          orderState.currentStep,
          schedule.martingaleSetting.multiplier
        );

        this.logger.log(
          `💰 Amount calculation for ${scheduledTime}:` +
          ` Base=${schedule.amount},` +
          ` Step=${orderState.currentStep},` +
          ` Multiplier=${schedule.martingaleSetting.multiplier}` +
          ` → Final=${amount.toLocaleString()}`
        );

        // Check balance untuk real account
        if (schedule.accountType === 'real') {
          const hasBalance = await this.checkUserBalance(schedule.userId, amount);
          
          if (!hasBalance) {
            this.logger.warn(
              `⚠️ Insufficient balance for ${scheduledTime}: ` +
              `required ${amount.toLocaleString()}`
            );
            
            await this.recordExecution(
              executionId,
              schedule,
              trend,
              scheduledTime,
              amount,
              orderState.currentStep,
              'failed',
              'Insufficient balance'
            );
            return;
          }
        }

        // ✅ Create order
        let orderId: string;
        try {
          orderId = await this.createBinaryOrderWithVerification(
            schedule, 
            trend, 
            amount, 
            scheduledTime
          );
          
          this.logger.log(
            `✅ Order created for ${scheduledTime}: ${orderId.slice(-8)}`
          );
        } catch (createError) {
          this.logger.error(
            `❌ Failed to create order (attempt ${attempt + 1}/${maxRetries}): ` +
            `${createError.message}`
          );
          
          if (attempt < maxRetries - 1) {
            const delay = 2000 * Math.pow(2, attempt);
            this.logger.log(`⏳ Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          throw createError;
        }

        // ✅ Record execution dengan scheduledTime
        try {
          await this.recordExecution(
            executionId,
            schedule,
            trend,
            scheduledTime, // ✅ Important: simpan scheduledTime
            amount,
            orderState.currentStep,
            'executed',
            undefined,
            orderId
          );
          
          this.logger.log(
            `✅ Execution recorded for ${scheduledTime}: ${executionId.slice(-8)}`
          );
        } catch (recordError) {
          this.logger.error(`❌ Failed to record execution: ${recordError.message}`);
          throw recordError;
        }

        this.logger.log(
          `✅ Order ${orderId.slice(-8)} executed successfully ` +
          `for ${scheduledTime} at step ${orderState.currentStep}`
        );
        
        return; // Success
        
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries - 1) {
          const delay = 2000 * Math.pow(2, attempt);
          this.logger.warn(
            `⚠️ Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`
          );
          this.logger.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // ✅ All retries failed
    this.logger.error(
      `❌ CRITICAL: Failed after ${maxRetries} attempts ` +
      `for ${scheduledTime}: ${lastError?.message}`
    );

    try {
      const orderState = this.orderScheduleService.getOrderMartingaleState(
        schedule, 
        scheduledTime
      );
      
      await this.recordExecution(
        executionId,
        schedule,
        trend,
        scheduledTime,
        schedule.amount,
        orderState.currentStep,
        'failed',
        `Failed after ${maxRetries} retries: ${lastError?.message}`
      );
    } catch (recordError) {
      this.logger.error(`❌ Failed to record failed execution: ${recordError.message}`);
    }
  }

  // ============================================================================
  // Create Binary Order
  // ============================================================================

  private async getAssetName(assetSymbol: string): Promise<string> {
    try {
      const assetDoc = await this.db
        .collection(this.assetsCollection)
        .where('symbol', '==', assetSymbol)
        .limit(1)
        .get();
      
      if (!assetDoc.empty) {
        const assetData = assetDoc.docs[0].data();
        return assetData.name || assetSymbol;
      }
    } catch (error) {
      this.logger.warn(`⚠️ Error fetching asset name: ${error.message}`);
    }
    
    return assetSymbol;
  }

  private async createBinaryOrderWithVerification(
    schedule: OrderSchedule,
    trend: TrendType,
    amount: number,
    scheduledTime: string
  ): Promise<string> {
    const orderId = uuidv4();
    const now = new Date();

    const assetName = schedule.assetName || await this.getAssetName(schedule.assetSymbol);

    let entryPrice = 0;
    let assetId: string | null = null;
    let assetData: any = null;

    try {
      const assetSnapshot = await this.db
        .collection(this.assetsCollection)
        .where('symbol', '==', schedule.assetSymbol)
        .limit(1)
        .get();
      
      if (!assetSnapshot.empty) {
        assetData = assetSnapshot.docs[0].data();
        assetId = assetSnapshot.docs[0].id;
        
        try {
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(
            assetData, 
            true
          );
          
          if (priceData && priceData.price) {
            entryPrice = priceData.price;
            this.logger.log(
              `💰 Entry price for ${scheduledTime}: ${entryPrice}`
            );
          }
        } catch (priceError) {
          this.logger.warn(`⚠️ Could not fetch realtime price: ${priceError.message}`);
          entryPrice = assetData.simulatorSettings?.initialPrice || 
                       assetData.initialPrice || 0;
        }
      } else {
        throw new Error(`Asset ${schedule.assetSymbol} not found`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to fetch asset info: ${error.message}`);
      throw error;
    }

    const durationInMinutes = schedule.duration / 60;
    const direction = trend === 'buy' ? 'CALL' : 'PUT';
    const expiryTime = new Date(now.getTime() + schedule.duration * 1000);

    // Get current step untuk metadata
    const orderState = this.orderScheduleService.getOrderMartingaleState(
      schedule, 
      scheduledTime
    );

    const order = {
      id: orderId,
      user_id: schedule.userId,
      asset_id: assetId,
      asset_symbol: schedule.assetSymbol,
      asset_name: assetName,
      
      accountType: schedule.accountType,
      direction: direction,
      amount: amount,
      duration: durationInMinutes,
      
      entry_price: entryPrice || 0,
      entry_time: now.toISOString(),
      
      exit_price: null,
      exit_time: expiryTime.toISOString(),
      
      status: 'ACTIVE',
      
      profit: null,
      result: null,
      
      is_scheduled: true,
      schedule_id: schedule.id,
      scheduled_time: scheduledTime, // ✅ Save scheduledTime
      
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      
      profitRate: assetData?.profitRate || 85,
      baseProfitRate: assetData?.profitRate || 85,
      statusBonus: 0,
      userStatus: 'standard',
      
      metadata: {
        isScheduled: true,
        scheduledAt: now.toISOString(),
        scheduledTime: scheduledTime, // ✅ Important untuk identify state
        martingaleStep: orderState.currentStep,
        originalTrend: trend,
      }
    };

    try {
      this.logger.log(`📝 Writing order ${orderId.slice(-8)} to Firestore...`);
      
      await this.db.collection(this.ordersCollection).doc(orderId).set(order);
      
      const verifyDoc = await this.db.collection(this.ordersCollection).doc(orderId).get();
      
      if (!verifyDoc.exists) {
        throw new Error('Order verification failed');
      }
      
      this.logger.log(`✅ Order ${orderId.slice(-8)} verified in Firestore`);
      
      return orderId;
      
    } catch (error) {
      this.logger.error(`❌ Firestore error: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // Record Execution
  // ============================================================================

  private async recordExecution(
    executionId: string,
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string, // ✅ Critical parameter
    amount: number,
    martingaleStep: number,
    status: 'pending' | 'executed' | 'failed' | 'skipped',
    errorMessage?: string,
    orderId?: string
  ) {
    const execution: ScheduleExecution = {
      id: executionId,
      scheduleId: schedule.id,
      userId: schedule.userId,
      executedAt: new Date(),
      scheduledTime, // ✅ Simpan scheduledTime untuk tracking
      trend,
      orderId,
      assetSymbol: schedule.assetSymbol,
      amount,
      duration: schedule.duration,
      accountType: schedule.accountType,
      martingaleStep,
      isRecoveryAttempt: martingaleStep > 0,
      status,
      errorMessage,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await this.db.collection(this.executionsCollection).doc(executionId).set(execution);
      
      this.logger.debug(
        `✅ Execution recorded: ${executionId.slice(-8)} ` +
        `(${scheduledTime}, step ${martingaleStep}, status: ${status})`
      );
    } catch (error) {
      this.logger.error(`❌ Failed to record execution: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // ✅ CHECK ORDER RESULT - Update state untuk scheduledTime yang tepat
  // ============================================================================

  private async checkOrderResultWithRetry(
    scheduleId: string,
    orderId: string,
    executionId: string,
    scheduledTime: string // ✅ Critical: untuk update state yang benar
  ) {
    const maxRetries = 6;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        this.logger.debug(
          `🔍 Checking result for ${scheduledTime} order ${orderId.slice(-8)} ` +
          `(attempt ${attempt + 1}/${maxRetries})`
        );

        const orderDoc = await this.db
          .collection(this.ordersCollection)
          .doc(orderId)
          .get();

        if (!orderDoc.exists) {
          if (attempt < maxRetries - 1) {
            this.logger.warn(`⚠️ Order not found, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            attempt++;
            continue;
          }
          
          await this.db.collection(this.executionsCollection).doc(executionId).update({
            status: 'failed',
            errorMessage: 'Order not found',
            updatedAt: new Date(),
          });
          
          return;
        }

        const order = orderDoc.data();

        if (!order) {
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            attempt++;
            continue;
          }
          
          await this.db.collection(this.executionsCollection).doc(executionId).update({
            status: 'failed',
            errorMessage: 'Order data is null',
            updatedAt: new Date(),
          });
          
          return;
        }

        // Check if still ACTIVE
        if (order.status === 'ACTIVE') {
          if (attempt < maxRetries - 1) {
            const exitTime = new Date(order.exit_time);
            const now = new Date();
            const remainingMs = exitTime.getTime() - now.getTime();
            
            this.logger.debug(
              `⏳ Order for ${scheduledTime} still ACTIVE ` +
              `(expires in ${Math.round(remainingMs / 1000)}s)`
            );
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempt++;
            continue;
          }
          
          this.logger.warn(`⚠️ Order still ACTIVE after ${maxRetries} attempts`);
          return;
        }

        // ✅ Order sudah selesai
        const orderScheduledTime = order.scheduled_time || 
                                   order.metadata?.scheduledTime ||
                                   scheduledTime;

        // Map result
        let mappedResult: 'win' | 'loss' | 'draw';
        if (order.status === 'WON') {
          mappedResult = 'win';
        } else if (order.status === 'LOST') {
          mappedResult = 'loss';
        } else {
          mappedResult = 'draw';
        }

        const profit = order.profit || 0;

        // Update execution
        await this.db.collection(this.executionsCollection).doc(executionId).update({
          result: mappedResult,
          profit: profit,
          status: 'executed',
          updatedAt: new Date(),
        });

        this.logger.log(
          `✅ Execution updated: ${executionId.slice(-8)} ` +
          `(${orderScheduledTime}, result: ${mappedResult})`
        );

        // ✅ CRITICAL: Update schedule statistics untuk scheduledTime yang TEPAT
        // Ini akan update orderMartingaleStates[scheduledTime]
        await this.orderScheduleService.updateAfterExecution(
          scheduleId,
          orderScheduledTime, // ✅ Update state untuk waktu INI saja
          mappedResult,
          profit
        );

        this.logger.log(
          `✅ Schedule ${scheduleId.slice(-8)} updated for ${orderScheduledTime}: ` +
          `Order ${orderId.slice(-8)} ${mappedResult.toUpperCase()} ` +
          `${profit > 0 ? '+' : ''}${profit.toFixed(0)}`
        );
        
        return;

      } catch (error) {
        this.logger.error(
          `❌ Error checking order (attempt ${attempt + 1}): ${error.message}`
        );
        
        if (attempt < maxRetries - 1) {
          const delay = 3000 * Math.pow(1.5, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          attempt++;
        } else {
          try {
            await this.db.collection(this.executionsCollection).doc(executionId).update({
              status: 'failed',
              errorMessage: `Failed after ${maxRetries} retries: ${error.message}`,
              updatedAt: new Date(),
            });
          } catch (updateError) {
            this.logger.error(`❌ Failed to update status: ${updateError.message}`);
          }
          
          throw error;
        }
      }
    }
  }

  // ============================================================================
  // Helper: Check User Balance
  // ============================================================================

  private async checkUserBalance(userId: string, requiredAmount: number): Promise<boolean> {
    try {
      const balanceSnapshot = await this.db
        .collection('balance')
        .where('user_id', '==', userId)
        .limit(1)
        .get();

      if (balanceSnapshot.empty) {
        this.logger.warn(`⚠️ No balance record for user: ${userId}`);
        return false;
      }

      const balance = balanceSnapshot.docs[0].data();
      const hasEnough = balance.real_balance >= requiredAmount;
      
      this.logger.debug(
        `💰 Balance check: ${balance.real_balance} vs ${requiredAmount} = ${hasEnough}`
      );
      
      return hasEnough;
    } catch (error) {
      this.logger.error(`❌ Error checking balance: ${error.message}`);
      return false;
    }
  }

  // ============================================================================
  // Helper: Time Functions
  // ============================================================================

  private getCurrentTime(): string {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private parseTimeToDate(time: string): Date {
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  // ============================================================================
  // Daily Reset
  // ============================================================================

  @Cron('0 0 * * *')
  private resetProcessedDaily() {
    this.logger.log('🔄 Resetting processed cache for new day');
    this.processedToday.clear();
  }

  // ============================================================================
  // Manual Trigger (for testing)
  // ============================================================================

  async manualTrigger(scheduleId: string, time: string) {
    this.logger.log(`🔧 Manual trigger: ${scheduleId.slice(-8)} at ${time}`);

    try {
      const doc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();

      if (!doc.exists) {
        throw new Error('Schedule not found');
      }

      const schedule = doc.data() as OrderSchedule;
      await this.processSchedule(schedule, time);

      return { message: 'Manual trigger successful' };
    } catch (error) {
      this.logger.error(`❌ Manual trigger error: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // Cleanup Old Executions
  // ============================================================================

  @Cron('0 3 * * *')
  async cleanupOldExecutions() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      this.logger.log('🧹 Cleaning up old executions...');

      const failedSnapshot = await this.db
        .collection(this.executionsCollection)
        .where('status', '==', 'failed')
        .where('createdAt', '<', thirtyDaysAgo)
        .limit(500)
        .get();

      if (!failedSnapshot.empty) {
        const batch = this.db.batch();
        failedSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        this.logger.log(`🧹 Deleted ${failedSnapshot.size} old failed executions`);
      }

      const skippedSnapshot = await this.db
        .collection(this.executionsCollection)
        .where('status', '==', 'skipped')
        .where('createdAt', '<', thirtyDaysAgo)
        .limit(500)
        .get();

      if (!skippedSnapshot.empty) {
        const batch = this.db.batch();
        skippedSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        this.logger.log(`🧹 Deleted ${skippedSnapshot.size} old skipped executions`);
      }

    } catch (error) {
      this.logger.error(`❌ Cleanup error: ${error.message}`);
    }
  }

  // ============================================================================
  // Monitoring Stats
  // ============================================================================

  getExecutorStats() {
    return {
      isProcessingSchedules: this.isProcessingSchedules,
      isCheckingResults: this.isCheckingResults,
      processSchedulesRunCount: this.processSchedulesRunCount,
      checkResultsRunCount: this.checkResultsRunCount,
      processedTodayCount: this.processedToday.size,
      martingaleMode: 'Independent per scheduled time',
      features: {
        checkInterval: '10 seconds',
        missedScheduleRecovery: true,
        retryMechanism: true,
        duplicateProtection: true,
        perTimeState: true, // ✅ Important feature
      },
      example: {
        description: 'Each scheduled time has its own martingale state',
        scenario: {
          '09:00': 'LOSS → step 1 (amount 20k)',
          '10:00': 'WIN  → step 0 (amount 10k) ← independent!',
          '14:00': 'LOSS → step 1 (amount 20k) ← independent!',
        }
      }
    };
  }
}