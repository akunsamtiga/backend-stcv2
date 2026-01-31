// src/order-schedule/order-schedule-executor.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Firestore } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { OrderScheduleService } from './order-schedule.service';
import { ScheduleStatus, TrendType } from './dto/create-order-schedule.dto';
import { OrderSchedule, ScheduleExecution } from './entities/order-schedule.entity';

@Injectable()
export class OrderScheduleExecutorService {
  private readonly logger = new Logger(OrderScheduleExecutorService.name);
  private readonly db: Firestore;
  private readonly schedulesCollection = 'order_schedules';
  private readonly executionsCollection = 'schedule_executions';
  private readonly ordersCollection = 'binary_orders';

  constructor(
    private firestore: Firestore,
    private orderScheduleService: OrderScheduleService,
  ) {
    this.db = firestore;
  }

  /**
   * Cron job yang berjalan setiap menit untuk check dan execute schedules
   * Runs every minute: "* * * * *"
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledOrders() {
    this.logger.log('Checking for scheduled orders...');

    try {
      const currentTime = this.getCurrentTime(); // Format: HH:mm
      const activeSchedules = await this.getActiveSchedules();

      this.logger.log(`Found ${activeSchedules.length} active schedules`);

      for (const schedule of activeSchedules) {
        await this.processSchedule(schedule, currentTime);
      }
    } catch (error) {
      this.logger.error(`Error in scheduled orders handler: ${error.message}`, error.stack);
    }
  }

  /**
   * Dapatkan semua schedule yang aktif
   */
  private async getActiveSchedules(): Promise<OrderSchedule[]> {
    try {
      const snapshot = await this.db
        .collection(this.schedulesCollection)
        .where('status', '==', ScheduleStatus.ACTIVE)
        .where('isActive', '==', true)
        .get();

      return snapshot.docs.map(doc => doc.data() as OrderSchedule);
    } catch (error) {
      this.logger.error(`Error fetching active schedules: ${error.message}`);
      return [];
    }
  }

  /**
   * Process schedule dan execute order jika waktunya sudah tiba
   */
  private async processSchedule(schedule: OrderSchedule, currentTime: string) {
    try {
      this.logger.log(`Processing schedule ${schedule.id} for user ${schedule.userEmail}`);

      // Check apakah sudah mencapai stop loss/profit
      const shouldStop = await this.orderScheduleService.checkStopLossProfit(schedule.id);
      if (shouldStop) {
        this.logger.log(`Schedule ${schedule.id} stopped due to stop loss/profit limit`);
        return;
      }

      // Check apakah ada jadwal yang harus dieksekusi sekarang
      const scheduledOrders = schedule.schedules.filter(s => s.time === currentTime);

      if (scheduledOrders.length === 0) {
        return; // Tidak ada yang perlu dieksekusi
      }

      this.logger.log(`Found ${scheduledOrders.length} orders to execute for schedule ${schedule.id}`);

      // Execute setiap order yang dijadwalkan
      for (const scheduledOrder of scheduledOrders) {
        await this.executeOrder(schedule, scheduledOrder.trend, currentTime);
      }
    } catch (error) {
      this.logger.error(
        `Error processing schedule ${schedule.id}: ${error.message}`,
        error.stack
      );
    }
  }

  /**
   * Execute order dan catat execution
   */
  private async executeOrder(
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string
  ) {
    const executionId = uuidv4();
    const now = new Date();

    try {
      this.logger.log(
        `Executing order for schedule ${schedule.id}: ${trend} at ${scheduledTime}`
      );

      // Calculate amount dengan martingale
      const amount = this.orderScheduleService.calculateMartingaleAmount(
        schedule.amount,
        schedule.currentMartingaleStep,
        schedule.martingaleSetting.multiplier
      );

      this.logger.log(
        `Amount: ${amount} (base: ${schedule.amount}, step: ${schedule.currentMartingaleStep}, multiplier: ${schedule.martingaleSetting.multiplier})`
      );

      // Validasi balance jika real account
      if (schedule.accountType === 'real') {
        const hasBalance = await this.checkUserBalance(schedule.userId, amount);
        if (!hasBalance) {
          this.logger.warn(`Insufficient balance for user ${schedule.userId}`);
          await this.recordExecution(
            executionId,
            schedule,
            trend,
            scheduledTime,
            amount,
            'failed',
            'Insufficient balance'
          );
          return;
        }
      }

      // Create binary order
      const orderId = await this.createBinaryOrder(schedule, trend, amount);

      // Record execution
      await this.recordExecution(
        executionId,
        schedule,
        trend,
        scheduledTime,
        amount,
        'executed',
        undefined,
        orderId
      );

      this.logger.log(`Order executed successfully: ${orderId}`);

      // Setelah duration selesai, check hasil dan update schedule
      // Ini bisa dilakukan dengan cron job terpisah atau dengan setTimeout
      setTimeout(async () => {
        await this.checkOrderResult(schedule.id, orderId, executionId);
      }, schedule.duration * 1000);

    } catch (error) {
      this.logger.error(
        `Error executing order for schedule ${schedule.id}: ${error.message}`,
        error.stack
      );

      await this.recordExecution(
        executionId,
        schedule,
        trend,
        scheduledTime,
        schedule.amount,
        'failed',
        error.message
      );
    }
  }

  /**
   * Buat binary order
   */
  private async createBinaryOrder(
    schedule: OrderSchedule,
    trend: TrendType,
    amount: number
  ): Promise<string> {
    const orderId = uuidv4();
    const now = new Date();

    const order = {
      id: orderId,
      user_id: schedule.userId,
      asset_symbol: schedule.assetSymbol,
      asset_name: schedule.assetName || schedule.assetSymbol,
      account_type: schedule.accountType,
      amount: amount,
      trend: trend,
      duration: schedule.duration,
      status: 'pending',
      entry_price: 0, // Will be set by trading engine
      exit_price: 0,
      profit: 0,
      result: null,
      is_scheduled: true, // Flag untuk order dari schedule
      schedule_id: schedule.id,
      created_at: now,
      updated_at: now,
      expires_at: new Date(now.getTime() + schedule.duration * 1000),
    };

    await this.db.collection(this.ordersCollection).doc(orderId).set(order);

    return orderId;
  }

  /**
   * Record execution ke database
   */
  private async recordExecution(
    executionId: string,
    schedule: OrderSchedule,
    trend: TrendType,
    scheduledTime: string,
    amount: number,
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
      martingaleStep: schedule.currentMartingaleStep,
      isRecoveryAttempt: schedule.currentMartingaleStep > 0,
      status,
      errorMessage,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.collection(this.executionsCollection).doc(executionId).set(execution);
  }

  /**
   * Check hasil order setelah duration selesai
   */
  private async checkOrderResult(
    scheduleId: string,
    orderId: string,
    executionId: string
  ) {
    try {
      this.logger.log(`Checking result for order ${orderId}`);

      // Get order result
      const orderDoc = await this.db.collection(this.ordersCollection).doc(orderId).get();

      if (!orderDoc.exists) {
        this.logger.warn(`Order ${orderId} not found`);
        return;
      }

      const order = orderDoc.data();

      if (!order) {
        this.logger.warn(`Order ${orderId} has no data`);
        return;
      }

      // Update execution dengan hasil
      await this.db.collection(this.executionsCollection).doc(executionId).update({
        result: order.result,
        profit: order.profit,
        updatedAt: new Date(),
      });

      // Update schedule tracking
      await this.orderScheduleService.updateAfterExecution(
        scheduleId,
        order.result,
        order.profit
      );

      this.logger.log(
        `Order ${orderId} completed with result: ${order.result}, profit: ${order.profit}`
      );
    } catch (error) {
      this.logger.error(
        `Error checking order result ${orderId}: ${error.message}`,
        error.stack
      );
    }
  }

  /**
   * Check user balance
   */
  private async checkUserBalance(userId: string, requiredAmount: number): Promise<boolean> {
    try {
      const balanceSnapshot = await this.db
        .collection('balance')
        .where('user_id', '==', userId)
        .limit(1)
        .get();

      if (balanceSnapshot.empty) {
        return false;
      }

      const balance = balanceSnapshot.docs[0].data();
      return balance.real_balance >= requiredAmount;
    } catch (error) {
      this.logger.error(`Error checking user balance: ${error.message}`);
      return false;
    }
  }

  /**
   * Get current time in HH:mm format
   */
  private getCurrentTime(): string {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Manual trigger untuk testing (optional)
   */
  async manualTrigger(scheduleId: string, time: string) {
    this.logger.log(`Manual trigger for schedule ${scheduleId} at ${time}`);

    try {
      const doc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();

      if (!doc.exists) {
        throw new Error('Schedule not found');
      }

      const schedule = doc.data() as OrderSchedule;
      await this.processSchedule(schedule, time);

      return { message: 'Manual trigger executed successfully' };
    } catch (error) {
      this.logger.error(`Error in manual trigger: ${error.message}`);
      throw error;
    }
  }
}