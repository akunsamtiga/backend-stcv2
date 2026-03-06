// src/order-schedule/order-schedule-executor.service.ts
// ✅ VERSI 1 HARI - AUTO DELETE SETELAH SEMUA ORDER SELESAI

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service';
import { OrderScheduleService } from './order-schedule.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { BalanceService } from '../balance/balance.service'; // ✅ FIX: import BalanceService
import { BALANCE_TYPES } from '../common/constants'; // ✅ FIX: import BALANCE_TYPES
import { ScheduleStatus, TrendType } from './dto/create-order-schedule.dto';
import { OrderSchedule, ScheduleExecution, OrderMartingaleState } from './entities/order-schedule.entity';

@Injectable()
export class OrderScheduleExecutorService {
  private readonly logger = new Logger(OrderScheduleExecutorService.name);
  
  private readonly schedulesCollection = 'order_schedules';
  private readonly executionsCollection = 'schedule_executions';
  private readonly ordersCollection = 'binary_orders';
  private readonly assetsCollection = 'assets';

  private isProcessingSchedules = false;
  private isCheckingResults = false;
  
  // ✅ Track processed schedules untuk avoid duplicate dalam 1 hari
  // Key: "scheduleId:scheduledTime"
  private processedToday: Set<string> = new Set();
  
  // ✅ Track schedules yang sudah selesai semua (untuk auto-delete)
  private completedSchedules: Set<string> = new Set();
  
  // ✅ Track martingale recovery yang sedang berjalan (untuk mencegah duplicate)
  // Key: "scheduleId:scheduledTime"
  private activeRecoveries: Set<string> = new Set();

  private checkResultsRunCount = 0;
  private processSchedulesRunCount = 0;

  constructor(
    private firebaseService: FirebaseService,
    private orderScheduleService: OrderScheduleService,
    private priceFetcherService: PriceFetcherService,
    private balanceService: BalanceService, // ✅ FIX: inject BalanceService
  ) {
    this.logger.log('✅ OrderScheduleExecutorService initialized');
    this.logger.log('🎯 MODE: 1 Schedule = 1 Hari (Auto-delete setelah selesai)');
    this.logger.log('📝 Setiap schedule hanya berlaku untuk hari ini saja');
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
      this.processSchedulesRunCount++;
      return;
    }

    this.isProcessingSchedules = true;

    try {
      const currentTime = this.getCurrentTime();
      const activeSchedules = await this.getActiveSchedules();

      for (const schedule of activeSchedules) {
        // Skip jika schedule sudah selesai semua
        if (this.completedSchedules.has(schedule.id)) {
          continue;
        }
        
        await this.processSchedule(schedule, currentTime);
        
        // ✅ Cek apakah semua order sudah selesai, jika ya hapus
        await this.checkAndDeleteIfAllCompleted(schedule);
      }

      this.processSchedulesRunCount++;
    } catch (error) {
      this.logger.error(`❌ Error in handleScheduledOrders: ${error.message}`, error.stack);
    } finally {
      this.isProcessingSchedules = false;
    }
  }

  // ============================================================================
  // ✅ Cek dan hapus schedule jika semua order sudah selesai (termasuk martingale)
  // ============================================================================

  private async checkAndDeleteIfAllCompleted(schedule: OrderSchedule): Promise<void> {
    try {
      const allScheduledTimes = schedule.schedules.map(s => s.time);

      // Cek semua execution hari ini untuk schedule ini
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const executionsSnapshot = await this.db
        .collection(this.executionsCollection)
        .where('scheduleId', '==', schedule.id)
        .where('executedAt', '>=', today)
        .get();

      // ✅ Group executions by scheduledTime dan cari yang terakhir untuk setiap waktu
      const executionsByTime = new Map<string, any[]>();

      executionsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const time = data.scheduledTime;
        if (!executionsByTime.has(time)) {
          executionsByTime.set(time, []);
        }
        executionsByTime.get(time)!.push(data);
      });

      // ✅ Cek untuk setiap scheduled time apakah sudah COMPLETE (win atau max step reached)
      const orderStates = (schedule as any).orderMartingaleStates || [] as OrderMartingaleState[];

      const completedTimeSlots: string[] = [];
      const pendingRecoveryTimeSlots: string[] = [];

      for (const time of allScheduledTimes) {
        const timeExecutions = executionsByTime.get(time) || [];
        const orderState = orderStates.find((s: OrderMartingaleState) => s.scheduledTime === time);

        // Cek apakah ada recovery yang sedang berjalan untuk waktu ini
        const recoveryKey = `${schedule.id}:${time}`;
        const isRecoveryActive = this.activeRecoveries.has(recoveryKey);

        // Cek execution terakhir untuk waktu ini
        const sortedExecutions = timeExecutions
          .filter((e: any) => e.result != null)
          .sort((a: any, b: any) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());

        const lastExecution = sortedExecutions[0];

        if (!lastExecution) {
          // Belum ada execution dengan result untuk waktu ini
          pendingRecoveryTimeSlots.push(`${time}(no-result)`);
          continue;
        }

        if (lastExecution.result === 'win') {
          // Win = completed untuk time slot ini
          completedTimeSlots.push(time);
        } else if (lastExecution.result === 'loss') {
          // Loss - cek apakah masih ada recovery pending
          const currentStep = orderState?.currentStep || 0;
          const maxStep = schedule.martingaleSetting.maxStep;

          if (currentStep > 0 && currentStep <= maxStep && !isRecoveryActive) {
            // Masih ada recovery yang perlu dijalankan
            pendingRecoveryTimeSlots.push(`${time}(step:${currentStep}/${maxStep})`);
          } else if (isRecoveryActive) {
            // Recovery sedang berjalan
            pendingRecoveryTimeSlots.push(`${time}(recovery-active)`);
          } else {
            // Max step reached atau sudah selesai recovery = completed
            completedTimeSlots.push(time);
          }
        } else {
          // Draw = completed
          completedTimeSlots.push(time);
        }
      }

      // ✅ Jika masih ada recovery pending, jangan hapus schedule
      if (pendingRecoveryTimeSlots.length > 0) {
        this.logger.debug(
          `⏳ Schedule ${schedule.id.slice(-8)} has pending recoveries: ` +
          `${pendingRecoveryTimeSlots.join(', ')}. NOT deleting.`
        );
        return;
      }

      // ✅ Jika semua time slots sudah completed, hapus schedule
      if (completedTimeSlots.length === allScheduledTimes.length) {
        this.logger.log(
          `✅ Schedule ${schedule.id.slice(-8)} completed! ` +
          `All ${allScheduledTimes.length} time slots finished (martingale cycles complete). Auto-deleting...`
        );

        // Hapus schedule
        await this.db.collection(this.schedulesCollection).doc(schedule.id).delete();

        // Mark sebagai completed
        this.completedSchedules.add(schedule.id);

        // Cleanup processed cache untuk schedule ini
        for (const time of allScheduledTimes) {
          this.processedToday.delete(`${schedule.id}:${time}`);
        }

        // Cleanup active recoveries
        for (const time of allScheduledTimes) {
          this.activeRecoveries.delete(`${schedule.id}:${time}`);
        }

        this.logger.log(`🗑️ Schedule ${schedule.id.slice(-8)} deleted successfully`);
      }
    } catch (error) {
      this.logger.error(`❌ Error checking/deleting completed schedule: ${error.message}`);
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
        this.checkResultsRunCount++;
        this.isCheckingResults = false;
        return;
      }

      this.logger.log(`🔍 Checking ${pendingExecutions.length} pending executions for results`);

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
                execution.scheduledTime
              );
              
              // ✅ Setelah update result, cek apakah schedule sudah selesai semua
              const schedule = await this.getLatestSchedule(execution.scheduleId);
              if (schedule) {
                await this.checkAndDeleteIfAllCompleted(schedule);
              }
            } catch (error) {
              this.logger.error(`Error checking execution ${execution.id.slice(-8)}: ${error.message}`);
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
  // Get Latest Schedule
  // ============================================================================

  private async getLatestSchedule(scheduleId: string): Promise<OrderSchedule | null> {
    try {
      const doc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();
      if (!doc.exists) {
        return null;
      }
      return doc.data() as OrderSchedule;
    } catch (error) {
      this.logger.error(`❌ Error fetching latest schedule: ${error.message}`);
      return null;
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
        // Hapus schedule yang di-stop
        await this.db.collection(this.schedulesCollection).doc(schedule.id).delete();
        this.completedSchedules.add(schedule.id);
        return;
      }

      const scheduledOrders = schedule.schedules.filter(s => s.time === currentTime);

      if (scheduledOrders.length === 0) {
        return;
      }

      this.logger.log(
        `📋 Found ${scheduledOrders.length} orders at ${currentTime} for schedule ${schedule.id.slice(-8)}`
      );

      for (const scheduledOrder of scheduledOrders) {
        const cacheKey = `${schedule.id}:${scheduledOrder.time}`;
        
        if (this.processedToday.has(cacheKey)) {
          continue;
        }

        const alreadyExecuted = await this.checkAlreadyExecutedToday(
          schedule.id,
          scheduledOrder.time
        );

        if (alreadyExecuted) {
          this.processedToday.add(cacheKey);
          continue;
        }

        await this.executeOrder(schedule, scheduledOrder.trend, scheduledOrder.time);
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
        .where('scheduledTime', '==', scheduledTime)
        .where('executedAt', '>=', today)
        .get();

      return !snapshot.empty;
    } catch (error) {
      this.logger.error(`Error checking execution history: ${error.message}`);
      return false;
    }
  }

  // ============================================================================
  // EXECUTE ORDER - dengan Martingale per scheduledTime
  // ============================================================================

  private async executeOrder(
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string
  ) {
    const executionId = uuidv4();
    const maxRetries = 3;
    let lastError: Error | null = null;

    this.logger.log(
      `🚀 Executing order for schedule ${schedule.id.slice(-8)} at ${scheduledTime}, trend: ${trend.toUpperCase()}`
    );

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Fetch latest schedule data
        const latestSchedule = await this.getLatestSchedule(schedule.id);
        
        if (!latestSchedule) {
          throw new Error(`Schedule ${schedule.id} not found`);
        }

        // Get martingale state
        const orderState = this.orderScheduleService.getOrderMartingaleState(
          latestSchedule, 
          scheduledTime
        );
        
        this.logger.log(
          `📊 Order ${scheduledTime} martingale state: Step=${orderState.currentStep}, ` +
          `ConsecutiveLosses=${orderState.consecutiveLosses}, LastResult=${orderState.lastResult || 'none'}`
        );
        
        // Calculate amount
        const amount = this.orderScheduleService.calculateMartingaleAmount(
          latestSchedule.amount,
          orderState.currentStep,
          latestSchedule.martingaleSetting.multiplier
        );

        this.logger.log(
          `💰 Amount calculation for ${scheduledTime}: Base=${latestSchedule.amount}, ` +
          `Step=${orderState.currentStep} → Final=${amount.toLocaleString()}`
        );

        // ✅ FIX: Check balance untuk real account menggunakan BalanceService
        if (latestSchedule.accountType === 'real') {
          const hasBalance = await this.checkUserBalance(latestSchedule.userId, amount);
          
          if (!hasBalance) {
            this.logger.warn(`⚠️ Insufficient balance for ${scheduledTime}: required ${amount.toLocaleString()}`);
            
            await this.recordExecution(
              executionId,
              latestSchedule,
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

        // Create order
        let orderId: string;
        try {
          orderId = await this.createBinaryOrderWithVerification(
            latestSchedule, 
            trend, 
            amount, 
            scheduledTime
          );
          
          this.logger.log(`✅ Order created for ${scheduledTime}: ${orderId.slice(-8)}`);
        } catch (createError) {
          this.logger.error(
            `❌ Failed to create order (attempt ${attempt + 1}/${maxRetries}): ${createError.message}`
          );
          
          if (attempt < maxRetries - 1) {
            const delay = 2000 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          throw createError;
        }

        // Record execution
        await this.recordExecution(
          executionId,
          latestSchedule,
          trend,
          scheduledTime,
          amount,
          orderState.currentStep,
          'executed',
          undefined,
          orderId
        );

        this.logger.log(
          `✅ Order ${orderId.slice(-8)} executed successfully for ${scheduledTime} at step ${orderState.currentStep}`
        );
        
        return;
        
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries - 1) {
          const delay = 2000 * Math.pow(2, attempt);
          this.logger.warn(`⚠️ Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    this.logger.error(
      `❌ CRITICAL: Failed after ${maxRetries} attempts for ${scheduledTime}: ${lastError?.message}`
    );

    try {
      const latestSchedule = await this.getLatestSchedule(schedule.id);
      
      if (latestSchedule) {
        const orderState = this.orderScheduleService.getOrderMartingaleState(latestSchedule, scheduledTime);
        
        await this.recordExecution(
          executionId,
          latestSchedule,
          trend,
          scheduledTime,
          latestSchedule.amount,
          orderState.currentStep,
          'failed',
          `Failed after ${maxRetries} retries: ${lastError?.message}`
        );
      } else {
        await this.recordExecution(
          executionId,
          schedule,
          trend,
          scheduledTime,
          schedule.amount,
          0,
          'failed',
          `Failed after ${maxRetries} retries: ${lastError?.message}`
        );
      }
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
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(assetData, true);
          
          if (priceData && priceData.price) {
            entryPrice = priceData.price;
            this.logger.log(`💰 Entry price for ${scheduledTime}: ${entryPrice}`);
          }
        } catch (priceError) {
          this.logger.warn(`⚠️ Could not fetch realtime price: ${priceError.message}`);
          entryPrice = assetData.simulatorSettings?.initialPrice || assetData.initialPrice || 0;
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

    const latestSchedule = await this.getLatestSchedule(schedule.id);
    const orderState = latestSchedule 
      ? this.orderScheduleService.getOrderMartingaleState(latestSchedule, scheduledTime)
      : { currentStep: 0 };

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

      // ✅ FIX: Debit balance untuk akun real setelah order berhasil dibuat
      // Sebelumnya tidak ada debit sama sekali, sehingga saldo tidak berkurang
      if (schedule.accountType === 'real') {
        try {
          await this.balanceService.createBalanceEntry(schedule.userId, {
            accountType: 'real',
            type: BALANCE_TYPES.ORDER_DEBIT, // ✅ FIX: field wajib di CreateBalanceDto
            amount: -amount, // negatif = debit
            description: `[REAL] Scheduled Order #${orderId.slice(-8)} - ${schedule.assetSymbol} ${direction}`,
          });
          this.balanceService.clearUserCache(schedule.userId);
          this.logger.log(`💸 Balance debited ${amount.toLocaleString()} for scheduled order ${orderId.slice(-8)}`);
        } catch (debitError) {
          // Rollback: hapus order jika debit gagal agar tidak ada order tanpa debit
          this.logger.error(`❌ Failed to debit balance, rolling back order: ${debitError.message}`);
          await this.db.collection(this.ordersCollection).doc(orderId).delete();
          throw new Error(`Failed to debit balance: ${debitError.message}`);
        }
      }
      
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
      
      this.logger.debug(
        `✅ Execution recorded: ${executionId.slice(-8)} (${scheduledTime}, step ${martingaleStep}, status: ${status})`
      );
    } catch (error) {
      this.logger.error(`❌ Failed to record execution: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // CHECK ORDER RESULT
  // ============================================================================

  private async checkOrderResultWithRetry(
    scheduleId: string,
    orderId: string,
    executionId: string,
    scheduledTime: string
  ) {
    const maxRetries = 6;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        this.logger.debug(
          `🔍 Checking result for ${scheduledTime} order ${orderId.slice(-8)} (attempt ${attempt + 1}/${maxRetries})`
        );

        const orderDoc = await this.db.collection(this.ordersCollection).doc(orderId).get();

        if (!orderDoc.exists) {
          if (attempt < maxRetries - 1) {
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

        if (order.status === 'ACTIVE') {
          if (attempt < maxRetries - 1) {
            const exitTime = new Date(order.exit_time);
            const now = new Date();
            const remainingMs = exitTime.getTime() - now.getTime();
            
            this.logger.debug(
              `⏳ Order for ${scheduledTime} still ACTIVE (expires in ${Math.round(remainingMs / 1000)}s)`
            );
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempt++;
            continue;
          }
          
          this.logger.warn(`⚠️ Order still ACTIVE after ${maxRetries} attempts`);
          return;
        }

        const orderScheduledTime = order.scheduled_time || order.metadata?.scheduledTime || scheduledTime;

        let mappedResult: 'win' | 'loss' | 'draw';
        if (order.status === 'WON') {
          mappedResult = 'win';
        } else if (order.status === 'LOST') {
          mappedResult = 'loss';
        } else {
          mappedResult = 'draw';
        }

        const profit = order.profit || 0;

        await this.db.collection(this.executionsCollection).doc(executionId).update({
          result: mappedResult,
          profit: profit,
          status: 'executed',
          updatedAt: new Date(),
        });

        this.logger.log(
          `✅ Execution updated: ${executionId.slice(-8)} (${orderScheduledTime}, result: ${mappedResult})`
        );

        // ✅ Update schedule statistics dan dapatkan info untuk recovery
        const recoveryInfo = await this.updateAfterExecutionWithRecovery(
          scheduleId,
          orderScheduledTime,
          mappedResult,
          profit
        );
        this.logger.log(
          `✅ Schedule ${scheduleId.slice(-8)} updated for ${orderScheduledTime}: ` +
          `Order ${orderId.slice(-8)} ${mappedResult.toUpperCase()} ${profit > 0 ? '+' : ''}${profit.toFixed(0)}`
        );

        // ✅ TRIGGER MARTINGALE RECOVERY: Jika loss dan masih bisa recovery, eksekusi langsung
        if (recoveryInfo.shouldRecover && recoveryInfo.trend) {
          const recoveryKey = `${scheduleId}:${orderScheduledTime}`;
          // Cek apakah sudah ada recovery yang berjalan untuk waktu ini
          if (!this.activeRecoveries.has(recoveryKey)) {
            this.logger.log(
              `🔄 LOSS detected! Triggering martingale recovery for ${orderScheduledTime} ` +
              `(step ${recoveryInfo.currentStep} → ${recoveryInfo.nextStep})`
            );
            // Mark recovery sebagai active
            this.activeRecoveries.add(recoveryKey);
            try {
              // Execute recovery order immediately
              await this.executeMartingaleRecovery(
                scheduleId,
                orderScheduledTime,
                recoveryInfo.trend,
                recoveryInfo.nextStep
              );
            } finally {
              // Remove dari active setelah selesai (sukses/gagal)
              this.activeRecoveries.delete(recoveryKey);
            }
          } else {
            this.logger.warn(`⚠️ Recovery already in progress for ${orderScheduledTime}, skipping duplicate`);
          }
        } else if (mappedResult === 'loss') {
          this.logger.log(
            `🛑 Max martingale step reached for ${orderScheduledTime} or recovery not needed. ` +
            `This time slot is COMPLETED.`
          );
        }
        return;

      } catch (error) {
        this.logger.error(`❌ Error checking order (attempt ${attempt + 1}): ${error.message}`);
        
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
  // ✅ UPDATE AFTER EXECUTION dengan Recovery Info
  // ============================================================================

  private async updateAfterExecutionWithRecovery(
    scheduleId: string,
    scheduledTime: string,
    executionResult: 'win' | 'loss' | 'draw',
    profit: number
  ): Promise<{ shouldRecover: boolean; nextStep: number; currentStep: number; trend?: TrendType }> {
    try {
      const scheduleRef = this.db.collection(this.schedulesCollection).doc(scheduleId);
      const scheduleDoc = await scheduleRef.get();

      if (!scheduleDoc.exists) {
        throw new Error('Schedule not found');
      }

      const schedule = scheduleDoc.data() as OrderSchedule;

      const orderStates = [...((schedule as any).orderMartingaleStates || [])] as OrderMartingaleState[];
      const orderStateIndex = orderStates.findIndex(s => s.scheduledTime === scheduledTime);

      let orderState: OrderMartingaleState;

      if (orderStateIndex >= 0) {
        orderState = { ...orderStates[orderStateIndex] };
      } else {
        orderState = {
          scheduledTime,
          currentStep: 0,
          consecutiveLosses: 0,
          lastResult: null,
          lastExecutedAt: null,
          totalExecuted: 0,
          totalWins: 0,
          totalLosses: 0,
        };
      }

      const previousStep = orderState.currentStep;
      orderState.lastExecutedAt = new Date();
      orderState.totalExecuted++;
      orderState.lastResult = executionResult;

      let shouldRecover = false;
      let nextStep = previousStep;

      if (executionResult === 'win') {
        orderState.totalWins++;
        orderState.consecutiveLosses = 0;
        orderState.currentStep = 0;
        shouldRecover = false;
      } else if (executionResult === 'loss') {
        orderState.totalLosses++;
        orderState.consecutiveLosses++;

        // Cek apakah bisa naik step (belum mencapai maxStep)
        if (orderState.currentStep < schedule.martingaleSetting.maxStep) {
          orderState.currentStep++;
          nextStep = orderState.currentStep;
          shouldRecover = true;
        } else {
          // Sudah max step, reset ke 0 (tidak recovery lagi)
          orderState.currentStep = 0;
          shouldRecover = false;
        }
      }

      if (orderStateIndex >= 0) {
        orderStates[orderStateIndex] = orderState;
      } else {
        orderStates.push(orderState);
      }

      const updates: any = {
        totalExecuted: FieldValue.increment(1),
        lastExecutedAt: new Date(),
        lastExecutionResult: executionResult,
        updatedAt: new Date(),
        currentProfit: FieldValue.increment(profit),
        orderMartingaleStates: orderStates,
      };

      if (profit > 0) {
        updates.totalProfit = FieldValue.increment(profit);
        updates.totalSuccess = FieldValue.increment(1);
      } else if (profit < 0) {
        updates.totalLoss = FieldValue.increment(Math.abs(profit));
        updates.totalFailed = FieldValue.increment(1);
      }

      const avgStep = orderStates.reduce((sum, s) => sum + s.currentStep, 0) / orderStates.length;
      updates.currentMartingaleStep = Math.round(avgStep);
      updates.consecutiveLosses = orderStates.reduce((sum, s) => sum + s.consecutiveLosses, 0);

      await scheduleRef.update(updates);

      this.logger.log(
        `✅ Order ${scheduledTime} result: ${executionResult.toUpperCase()}, ` +
        `Step: ${previousStep} → ${orderState.currentStep}, ` +
        `ShouldRecover: ${shouldRecover}`
      );

      // Get trend untuk scheduled time ini
      const scheduledOrder = schedule.schedules.find(s => s.time === scheduledTime);
      const trend = scheduledOrder?.trend;

      return {
        shouldRecover,
        nextStep,
        currentStep: previousStep,
        trend,
      };
    } catch (error) {
      this.logger.error(`❌ Error updating schedule after execution: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ============================================================================
  // ✅ EXECUTE MARTINGALE RECOVERY - Eksekusi langsung setelah loss
  // ============================================================================

  private async executeMartingaleRecovery(
    scheduleId: string,
    scheduledTime: string,
    trend: TrendType,
    martingaleStep: number
  ): Promise<void> {
    const recoveryExecutionId = uuidv4();
    const maxRetries = 3;
    let lastError: Error | null = null;

    this.logger.log(
      `🚀🚀🚀 MARTINGALE RECOVERY for schedule ${scheduleId.slice(-8)} at ${scheduledTime}, ` +
      `step: ${martingaleStep}, trend: ${trend.toUpperCase()}`
    );

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Fetch latest schedule data
        const latestSchedule = await this.getLatestSchedule(scheduleId);

        if (!latestSchedule) {
          throw new Error(`Schedule ${scheduleId} not found`);
        }

        // Calculate amount untuk recovery step
        const amount = this.orderScheduleService.calculateMartingaleAmount(
          latestSchedule.amount,
          martingaleStep,
          latestSchedule.martingaleSetting.multiplier
        );

        this.logger.log(
          `💰 Recovery amount for ${scheduledTime}: Base=${latestSchedule.amount}, ` +
          `Step=${martingaleStep} → Final=${amount.toLocaleString()}`
        );

        // ✅ FIX: Check balance untuk real account menggunakan BalanceService
        if (latestSchedule.accountType === 'real') {
          const hasBalance = await this.checkUserBalance(latestSchedule.userId, amount);

          if (!hasBalance) {
            this.logger.warn(`⚠️ Insufficient balance for recovery ${scheduledTime}: required ${amount.toLocaleString()}`);

            await this.recordRecoveryExecution(
              recoveryExecutionId,
              latestSchedule,
              trend,
              scheduledTime,
              amount,
              martingaleStep,
              'failed',
              'Insufficient balance for recovery'
            );
            return;
          }
        }

        // Create recovery order
        let orderId: string;
        try {
          orderId = await this.createBinaryOrderWithVerification(
            latestSchedule, 
            trend, 
            amount, 
            scheduledTime
          );

          this.logger.log(`✅ Recovery order created for ${scheduledTime}: ${orderId.slice(-8)}`);
        } catch (createError) {
          this.logger.error(
            `❌ Failed to create recovery order (attempt ${attempt + 1}/${maxRetries}): ${createError.message}`
          );

          if (attempt < maxRetries - 1) {
            const delay = 2000 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          throw createError;
        }

        // Record recovery execution
        await this.recordRecoveryExecution(
          recoveryExecutionId,
          latestSchedule,
          trend,
          scheduledTime,
          amount,
          martingaleStep,
          'executed',
          undefined,
          orderId
        );

        this.logger.log(
          `✅✅✅ Recovery order ${orderId.slice(-8)} executed successfully for ${scheduledTime} at step ${martingaleStep}`
        );

        return;

      } catch (error) {
        lastError = error;

        if (attempt < maxRetries - 1) {
          const delay = 2000 * Math.pow(2, attempt);
          this.logger.warn(`⚠️ Recovery attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    this.logger.error(
      `❌❌❌ CRITICAL: Recovery failed after ${maxRetries} attempts for ${scheduledTime}: ${lastError?.message}`
    );

    try {
      const latestSchedule = await this.getLatestSchedule(scheduleId);

      if (latestSchedule) {
        await this.recordRecoveryExecution(
          recoveryExecutionId,
          latestSchedule,
          trend,
          scheduledTime,
          latestSchedule.amount,
          martingaleStep,
          'failed',
          `Failed after ${maxRetries} retries: ${lastError?.message}`
        );
      }
    } catch (recordError) {
      this.logger.error(`❌ Failed to record failed recovery: ${recordError.message}`);
    }
  }

  // ============================================================================
  // ✅ Record Recovery Execution
  // ============================================================================

  private async recordRecoveryExecution(
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
      isRecoveryAttempt: true, // ✅ Mark sebagai recovery
      status,
      errorMessage,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await this.db.collection(this.executionsCollection).doc(executionId).set(execution);

      this.logger.debug(
        `✅ Recovery execution recorded: ${executionId.slice(-8)} (${scheduledTime}, step ${martingaleStep}, status: ${status})`
      );
    } catch (error) {
      this.logger.error(`❌ Failed to record recovery execution: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // ✅ FIX: Helper: Check User Balance — pakai BalanceService bukan query langsung
  // 
  // BUG SEBELUMNYA:
  //   Query langsung ke collection 'balance' ambil dokumen pertama tanpa filter
  //   accountType, lalu baca field 'real_balance' yang tidak ada di dokumen
  //   (dokumen menyimpan 'amount' + 'accountType' per transaksi).
  //   Akibatnya: undefined >= requiredAmount → selalu false → selalu gagal.
  // ============================================================================
  private async checkUserBalance(userId: string, requiredAmount: number): Promise<boolean> {
    try {
      const balance = await this.balanceService.getCurrentBalanceStrict(userId, 'real');
      const hasEnough = balance >= requiredAmount;
      this.logger.debug(`💰 Balance check: ${balance.toLocaleString()} vs ${requiredAmount.toLocaleString()} = ${hasEnough}`);
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
    this.completedSchedules.clear();
    this.activeRecoveries.clear();
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
      
      // Cek dan hapus jika sudah selesai
      await this.checkAndDeleteIfAllCompleted(schedule);

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
      completedSchedulesCount: this.completedSchedules.size,
      activeRecoveriesCount: this.activeRecoveries.size,
      mode: '1 Day Only - Auto Delete After Completion',
      features: {
        checkInterval: '10 seconds',
        autoDelete: true,
        perTimeState: true,
        instantMartingaleRecovery: true,
      }
    };
  }
}