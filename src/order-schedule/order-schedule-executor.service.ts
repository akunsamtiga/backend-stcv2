// src/order-schedule/order-schedule-executor.service.ts
// ✅ FIXED VERSION - Dengan Cron Job untuk Update Statistik

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
  
  // ✅ TAMBAHAN: Counter untuk logging
  private checkResultsRunCount = 0;

  constructor(
    private firebaseService: FirebaseService,
    private orderScheduleService: OrderScheduleService,
    private priceFetcherService: PriceFetcherService,
    private assetsService: AssetsService,
  ) {
    this.logger.log('✅ OrderScheduleExecutorService initialized with per-order martingale');
  }

  private get db(): Firestore {
    return this.firebaseService.getFirestore();
  }

  // ============================================================================
  // CRON: Eksekusi Order Sesuai Jadwal (Every Minute)
  // ============================================================================

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledOrders() {
    if (this.isProcessingSchedules) {
      this.logger.warn('⏭️ Skipping scheduled orders - previous execution still running');
      return;
    }

    this.isProcessingSchedules = true;

    try {
      this.logger.log('🔍 Checking for scheduled orders...');

      const currentTime = this.getCurrentTime();
      const activeSchedules = await this.getActiveSchedules();

      this.logger.log(`📊 Found ${activeSchedules.length} active schedules`);

      for (const schedule of activeSchedules) {
        await this.processSchedule(schedule, currentTime);
      }
    } catch (error) {
      this.logger.error(`❌ Error in scheduled orders handler: ${error.message}`, error.stack);
    } finally {
      this.isProcessingSchedules = false;
    }
  }

  // ============================================================================
  // ✅ FIX: CRON untuk Check Order Results dan Update Statistik
  // Berjalan setiap 10 detik untuk check hasil order
  // ============================================================================

  @Cron('*/10 * * * * *') // Every 10 seconds
  async checkPendingExecutions() {
    if (this.isCheckingResults) {
      return;
    }

    this.isCheckingResults = true;

    try {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Get executions yang:
      // 1. Status = executed (order sudah dibuat)
      // 2. Created dalam 2 jam terakhir (safety limit)
      const executionsSnapshot = await this.db
        .collection(this.executionsCollection)
        .where('status', '==', 'executed')
        .where('createdAt', '>=', twoHoursAgo)
        .limit(100)
        .get();

      // Filter yang belum punya result
      const pendingExecutions = executionsSnapshot.docs.filter(doc => {
        const data = doc.data();
        return !data.result && data.orderId;
      });

      if (pendingExecutions.length === 0) {
        // Log setiap 1 menit (6x check @ 10s interval)
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

      // Process in parallel dengan batch size
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
                execution.id
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
  // Helper Methods
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

  private async processSchedule(schedule: OrderSchedule, currentTime: string) {
    try {
      this.logger.log(`🔄 Processing schedule ${schedule.id.slice(-8)} for user ${schedule.userEmail}`);

      // Check stop loss/profit
      const shouldStop = await this.orderScheduleService.checkStopLossProfit(schedule.id);
      if (shouldStop) {
        this.logger.log(`🛑 Schedule ${schedule.id.slice(-8)} stopped due to stop loss/profit limit`);
        return;
      }

      // Filter orders untuk waktu sekarang
      const scheduledOrders = schedule.schedules.filter(s => s.time === currentTime);

      if (scheduledOrders.length === 0) {
        return;
      }

      this.logger.log(`📋 Found ${scheduledOrders.length} orders to execute for schedule ${schedule.id.slice(-8)}`);

      // Execute each scheduled order
      for (const scheduledOrder of scheduledOrders) {
        const alreadyExecuted = await this.checkAlreadyExecutedToday(
          schedule.id,
          scheduledOrder.time
        );

        if (alreadyExecuted) {
          this.logger.log(
            `⏭️ Skipping ${scheduledOrder.time} - already executed today for schedule ${schedule.id.slice(-8)}`
          );
          continue;
        }

        await this.executeOrder(schedule, scheduledOrder.trend, scheduledOrder.time);
      }
    } catch (error) {
      this.logger.error(
        `❌ Error processing schedule ${schedule.id.slice(-8)}: ${error.message}`,
        error.stack
      );
    }
  }

  private async checkAlreadyExecutedToday(
    scheduleId: string,
    time: string
  ): Promise<boolean> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await this.db
        .collection(this.executionsCollection)
        .where('scheduleId', '==', scheduleId)
        .where('scheduledTime', '==', time)
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

  private async executeOrder(
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string
  ) {
    const executionId = uuidv4();

    try {
      this.logger.log(
        `🚀 Executing order for schedule ${schedule.id.slice(-8)}: ${trend} at ${scheduledTime}`
      );

      // Ambil state martingale untuk order ini (berdasarkan scheduledTime)
      const orderState = this.orderScheduleService.getOrderMartingaleState(schedule, scheduledTime);
      
      this.logger.log(
        `📊 Order ${scheduledTime} state: Step=${orderState.currentStep}, ` +
        `ConsecutiveLosses=${orderState.consecutiveLosses}, LastResult=${orderState.lastResult || 'none'}`
      );

      // Calculate amount berdasarkan state order ini
      const amount = this.orderScheduleService.calculateMartingaleAmount(
        schedule.amount,
        orderState.currentStep,
        schedule.martingaleSetting.multiplier
      );

      this.logger.log(
        `💰 Amount: ${amount} (base: ${schedule.amount}, step: ${orderState.currentStep}, multiplier: ${schedule.martingaleSetting.multiplier})`
      );

      // Check balance untuk real account
      if (schedule.accountType === 'real') {
        const hasBalance = await this.checkUserBalance(schedule.userId, amount);
        
        if (!hasBalance) {
          this.logger.warn(`⚠️ Insufficient balance for user ${schedule.userId}`);
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
      
      // Create binary order
      let orderId: string;
      try {
        orderId = await this.createBinaryOrderWithVerification(schedule, trend, amount, scheduledTime);
        this.logger.log(`✅ Binary order created: ${orderId.slice(-8)}`);
      } catch (createError) {
        this.logger.error(`❌ Failed to create order: ${createError.message}`);
        throw createError;
      }

      // Record execution
      try {
        await this.recordExecution(
          executionId,
          schedule,
          trend,
          scheduledTime,
          amount,
          orderState.currentStep,
          'executed',
          undefined,
          orderId
        );
        this.logger.log(`✅ Execution recorded: ${executionId.slice(-8)}`);
      } catch (recordError) {
        this.logger.error(`❌ Failed to record execution: ${recordError.message}`);
        throw recordError;
      }

      this.logger.log(`✅ Order executed successfully: ${orderId.slice(-8)}`);
      
    } catch (error) {
      this.logger.error(
        `❌ CRITICAL ERROR executing order for schedule ${schedule.id.slice(-8)}: ${error.message}`
      );

      try {
        const orderState = this.orderScheduleService.getOrderMartingaleState(schedule, scheduledTime);
        
        await this.recordExecution(
          executionId,
          schedule,
          trend,
          scheduledTime,
          schedule.amount,
          orderState.currentStep,
          'failed',
          error.message
        );
      } catch (recordError) {
        this.logger.error(`❌ Failed to record failed execution: ${recordError.message}`);
      }
    }
  }

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
      this.logger.warn(`⚠️ Error fetching asset name for ${assetSymbol}: ${error.message}`);
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

    // Fetch asset data and price
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
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(assetData, true);
          if (priceData && priceData.price) {
            entryPrice = priceData.price;
            this.logger.log(`💰 Entry price fetched: ${entryPrice} for ${schedule.assetSymbol}`);
          }
        } catch (priceError) {
          this.logger.warn(`⚠️ Could not fetch realtime price: ${priceError.message}`);
          entryPrice = assetData.simulatorSettings?.initialPrice || assetData.initialPrice || 0;
        }
      } else {
        this.logger.warn(`⚠️ Asset ${schedule.assetSymbol} not found in database`);
      }
    } catch (error) {
      this.logger.warn(`⚠️ Could not fetch asset info: ${error.message}`);
    }

    const durationInMinutes = schedule.duration / 60;
    const direction = trend === 'buy' ? 'CALL' : 'PUT';
    const expiryTime = new Date(now.getTime() + schedule.duration * 1000);

    // Create order object
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
      scheduled_time: scheduledTime,
      
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      
      profitRate: assetData?.profitRate || 85,
      baseProfitRate: assetData?.profitRate || 85,
      statusBonus: 0,
      userStatus: 'standard',
      
      metadata: {
        isScheduled: true,
        scheduledAt: now.toISOString(),
        scheduledTime: scheduledTime,
        martingaleStep: this.orderScheduleService.getOrderMartingaleState(schedule, scheduledTime).currentStep,
        originalTrend: trend,
      }
    };

    try {
      this.logger.log(`📝 Writing order ${orderId.slice(-8)} to Firestore...`);
      
      await this.db.collection(this.ordersCollection).doc(orderId).set(order);
      
      const verifyDoc = await this.db.collection(this.ordersCollection).doc(orderId).get();
      
      if (!verifyDoc.exists) {
        throw new Error('Failed to write order to Firestore - verification failed');
      }
      
      this.logger.log(`✅ Verified order ${orderId.slice(-8)} exists in Firestore`);
      
      return orderId;
      
    } catch (error) {
      this.logger.error(`❌ Firestore operation failed for order ${orderId.slice(-8)}: ${error.message}`);
      throw error;
    }
  }

  private async recordExecution(
    executionId: string,
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string,
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
      scheduledTime,
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
      this.logger.debug(`✅ Execution ${executionId.slice(-8)} recorded with status: ${status}, step: ${martingaleStep}`);
    } catch (error) {
      this.logger.error(`❌ Failed to record execution: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // ✅ FIX: Improved checkOrderResultWithRetry
  // Versi yang lebih robust dengan handling untuk order yang belum selesai
  // ============================================================================

  private async checkOrderResultWithRetry(
    scheduleId: string,
    orderId: string,
    executionId: string
  ) {
    const maxRetries = 6; // Increased from 3
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        this.logger.debug(
          `🔍 Checking result for order ${orderId.slice(-8)} ` +
          `(attempt ${attempt + 1}/${maxRetries})`
        );

        const orderDoc = await this.db
          .collection(this.ordersCollection)
          .doc(orderId)
          .get();

        if (!orderDoc.exists) {
          if (attempt < maxRetries - 1) {
            this.logger.warn(
              `⚠️ Order ${orderId.slice(-8)} not found, retrying in 3s...`
            );
            await new Promise(resolve => setTimeout(resolve, 3000));
            attempt++;
            continue;
          }
          
          this.logger.error(
            `❌ Order ${orderId.slice(-8)} not found after ${maxRetries} attempts`
          );
          
          await this.db.collection(this.executionsCollection).doc(executionId).update({
            status: 'failed',
            errorMessage: 'Order not found in database',
            updatedAt: new Date(),
          });
          
          return;
        }

        const order = orderDoc.data();

        // ✅ FIX: Null check untuk order
        if (!order) {
          if (attempt < maxRetries - 1) {
            this.logger.warn(`⚠️ Order ${orderId.slice(-8)} data is null, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            attempt++;
            continue;
          }
          
          this.logger.error(`❌ Order ${orderId.slice(-8)} data is null after ${maxRetries} attempts`);
          
          await this.db.collection(this.executionsCollection).doc(executionId).update({
            status: 'failed',
            errorMessage: 'Order data is null',
            updatedAt: new Date(),
          });
          
          return;
        }

        // ✅ Check if order is still ACTIVE (belum expired)
        if (order.status === 'ACTIVE') {
          if (attempt < maxRetries - 1) {
            const exitTime = new Date(order.exit_time);
            const now = new Date();
            const remainingMs = exitTime.getTime() - now.getTime();
            
            this.logger.debug(
              `⏳ Order ${orderId.slice(-8)} still ACTIVE ` +
              `(expires in ${Math.round(remainingMs / 1000)}s), will retry`
            );
            
            // Wait 5 seconds before retry
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempt++;
            continue;
          }
          
          this.logger.warn(
            `⚠️ Order ${orderId.slice(-8)} still ACTIVE after ${maxRetries} attempts`
          );
          return;
        }

        // ✅ Order sudah selesai (status = WON, LOST, atau DRAW)
        const scheduledTime = order.scheduled_time || order.metadata?.scheduledTime;
        
        if (!scheduledTime) {
          this.logger.warn(
            `⚠️ scheduledTime not found for order ${orderId.slice(-8)}`
          );
        }

        // Map order status (WON/LOST) ke execution result (win/loss)
        let mappedResult: 'win' | 'loss' | 'draw';
        if (order.status === 'WON') {
          mappedResult = 'win';
        } else if (order.status === 'LOST') {
          mappedResult = 'loss';
        } else {
          mappedResult = 'draw';
        }

        const profit = order.profit || 0;

        // ✅ Update execution record dengan result
        await this.db.collection(this.executionsCollection).doc(executionId).update({
          result: mappedResult,
          profit: profit,
          status: 'executed',
          updatedAt: new Date(),
        });

        this.logger.log(
          `✅ Execution ${executionId.slice(-8)} updated with result: ${mappedResult}`
        );

        // ✅ UPDATE SCHEDULE STATISTICS (CRITICAL!)
        await this.orderScheduleService.updateAfterExecution(
          scheduleId,
          scheduledTime || '',
          mappedResult,
          profit
        );

        this.logger.log(
          `✅ Schedule ${scheduleId.slice(-8)} updated: ` +
          `Order ${orderId.slice(-8)} ${mappedResult.toUpperCase()} ` +
          `${profit > 0 ? '+' : ''}${profit.toFixed(0)} ` +
          `at ${scheduledTime}`
        );
        
        return;

      } catch (error) {
        this.logger.error(
          `❌ Error checking order ${orderId.slice(-8)} ` +
          `(attempt ${attempt + 1}/${maxRetries}): ${error.message}`
        );
        
        if (attempt < maxRetries - 1) {
          // Exponential backoff
          const delay = 3000 * Math.pow(1.5, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          attempt++;
        } else {
          // All retries failed
          try {
            await this.db.collection(this.executionsCollection).doc(executionId).update({
              status: 'failed',
              errorMessage: `Failed to check result after ${maxRetries} retries: ${error.message}`,
              updatedAt: new Date(),
            });
          } catch (updateError) {
            this.logger.error(
              `❌ Failed to update execution status: ${updateError.message}`
            );
          }
          
          throw error;
        }
      }
    }
  }

  private async checkUserBalance(userId: string, requiredAmount: number): Promise<boolean> {
    try {
      const balanceSnapshot = await this.db
        .collection('balance')
        .where('user_id', '==', userId)
        .limit(1)
        .get();

      if (balanceSnapshot.empty) {
        this.logger.warn(`⚠️ No balance record found for user: ${userId}`);
        return false;
      }

      const balance = balanceSnapshot.docs[0].data();
      const hasEnough = balance.real_balance >= requiredAmount;
      
      this.logger.debug(
        `💰 User balance: ${balance.real_balance}, required: ${requiredAmount}, sufficient: ${hasEnough}`
      );
      
      return hasEnough;
    } catch (error) {
      this.logger.error(`❌ Error checking user balance: ${error.message}`);
      return false;
    }
  }

  private getCurrentTime(): string {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // ============================================================================
  // Manual Trigger Methods (untuk testing/debugging)
  // ============================================================================

  async manualTrigger(scheduleId: string, time: string) {
    this.logger.log(`🔧 Manual trigger for schedule ${scheduleId.slice(-8)} at ${time}`);

    try {
      const doc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();

      if (!doc.exists) {
        throw new Error('Schedule not found');
      }

      const schedule = doc.data() as OrderSchedule;
      await this.processSchedule(schedule, time);

      return { message: 'Manual trigger executed successfully' };
    } catch (error) {
      this.logger.error(`❌ Error in manual trigger: ${error.message}`);
      throw error;
    }
  }

  async manualCheckOrderResult(orderId: string, executionId: string) {
    this.logger.log(`🔧 Manual check for order ${orderId.slice(-8)}`);

    try {
      const executionDoc = await this.db
        .collection(this.executionsCollection)
        .doc(executionId)
        .get();

      if (!executionDoc.exists) {
        throw new Error('Execution not found');
      }

      const execution = executionDoc.data() as ScheduleExecution;

      await this.checkOrderResultWithRetry(
        execution.scheduleId,
        orderId,
        executionId
      );

      return { message: 'Order result checked successfully' };
    } catch (error) {
      this.logger.error(`❌ Error in manual check: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // ✅ OPTIONAL: Cleanup Old Executions (jalankan daily)
  // ============================================================================

  @Cron('0 3 * * *') // Daily at 3 AM
  async cleanupOldExecutions() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      this.logger.log('🧹 Cleaning up old executions...');

      // Delete old failed executions
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

      // Delete old skipped executions
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
      this.logger.error(`❌ Error cleaning up executions: ${error.message}`);
    }
  }
}