// src/order-schedule/order-schedule-executor.service.ts
// VERSI 1 HARI - AUTO DELETE SETELAH SEMUA ORDER SELESAI
//
// ╔══════════════════════════════════════════════════════════════╗
// ║  FIXES                                                       ║
// ║  #1  handleScheduledOrders cron: */10 → */5                  ║
// ║      → window miss dari 10s menjadi 5s                       ║
// ║                                                              ║
// ║  #2  checkPendingExecutions: non-blocking                    ║
// ║      SEBELUMNYA: checkOrderResultWithRetry menunggu 5s×6=    ║
// ║      30 detik inline di dalam lock → cron berikutnya terblok ║
// ║      FIX: skip order yang masih ACTIVE, biarkan cron berikut ║
// ║      yang cek ulang. Tidak ada setTimeout di dalam loop.      ║
// ║                                                              ║
// ║  #3  registerExternalOrder sudah dipanggil (sudah benar)     ║
// ║      → settlement tetap via processExpiredOrders (tiap 1s)   ║
// ╚══════════════════════════════════════════════════════════════╝

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service';
import { OrderScheduleService } from './order-schedule.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { BalanceService } from '../balance/balance.service';
import { BinaryOrdersService } from '../binary-orders/binary-orders.service';
import { BALANCE_TYPES } from '../common/constants';
import { ScheduleStatus, TrendType } from './dto/create-order-schedule.dto';
import { OrderSchedule, ScheduleExecution, OrderMartingaleState } from './entities/order-schedule.entity';

@Injectable()
export class OrderScheduleExecutorService {
  private readonly logger = new Logger(OrderScheduleExecutorService.name);

  private readonly schedulesCollection = 'order_schedules';
  private readonly executionsCollection = 'schedule_executions';
  private readonly ordersCollection     = 'binary_orders';
  private readonly assetsCollection     = 'assets';

  private isProcessingSchedules = false;
  private isCheckingResults     = false;

  // Key: "scheduleId:scheduledTime"
  private processedToday:     Set<string> = new Set();
  private completedSchedules: Set<string> = new Set();
  private activeRecoveries:   Set<string> = new Set();

  private checkResultsRunCount      = 0;
  private processSchedulesRunCount  = 0;

  constructor(
    private firebaseService: FirebaseService,
    private orderScheduleService: OrderScheduleService,
    private priceFetcherService: PriceFetcherService,
    private balanceService: BalanceService,
    private binaryOrdersService: BinaryOrdersService,
  ) {
    this.logger.log('✅ OrderScheduleExecutorService initialized');
    this.logger.log('🎯 MODE: 1 Schedule = 1 Hari (Auto-delete setelah selesai)');
  }

  private get db(): Firestore {
    return this.firebaseService.getFirestore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 1: Check scheduled orders setiap 5 detik
  // ✅ FIX #1: was */10 → now */5 → max miss window 5s instead of 10s
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('*/5 * * * * *')
  async handleScheduledOrders() {
    if (this.isProcessingSchedules) {
      this.processSchedulesRunCount++;
      return;
    }

    this.isProcessingSchedules = true;

    try {
      const currentTime    = this.getCurrentTime();
      const activeSchedules = await this.getActiveSchedules();

      for (const schedule of activeSchedules) {
        if (this.completedSchedules.has(schedule.id)) continue;
        await this.processSchedule(schedule, currentTime);
        await this.checkAndDeleteIfAllCompleted(schedule);
      }

      this.processSchedulesRunCount++;
    } catch (error) {
      this.logger.error(`❌ Error in handleScheduledOrders: ${error.message}`, error.stack);
    } finally {
      this.isProcessingSchedules = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 2: Check order results setiap 5 detik (non-blocking)
  // ✅ FIX #2: Tidak ada lagi setTimeout/blocking di dalam cron.
  //    - Jika order masih ACTIVE → skip, cron berikut yang cek ulang
  //    - Settlement actual dilakukan oleh processExpiredOrders (tiap 1s)
  //    - Fungsi ini hanya membaca result dan trigger martingale recovery
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('*/5 * * * * *')
  async checkPendingExecutions() {
    if (this.isCheckingResults) return;
    this.isCheckingResults = true;

    try {
      const now         = new Date();
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
        return;
      }

      this.logger.log(`🔍 Checking ${pendingExecutions.length} pending executions for results`);

      // ✅ FIX #2: Proses semua secara paralel, tanpa blocking per-execution
      await Promise.allSettled(
        pendingExecutions.map(async (execDoc) => {
          const execution = execDoc.data() as ScheduleExecution;
          try {
            await this.checkOrderResultNonBlocking(
              execution.scheduleId,
              execution.orderId!,
              execution.id,
              execution.scheduledTime,
            );

            // Cek dan hapus jika semua order sudah selesai
            const schedule = await this.getLatestSchedule(execution.scheduleId);
            if (schedule) {
              await this.checkAndDeleteIfAllCompleted(schedule);
            }
          } catch (error) {
            this.logger.error(`Error checking execution ${execution.id.slice(-8)}: ${error.message}`);
          }
        }),
      );

      this.checkResultsRunCount++;
    } catch (error) {
      this.logger.error(`❌ Error in checkPendingExecutions: ${error.message}`, error.stack);
    } finally {
      this.isCheckingResults = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ✅ FIX #2: Non-blocking result checker
  //    SEBELUMNYA (checkOrderResultWithRetry):
  //      - Retry 6x dengan setTimeout 5000ms antar retry
  //      - Total blocking sampai 30 detik per execution
  //      - Membuat checkPendingExecutions lock selama itu
  //
  //    SEKARANG (checkOrderResultNonBlocking):
  //      - Sekali cek saja per invocation
  //      - Jika ACTIVE → return langsung, cron berikut yang cek ulang
  //      - Tidak ada setTimeout, tidak ada blocking
  // ══════════════════════════════════════════════════════════════════════════

  private async checkOrderResultNonBlocking(
    scheduleId: string,
    orderId: string,
    executionId: string,
    scheduledTime: string,
  ): Promise<void> {
    try {
      const orderDoc = await this.db.collection(this.ordersCollection).doc(orderId).get();

      if (!orderDoc.exists) {
        this.logger.warn(`⚠️ Order ${orderId.slice(-8)} not found for execution ${executionId.slice(-8)}`);
        await this.db.collection(this.executionsCollection).doc(executionId).update({
          status:       'failed',
          errorMessage: 'Order not found',
          updatedAt:    new Date(),
        });
        return;
      }

      const order = orderDoc.data();
      if (!order) return;

      // ✅ ACTIVE → skip (processExpiredOrders akan settle, cron berikut baca hasilnya)
      if (order.status === 'ACTIVE') {
        const exitTime    = new Date(order.exit_time);
        const now         = new Date();
        const remainingMs = exitTime.getTime() - now.getTime();
        this.logger.debug(
          `⏳ Order ${orderId.slice(-8)} still ACTIVE for ${scheduledTime} ` +
          `(expires in ${Math.round(remainingMs / 1000)}s) — will check next cycle`,
        );
        return; // ← non-blocking: tidak tunggu, cron berikut yang cek ulang
      }

      // Order sudah settled oleh processExpiredOrders
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
        result:    mappedResult,
        profit,
        status:    'executed',
        updatedAt: new Date(),
      });

      this.logger.log(
        `✅ Execution ${executionId.slice(-8)} updated: ` +
        `${orderScheduledTime} → ${mappedResult.toUpperCase()} profit=${profit}`,
      );

      // Update schedule stats dan dapatkan info recovery
      const recoveryInfo = await this.updateAfterExecutionWithRecovery(
        scheduleId,
        orderScheduledTime,
        mappedResult,
        profit,
      );

      this.logger.log(
        `✅ Schedule ${scheduleId.slice(-8)} updated for ${orderScheduledTime}: ` +
        `${mappedResult.toUpperCase()} ${profit > 0 ? '+' : ''}${profit.toFixed(0)}`,
      );

      // Trigger martingale recovery jika loss dan masih bisa recover
      if (recoveryInfo.shouldRecover && recoveryInfo.trend) {
        const recoveryKey = `${scheduleId}:${orderScheduledTime}`;
        if (!this.activeRecoveries.has(recoveryKey)) {
          this.logger.log(
            `🔄 LOSS! Triggering martingale recovery for ${orderScheduledTime} ` +
            `(step ${recoveryInfo.currentStep} → ${recoveryInfo.nextStep})`,
          );
          this.activeRecoveries.add(recoveryKey);
          try {
            await this.executeMartingaleRecovery(
              scheduleId,
              orderScheduledTime,
              recoveryInfo.trend,
              recoveryInfo.nextStep,
            );
          } finally {
            this.activeRecoveries.delete(recoveryKey);
          }
        } else {
          this.logger.warn(`⚠️ Recovery already in progress for ${orderScheduledTime}, skipping`);
        }
      } else if (mappedResult === 'loss') {
        this.logger.log(
          `🛑 Max martingale step reached for ${orderScheduledTime} — time slot COMPLETED.`,
        );
      }

    } catch (error) {
      this.logger.error(`❌ checkOrderResultNonBlocking error: ${error.message}`);
      // Jangan throw — biarkan Promise.allSettled tangani error per-execution
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Cek dan hapus schedule jika semua order sudah selesai
  // ══════════════════════════════════════════════════════════════════════════

  private async checkAndDeleteIfAllCompleted(schedule: OrderSchedule): Promise<void> {
    try {
      const allScheduledTimes = schedule.schedules.map(s => s.time);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const executionsSnapshot = await this.db
        .collection(this.executionsCollection)
        .where('scheduleId', '==', schedule.id)
        .where('executedAt', '>=', today)
        .get();

      const executionsByTime = new Map<string, any[]>();
      executionsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const time = data.scheduledTime;
        if (!executionsByTime.has(time)) executionsByTime.set(time, []);
        executionsByTime.get(time)!.push(data);
      });

      const orderStates = (schedule as any).orderMartingaleStates || [] as OrderMartingaleState[];
      const completedTimeSlots:     string[] = [];
      const pendingRecoveryTimeSlots: string[] = [];

      for (const time of allScheduledTimes) {
        const timeExecutions = executionsByTime.get(time) || [];
        const orderState     = orderStates.find((s: OrderMartingaleState) => s.scheduledTime === time);
        const recoveryKey    = `${schedule.id}:${time}`;
        const isRecoveryActive = this.activeRecoveries.has(recoveryKey);

        const sortedExecutions = timeExecutions
          .filter((e: any) => e.result != null)
          .sort((a: any, b: any) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());

        const lastExecution = sortedExecutions[0];

        if (!lastExecution) {
          pendingRecoveryTimeSlots.push(`${time}(no-result)`);
          continue;
        }

        if (lastExecution.result === 'win') {
          completedTimeSlots.push(time);
        } else if (lastExecution.result === 'loss') {
          const currentStep = orderState?.currentStep || 0;
          const maxStep     = schedule.martingaleSetting.maxStep;

          if (currentStep > 0 && currentStep <= maxStep && !isRecoveryActive) {
            pendingRecoveryTimeSlots.push(`${time}(step:${currentStep}/${maxStep})`);
          } else if (isRecoveryActive) {
            pendingRecoveryTimeSlots.push(`${time}(recovery-active)`);
          } else {
            completedTimeSlots.push(time); // max step reached
          }
        } else {
          completedTimeSlots.push(time); // draw = completed
        }
      }

      if (pendingRecoveryTimeSlots.length > 0) {
        this.logger.debug(
          `⏳ Schedule ${schedule.id.slice(-8)} has pending: ` +
          `${pendingRecoveryTimeSlots.join(', ')} — NOT deleting`,
        );
        return;
      }

      if (completedTimeSlots.length === allScheduledTimes.length) {
        this.logger.log(
          `✅ Schedule ${schedule.id.slice(-8)} completed! ` +
          `All ${allScheduledTimes.length} time slots done. Auto-deleting...`,
        );
        await this.db.collection(this.schedulesCollection).doc(schedule.id).delete();
        this.completedSchedules.add(schedule.id);

        for (const time of allScheduledTimes) {
          this.processedToday.delete(`${schedule.id}:${time}`);
          this.activeRecoveries.delete(`${schedule.id}:${time}`);
        }
        this.logger.log(`🗑️ Schedule ${schedule.id.slice(-8)} deleted`);
      }
    } catch (error) {
      this.logger.error(`❌ Error checking/deleting completed schedule: ${error.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helper: Get Active Schedules
  // ══════════════════════════════════════════════════════════════════════════

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

  private async getLatestSchedule(scheduleId: string): Promise<OrderSchedule | null> {
    try {
      const doc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();
      if (!doc.exists) return null;
      return doc.data() as OrderSchedule;
    } catch (error) {
      this.logger.error(`❌ Error fetching schedule: ${error.message}`);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Process 1 Schedule
  // ══════════════════════════════════════════════════════════════════════════

  private async processSchedule(schedule: OrderSchedule, currentTime: string) {
    try {
      const shouldStop = await this.orderScheduleService.checkStopLossProfit(schedule.id);
      if (shouldStop) {
        this.logger.log(`🛑 Schedule ${schedule.id.slice(-8)} stopped (stop loss/profit)`);
        await this.db.collection(this.schedulesCollection).doc(schedule.id).delete();
        this.completedSchedules.add(schedule.id);
        return;
      }

      const scheduledOrders = schedule.schedules.filter(s => s.time === currentTime);
      if (scheduledOrders.length === 0) return;

      this.logger.log(
        `📋 Found ${scheduledOrders.length} orders at ${currentTime} for schedule ${schedule.id.slice(-8)}`,
      );

      for (const scheduledOrder of scheduledOrders) {
        const cacheKey = `${schedule.id}:${scheduledOrder.time}`;
        if (this.processedToday.has(cacheKey)) continue;

        const alreadyExecuted = await this.checkAlreadyExecutedToday(
          schedule.id, scheduledOrder.time,
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
        error.stack,
      );
    }
  }

  private async checkAlreadyExecutedToday(scheduleId: string, scheduledTime: string): Promise<boolean> {
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

  // ══════════════════════════════════════════════════════════════════════════
  // EXECUTE ORDER - dengan Martingale per scheduledTime
  // ══════════════════════════════════════════════════════════════════════════

  private async executeOrder(
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string,
  ) {
    const executionId = uuidv4();
    const maxRetries  = 3;
    let lastError: Error | null = null;

    this.logger.log(
      `🚀 Executing order for schedule ${schedule.id.slice(-8)} at ${scheduledTime}, ` +
      `trend: ${trend.toUpperCase()}`,
    );

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const latestSchedule = await this.getLatestSchedule(schedule.id);
        if (!latestSchedule) throw new Error(`Schedule ${schedule.id} not found`);

        const orderState = this.orderScheduleService.getOrderMartingaleState(
          latestSchedule, scheduledTime,
        );
        const amount = this.orderScheduleService.calculateMartingaleAmount(
          latestSchedule.amount,
          orderState.currentStep,
          latestSchedule.martingaleSetting.multiplier,
        );

        this.logger.log(
          `💰 ${scheduledTime}: Base=${latestSchedule.amount}, ` +
          `Step=${orderState.currentStep} → Final=${amount.toLocaleString()}`,
        );

        if (latestSchedule.accountType === 'real') {
          const hasBalance = await this.checkUserBalance(latestSchedule.userId, amount);
          if (!hasBalance) {
            this.logger.warn(`⚠️ Insufficient balance for ${scheduledTime}`);
            await this.recordExecution(
              executionId, latestSchedule, trend, scheduledTime,
              amount, orderState.currentStep, 'failed', 'Insufficient balance',
            );
            return;
          }
        }

        let orderId: string;
        try {
          orderId = await this.createBinaryOrderWithVerification(
            latestSchedule, trend, amount, scheduledTime,
          );
          this.logger.log(`✅ Order created for ${scheduledTime}: ${orderId.slice(-8)}`);
        } catch (createError) {
          this.logger.error(
            `❌ Failed to create order (attempt ${attempt + 1}/${maxRetries}): ${createError.message}`,
          );
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            continue;
          }
          throw createError;
        }

        await this.recordExecution(
          executionId, latestSchedule, trend, scheduledTime,
          amount, orderState.currentStep, 'executed', undefined, orderId,
        );

        this.logger.log(
          `✅ Order ${orderId.slice(-8)} executed for ${scheduledTime} at step ${orderState.currentStep}`,
        );
        return;

      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    this.logger.error(
      `❌ CRITICAL: Failed after ${maxRetries} attempts for ${scheduledTime}: ${lastError?.message}`,
    );
    try {
      const latestSchedule = await this.getLatestSchedule(schedule.id);
      if (latestSchedule) {
        const orderState = this.orderScheduleService.getOrderMartingaleState(latestSchedule, scheduledTime);
        await this.recordExecution(
          executionId, latestSchedule, trend, scheduledTime,
          latestSchedule.amount, orderState.currentStep, 'failed',
          `Failed after ${maxRetries} retries: ${lastError?.message}`,
        );
      }
    } catch (recordError) {
      this.logger.error(`❌ Failed to record failed execution: ${recordError.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Create Binary Order
  // ══════════════════════════════════════════════════════════════════════════

  private async getAssetName(assetSymbol: string): Promise<string> {
    try {
      const assetDoc = await this.db
        .collection(this.assetsCollection)
        .where('symbol', '==', assetSymbol)
        .limit(1)
        .get();
      if (!assetDoc.empty) {
        return assetDoc.docs[0].data().name || assetSymbol;
      }
    } catch {}
    return assetSymbol;
  }

  private async createBinaryOrderWithVerification(
    schedule: OrderSchedule,
    trend: TrendType,
    amount: number,
    scheduledTime: string,
  ): Promise<string> {
    const orderId  = uuidv4();
    const now      = new Date();
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
        assetId   = assetSnapshot.docs[0].id;
        try {
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(assetData, true);
          if (priceData?.price) {
            entryPrice = priceData.price;
            this.logger.log(`💰 Entry price for ${scheduledTime}: ${entryPrice}`);
          }
        } catch (priceError) {
          this.logger.warn(`⚠️ Price fallback: ${priceError.message}`);
          entryPrice = assetData.simulatorSettings?.initialPrice || assetData.initialPrice || 0;
        }
      } else {
        throw new Error(`Asset ${schedule.assetSymbol} not found`);
      }
    } catch (error) {
      throw error;
    }

    const durationInMinutes = schedule.duration / 60;
    const direction         = trend === 'buy' ? 'CALL' : 'PUT';

    // ✅ Expiry langsung = now + duration detik (konsisten dengan CTC/FastTrade fix)
    const expiryTime = new Date(now.getTime() + schedule.duration * 1000);

    const latestSchedule = await this.getLatestSchedule(schedule.id);
    const orderState     = latestSchedule
      ? this.orderScheduleService.getOrderMartingaleState(latestSchedule, scheduledTime)
      : { currentStep: 0 };

    const order = {
      id:           orderId,
      user_id:      schedule.userId,
      asset_id:     assetId,
      asset_symbol: schedule.assetSymbol,
      asset_name:   assetName,
      accountType:  schedule.accountType,
      direction,
      amount,
      duration:     durationInMinutes,
      entry_price:  entryPrice || 0,
      entry_time:   now.toISOString(),
      exit_price:   null,
      exit_time:    expiryTime.toISOString(),
      status:       'ACTIVE',
      profit:       null,
      is_scheduled: true,
      schedule_id:  schedule.id,
      scheduled_time: scheduledTime,
      createdAt:    now.toISOString(),
      updatedAt:    now.toISOString(),
      profitRate:   assetData?.profitRate || 85,
      baseProfitRate: assetData?.profitRate || 85,
      statusBonus:  0,
      userStatus:   'standard',
      metadata: {
        isScheduled:    true,
        scheduledAt:    now.toISOString(),
        scheduledTime,
        martingaleStep: orderState.currentStep,
        originalTrend:  trend,
      },
    };

    try {
      await this.db.collection(this.ordersCollection).doc(orderId).set(order);

      const verifyDoc = await this.db.collection(this.ordersCollection).doc(orderId).get();
      if (!verifyDoc.exists) throw new Error('Order verification failed');

      // registerExternalOrder sudah ada (tidak berubah dari sebelumnya)
      this.binaryOrdersService.registerExternalOrder(order as any);

      if (schedule.accountType === 'real') {
        try {
          await this.balanceService.createBalanceEntry(schedule.userId, {
            accountType: 'real',
            type:        BALANCE_TYPES.ORDER_DEBIT,
            amount:      -amount,
            description: `[REAL] Scheduled Order #${orderId.slice(-8)} - ${schedule.assetSymbol} ${direction}`,
          });
          this.balanceService.clearUserCache(schedule.userId);
        } catch (debitError) {
          this.logger.error(`❌ Debit failed, rolling back: ${debitError.message}`);
          await this.db.collection(this.ordersCollection).doc(orderId).delete();
          throw new Error(`Failed to debit balance: ${debitError.message}`);
        }
      }

      return orderId;
    } catch (error) {
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Record Execution
  // ══════════════════════════════════════════════════════════════════════════

  private async recordExecution(
    executionId: string,
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string,
    amount: number,
    martingaleStep: number,
    status: 'pending' | 'executed' | 'failed' | 'skipped',
    errorMessage?: string,
    orderId?: string,
  ) {
    const execution: ScheduleExecution = {
      id:             executionId,
      scheduleId:     schedule.id,
      userId:         schedule.userId,
      executedAt:     new Date(),
      scheduledTime,
      trend,
      orderId,
      assetSymbol:    schedule.assetSymbol,
      amount,
      duration:       schedule.duration,
      accountType:    schedule.accountType,
      martingaleStep,
      isRecoveryAttempt: martingaleStep > 0,
      status,
      errorMessage,
      createdAt:  new Date(),
      updatedAt:  new Date(),
    };

    try {
      await this.db.collection(this.executionsCollection).doc(executionId).set(execution);
    } catch (error) {
      this.logger.error(`❌ Failed to record execution: ${error.message}`);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UPDATE AFTER EXECUTION dengan Recovery Info
  // ══════════════════════════════════════════════════════════════════════════

  private async updateAfterExecutionWithRecovery(
    scheduleId: string,
    scheduledTime: string,
    executionResult: 'win' | 'loss' | 'draw',
    profit: number,
  ): Promise<{ shouldRecover: boolean; nextStep: number; currentStep: number; trend?: TrendType }> {
    try {
      const scheduleRef = this.db.collection(this.schedulesCollection).doc(scheduleId);
      const scheduleDoc = await scheduleRef.get();
      if (!scheduleDoc.exists) throw new Error('Schedule not found');

      const schedule = scheduleDoc.data() as OrderSchedule;
      const orderStates = [...((schedule as any).orderMartingaleStates || [])] as OrderMartingaleState[];
      const orderStateIndex = orderStates.findIndex(s => s.scheduledTime === scheduledTime);

      let orderState: OrderMartingaleState;
      if (orderStateIndex >= 0) {
        orderState = { ...orderStates[orderStateIndex] };
      } else {
        orderState = {
          scheduledTime,
          currentStep: 0, consecutiveLosses: 0, lastResult: null,
          lastExecutedAt: null, totalExecuted: 0, totalWins: 0, totalLosses: 0,
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
      } else if (executionResult === 'loss') {
        orderState.totalLosses++;
        orderState.consecutiveLosses++;
        if (orderState.currentStep < schedule.martingaleSetting.maxStep) {
          orderState.currentStep++;
          nextStep = orderState.currentStep;
          shouldRecover = true;
        } else {
          orderState.currentStep = 0;
        }
      }

      if (orderStateIndex >= 0) {
        orderStates[orderStateIndex] = orderState;
      } else {
        orderStates.push(orderState);
      }

      const updates: any = {
        totalExecuted:    FieldValue.increment(1),
        lastExecutedAt:   new Date(),
        lastExecutionResult: executionResult,
        updatedAt:        new Date(),
        currentProfit:    FieldValue.increment(profit),
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
        `✅ ${scheduledTime}: ${executionResult.toUpperCase()}, ` +
        `Step: ${previousStep} → ${orderState.currentStep}, ShouldRecover: ${shouldRecover}`,
      );

      const scheduledOrder = schedule.schedules.find(s => s.time === scheduledTime);
      return { shouldRecover, nextStep, currentStep: previousStep, trend: scheduledOrder?.trend };

    } catch (error) {
      this.logger.error(`❌ Error updating schedule after execution: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXECUTE MARTINGALE RECOVERY
  // ══════════════════════════════════════════════════════════════════════════

  private async executeMartingaleRecovery(
    scheduleId: string,
    scheduledTime: string,
    trend: TrendType,
    martingaleStep: number,
  ): Promise<void> {
    const recoveryExecutionId = uuidv4();
    const maxRetries = 3;
    let lastError: Error | null = null;

    this.logger.log(
      `🚀🚀🚀 MARTINGALE RECOVERY for ${scheduleId.slice(-8)} at ${scheduledTime}, ` +
      `step: ${martingaleStep}, trend: ${trend.toUpperCase()}`,
    );

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const latestSchedule = await this.getLatestSchedule(scheduleId);
        if (!latestSchedule) throw new Error(`Schedule ${scheduleId} not found`);

        const amount = this.orderScheduleService.calculateMartingaleAmount(
          latestSchedule.amount, martingaleStep, latestSchedule.martingaleSetting.multiplier,
        );

        if (latestSchedule.accountType === 'real') {
          const hasBalance = await this.checkUserBalance(latestSchedule.userId, amount);
          if (!hasBalance) {
            this.logger.warn(`⚠️ Insufficient balance for recovery ${scheduledTime}`);
            await this.recordRecoveryExecution(
              recoveryExecutionId, latestSchedule, trend, scheduledTime,
              amount, martingaleStep, 'failed', 'Insufficient balance for recovery',
            );
            return;
          }
        }

        let orderId: string;
        try {
          orderId = await this.createBinaryOrderWithVerification(
            latestSchedule, trend, amount, scheduledTime,
          );
        } catch (createError) {
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            continue;
          }
          throw createError;
        }

        await this.recordRecoveryExecution(
          recoveryExecutionId, latestSchedule, trend, scheduledTime,
          amount, martingaleStep, 'executed', undefined, orderId,
        );

        this.logger.log(
          `✅✅✅ Recovery order ${orderId.slice(-8)} executed for ${scheduledTime} at step ${martingaleStep}`,
        );
        return;

      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    this.logger.error(
      `❌❌❌ Recovery failed after ${maxRetries} attempts: ${lastError?.message}`,
    );
    try {
      const latestSchedule = await this.getLatestSchedule(scheduleId);
      if (latestSchedule) {
        await this.recordRecoveryExecution(
          recoveryExecutionId, latestSchedule, trend, scheduledTime,
          latestSchedule.amount, martingaleStep, 'failed',
          `Failed after ${maxRetries} retries: ${lastError?.message}`,
        );
      }
    } catch {}
  }

  private async recordRecoveryExecution(
    executionId: string,
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string,
    amount: number,
    martingaleStep: number,
    status: 'pending' | 'executed' | 'failed' | 'skipped',
    errorMessage?: string,
    orderId?: string,
  ) {
    const execution: ScheduleExecution = {
      id: executionId, scheduleId: schedule.id, userId: schedule.userId,
      executedAt: new Date(), scheduledTime, trend, orderId,
      assetSymbol: schedule.assetSymbol, amount, duration: schedule.duration,
      accountType: schedule.accountType, martingaleStep,
      isRecoveryAttempt: true, status, errorMessage,
      createdAt: new Date(), updatedAt: new Date(),
    };
    try {
      await this.db.collection(this.executionsCollection).doc(executionId).set(execution);
    } catch (error) {
      this.logger.error(`❌ Failed to record recovery execution: ${error.message}`);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helper: Check User Balance
  // ══════════════════════════════════════════════════════════════════════════

  private async checkUserBalance(userId: string, requiredAmount: number): Promise<boolean> {
    try {
      const balance  = await this.balanceService.getCurrentBalanceStrict(userId, 'real');
      const hasEnough = balance >= requiredAmount;
      this.logger.debug(
        `💰 Balance: ${balance.toLocaleString()} vs ${requiredAmount.toLocaleString()} = ${hasEnough}`,
      );
      return hasEnough;
    } catch (error) {
      this.logger.error(`❌ Error checking balance: ${error.message}`);
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Helper: Time
  // ══════════════════════════════════════════════════════════════════════════

  private getCurrentTime(): string {
    const now     = new Date();
    const hours   = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Daily Reset
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('0 0 * * *')
  private resetProcessedDaily() {
    this.logger.log('🔄 Resetting processed cache for new day');
    this.processedToday.clear();
    this.completedSchedules.clear();
    this.activeRecoveries.clear();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Manual Trigger (for testing)
  // ══════════════════════════════════════════════════════════════════════════

  async manualTrigger(scheduleId: string, time: string) {
    this.logger.log(`🔧 Manual trigger: ${scheduleId.slice(-8)} at ${time}`);
    try {
      const doc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();
      if (!doc.exists) throw new Error('Schedule not found');
      const schedule = doc.data() as OrderSchedule;
      await this.processSchedule(schedule, time);
      await this.checkAndDeleteIfAllCompleted(schedule);
      return { message: 'Manual trigger successful' };
    } catch (error) {
      this.logger.error(`❌ Manual trigger error: ${error.message}`);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Cleanup Old Executions
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('0 3 * * *')
  async cleanupOldExecutions() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
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

  // ══════════════════════════════════════════════════════════════════════════
  // Monitoring Stats
  // ══════════════════════════════════════════════════════════════════════════

  getExecutorStats() {
    return {
      isProcessingSchedules:   this.isProcessingSchedules,
      isCheckingResults:       this.isCheckingResults,
      processSchedulesRunCount: this.processSchedulesRunCount,
      checkResultsRunCount:    this.checkResultsRunCount,
      processedTodayCount:     this.processedToday.size,
      completedSchedulesCount: this.completedSchedules.size,
      activeRecoveriesCount:   this.activeRecoveries.size,
      mode:    '1 Day Only - Auto Delete After Completion',
      fixes: [
        '#1 Cron */5 (was */10) → max miss window 5s',
        '#2 Non-blocking result check (no more 30s stall)',
        '#3 registerExternalOrder already present',
      ],
    };
  }
}