// src/order-schedule/order-schedule-executor.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Firestore } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service';
import { OrderScheduleService } from './order-schedule.service';
import { ScheduleStatus, TrendType } from './dto/create-order-schedule.dto';
import { OrderSchedule, ScheduleExecution } from './entities/order-schedule.entity';

@Injectable()
export class OrderScheduleExecutorService {
  private readonly logger = new Logger(OrderScheduleExecutorService.name);
  
  private readonly schedulesCollection = 'order_schedules';
  private readonly executionsCollection = 'schedule_executions';
  private readonly ordersCollection = 'binary_orders';
  private readonly assetsCollection = 'assets'; // ✅ TAMBAHAN

  // ✅ FIX #2: Add lock mechanism untuk prevent race condition
  private isProcessingSchedules = false;
  private isCheckingResults = false;

  constructor(
    private firebaseService: FirebaseService,
    private orderScheduleService: OrderScheduleService,
  ) {}

  private get db(): Firestore {
    return this.firebaseService.getFirestore();
  }

  /**
   * ✅ FIX #2: Cron job dengan race condition protection
   * Runs every minute: "* * * * *"
   */
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

  /**
   * ✅ FIX #1: NEW - Separate cron job untuk check pending order results
   * Runs every 30 seconds untuk reliability
   */
  @Cron('*/30 * * * * *') // Every 30 seconds
  async checkPendingOrderResults() {
    if (this.isCheckingResults) {
      this.logger.debug('⏭️ Skipping result check - previous check still running');
      return;
    }

    this.isCheckingResults = true;

    try {
      this.logger.debug('🔍 Checking pending order results...');
      
      const snapshot = await this.db
        .collection(this.executionsCollection)
        .where('status', '==', 'executed')
        .get();

      if (snapshot.empty) {
        this.logger.debug('📭 No pending executions to check');
        return;
      }

      const now = new Date();
      let checkedCount = 0;
      
      for (const doc of snapshot.docs) {
        const execution = doc.data() as ScheduleExecution;
        
        // Skip jika sudah ada result
        if (execution.result) {
          continue;
        }
        
        // Check jika sudah lewat duration + buffer (10 detik)
        const executedTime = execution.executedAt instanceof Date 
          ? execution.executedAt 
          : new Date(execution.executedAt);
        
        const expectedEndTime = new Date(
          executedTime.getTime() + (execution.duration + 10) * 1000
        );
        
        if (now >= expectedEndTime && execution.orderId) {
          this.logger.log(`⏰ Checking result for overdue execution: ${execution.id}`);
          await this.checkOrderResultWithRetry(
            execution.scheduleId,
            execution.orderId,
            execution.id
          );
          checkedCount++;
        }
      }

      if (checkedCount > 0) {
        this.logger.log(`✅ Checked ${checkedCount} pending order results`);
      }
    } catch (error) {
      this.logger.error(`❌ Error checking pending results: ${error.message}`, error.stack);
    } finally {
      this.isCheckingResults = false;
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
      this.logger.error(`❌ Error fetching active schedules: ${error.message}`);
      return [];
    }
  }

  /**
   * Process schedule dan execute order jika waktunya sudah tiba
   */
  private async processSchedule(schedule: OrderSchedule, currentTime: string) {
    try {
      this.logger.log(`🔄 Processing schedule ${schedule.id} for user ${schedule.userEmail}`);

      // Check apakah sudah mencapai stop loss/profit
      const shouldStop = await this.orderScheduleService.checkStopLossProfit(schedule.id);
      if (shouldStop) {
        this.logger.log(`🛑 Schedule ${schedule.id} stopped due to stop loss/profit limit`);
        return;
      }

      // Check apakah ada jadwal yang harus dieksekusi sekarang
      const scheduledOrders = schedule.schedules.filter(s => s.time === currentTime);

      if (scheduledOrders.length === 0) {
        return;
      }

      this.logger.log(`📋 Found ${scheduledOrders.length} orders to execute for schedule ${schedule.id}`);

      // Execute setiap order yang dijadwalkan
      for (const scheduledOrder of scheduledOrders) {
        // ✅ FIX #4: Check if already executed today
        const alreadyExecuted = await this.checkAlreadyExecutedToday(
          schedule.id,
          scheduledOrder.time
        );

        if (alreadyExecuted) {
          this.logger.log(
            `⏭️ Skipping ${scheduledOrder.time} - already executed today for schedule ${schedule.id}`
          );
          continue;
        }

        await this.executeOrder(schedule, scheduledOrder.trend, currentTime);
      }
    } catch (error) {
      this.logger.error(
        `❌ Error processing schedule ${schedule.id}: ${error.message}`,
        error.stack
      );
    }
  }

  /**
   * ✅ FIX #4: Check apakah waktu tertentu sudah di-execute hari ini
   */
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
        .where('executedAt', '>=', today)
        .limit(1)
        .get();
      
      return !snapshot.empty;
    } catch (error) {
      this.logger.error(`Error checking execution history: ${error.message}`);
      return false;
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

    try {
      this.logger.log(
        `🚀 Executing order for schedule ${schedule.id}: ${trend} at ${scheduledTime}`
      );

      // Calculate amount dengan martingale
      const amount = this.orderScheduleService.calculateMartingaleAmount(
        schedule.amount,
        schedule.currentMartingaleStep,
        schedule.martingaleSetting.multiplier
      );

      this.logger.log(
        `💰 Amount: ${amount} (base: ${schedule.amount}, step: ${schedule.currentMartingaleStep}, multiplier: ${schedule.martingaleSetting.multiplier})`
      );

      // Validasi balance jika real account
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

      this.logger.log(`✅ Order executed successfully: ${orderId}`);

      // ✅ FIX #1: HAPUS setTimeout, gunakan cron job checkPendingOrderResults sebagai gantinya
      // setTimeout akan hilang jika server restart!
      
    } catch (error) {
      this.logger.error(
        `❌ Error executing order for schedule ${schedule.id}: ${error.message}`,
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
   * ✅ FIX #3: Get asset name from database atau gunakan symbol
   */
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

    // ✅ FIX #3: Get asset name properly
    const assetName = schedule.assetName || await this.getAssetName(schedule.assetSymbol);

    const order = {
      id: orderId,
      user_id: schedule.userId,
      asset_symbol: schedule.assetSymbol,
      asset_name: assetName,
      account_type: schedule.accountType,
      amount: amount,
      trend: trend,
      duration: schedule.duration,
      status: 'pending',
      entry_price: 0,
      exit_price: 0,
      profit: 0,
      result: null,
      is_scheduled: true,
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
   * ✅ FIX #5: Check hasil order dengan retry mechanism
   */
  private async checkOrderResultWithRetry(
    scheduleId: string,
    orderId: string,
    executionId: string
  ) {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        this.logger.log(
          `🔍 Checking result for order ${orderId} (attempt ${attempt + 1}/${maxRetries})`
        );

        const orderDoc = await this.db
          .collection(this.ordersCollection)
          .doc(orderId)
          .get();

        if (!orderDoc.exists) {
          if (attempt < maxRetries - 1) {
            this.logger.warn(`⚠️ Order ${orderId} not found, retrying in 2s...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempt++;
            continue;
          }
          
          this.logger.error(`❌ Order ${orderId} not found after ${maxRetries} attempts`);
          
          // Mark execution as failed
          await this.db.collection(this.executionsCollection).doc(executionId).update({
            status: 'failed',
            errorMessage: 'Order not found',
            updatedAt: new Date(),
          });
          
          return;
        }

        const order = orderDoc.data();

        if (!order || !order.result) {
          if (attempt < maxRetries - 1) {
            this.logger.warn(`⚠️ Order ${orderId} has no result yet, retrying in 2s...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempt++;
            continue;
          }
          
          this.logger.warn(`⚠️ Order ${orderId} has no result after ${maxRetries} attempts`);
          return;
        }

        // Update execution dengan hasil
        await this.db.collection(this.executionsCollection).doc(executionId).update({
          result: order.result,
          profit: order.profit || 0,
          status: 'executed', // Ensure status is updated
          updatedAt: new Date(),
        });

        // Update schedule tracking
        await this.orderScheduleService.updateAfterExecution(
          scheduleId,
          order.result,
          order.profit || 0
        );

        this.logger.log(
          `✅ Order ${orderId} completed: ${order.result}, profit: ${order.profit}`
        );
        
        return;

      } catch (error) {
        this.logger.error(
          `❌ Error checking order result ${orderId} (attempt ${attempt + 1}): ${error.message}`
        );
        
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          attempt++;
        } else {
          // Mark as failed after all retries
          try {
            await this.db.collection(this.executionsCollection).doc(executionId).update({
              status: 'failed',
              errorMessage: `Failed after ${maxRetries} retries: ${error.message}`,
              updatedAt: new Date(),
            });
          } catch (updateError) {
            this.logger.error(`Failed to update execution status: ${updateError.message}`);
          }
          
          throw error;
        }
      }
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
      this.logger.error(`❌ Error checking user balance: ${error.message}`);
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
    this.logger.log(`🔧 Manual trigger for schedule ${scheduleId} at ${time}`);

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

  /**
   * ✅ NEW: Manual trigger untuk check specific order result
   */
  async manualCheckOrderResult(orderId: string, executionId: string) {
    this.logger.log(`🔧 Manual check for order ${orderId}`);

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
}