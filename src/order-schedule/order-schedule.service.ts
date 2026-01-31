// src/order-schedule/order-schedule.service.ts

import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Firestore } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service'; // ✅ Import FirebaseService
import { 
  CreateOrderScheduleDto,
  ScheduleStatus 
} from './dto/create-order-schedule.dto';
import { UpdateOrderScheduleDto } from './dto/update-order-schedule.dto';
import { QueryOrderScheduleDto } from './dto/query-order-schedule.dto';
import { OrderSchedule, ScheduleExecution, ScheduleStatistics } from './entities/order-schedule.entity';

@Injectable()
export class OrderScheduleService {
  private readonly db: Firestore;
  private readonly schedulesCollection = 'order_schedules';
  private readonly executionsCollection = 'schedule_executions';
  private readonly statisticsCollection = 'schedule_statistics';

  // ✅ PERBAIKAN: Inject FirebaseService instead of Firestore
  constructor(private firebaseService: FirebaseService) {
    this.db = this.firebaseService.getFirestore();
  }

  /**
   * Membuat schedule order baru
   */
  async create(userId: string, userEmail: string, createDto: CreateOrderScheduleDto): Promise<OrderSchedule> {
    try {
      // Validasi waktu schedule
      this.validateScheduleTimes(createDto.schedules);
      
      // Validasi asset exists (optional - bisa ditambahkan)
      // await this.validateAssetExists(createDto.assetSymbol);
      
      // Validasi balance jika real account
      if (createDto.accountType === 'real') {
        await this.validateUserBalance(userId, createDto.amount);
      }

      const scheduleId = uuidv4();
      const now = new Date();

      const newSchedule: OrderSchedule = {
        id: scheduleId,
        userId,
        userEmail,
        assetSymbol: createDto.assetSymbol,
        accountType: createDto.accountType,
        duration: createDto.duration,
        amount: createDto.amount,
        schedules: createDto.schedules,
        martingaleSetting: createDto.martingaleSetting,
        stopLossProfit: createDto.stopLossProfit,
        status: ScheduleStatus.PENDING,
        isActive: createDto.isActive ?? true,
        totalExecuted: 0,
        totalSuccess: 0,
        totalFailed: 0,
        currentProfit: 0,
        totalProfit: 0,
        totalLoss: 0,
        currentMartingaleStep: 0,
        consecutiveLosses: 0,
        notes: createDto.notes,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.collection(this.schedulesCollection).doc(scheduleId).set(newSchedule);

      return newSchedule;
    } catch (error) {
      throw new BadRequestException(`Failed to create order schedule: ${error.message}`);
    }
  }

  /**
   * Mendapatkan semua schedule milik user
   */
  async findAll(userId: string, query?: QueryOrderScheduleDto): Promise<OrderSchedule[]> {
    try {
      let firestoreQuery = this.db
        .collection(this.schedulesCollection)
        .where('userId', '==', userId);

      // Apply filters
      if (query?.accountType) {
        firestoreQuery = firestoreQuery.where('accountType', '==', query.accountType);
      }

      if (query?.status) {
        firestoreQuery = firestoreQuery.where('status', '==', query.status);
      }

      if (query?.assetSymbol) {
        firestoreQuery = firestoreQuery.where('assetSymbol', '==', query.assetSymbol);
      }

      if (query?.fromDate) {
        firestoreQuery = firestoreQuery.where('createdAt', '>=', new Date(query.fromDate));
      }

      if (query?.toDate) {
        firestoreQuery = firestoreQuery.where('createdAt', '<=', new Date(query.toDate));
      }

      const snapshot = await firestoreQuery.orderBy('createdAt', 'desc').get();

      return snapshot.docs.map(doc => doc.data() as OrderSchedule);
    } catch (error) {
      throw new BadRequestException(`Failed to fetch schedules: ${error.message}`);
    }
  }

  /**
   * Mendapatkan detail schedule by ID
   */
  async findOne(userId: string, scheduleId: string): Promise<OrderSchedule> {
    try {
      const doc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();

      if (!doc.exists) {
        throw new NotFoundException('Order schedule not found');
      }

      const schedule = doc.data() as OrderSchedule;

      // Verify ownership
      if (schedule.userId !== userId) {
        throw new ForbiddenException('You do not have access to this schedule');
      }

      return schedule;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch schedule: ${error.message}`);
    }
  }

  /**
   * Update schedule
   */
  async update(
    userId: string, 
    scheduleId: string, 
    updateDto: UpdateOrderScheduleDto
  ): Promise<OrderSchedule> {
    try {
      const schedule = await this.findOne(userId, scheduleId);

      // Tidak bisa update schedule yang sedang active/running
      if (schedule.status === ScheduleStatus.ACTIVE && updateDto.schedules) {
        throw new BadRequestException('Cannot modify schedules of an active schedule. Please pause it first.');
      }

      // Validasi waktu jika ada update schedules
      if (updateDto.schedules) {
        this.validateScheduleTimes(updateDto.schedules);
      }

      const updatedData: Record<string, any> = {
        ...updateDto,
        updatedAt: new Date(),
      };

      // Handle status changes
      if (updateDto.status === ScheduleStatus.ACTIVE && schedule.status !== ScheduleStatus.ACTIVE) {
        updatedData.startedAt = new Date();
      } else if (updateDto.status === ScheduleStatus.PAUSED) {
        updatedData.pausedAt = new Date();
      } else if (updateDto.status === ScheduleStatus.COMPLETED || updateDto.status === ScheduleStatus.CANCELLED) {
        updatedData.completedAt = new Date();
      }

      await this.db.collection(this.schedulesCollection)
        .doc(scheduleId)
        .update(updatedData);

      return this.findOne(userId, scheduleId);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update schedule: ${error.message}`);
    }
  }

  /**
   * Delete/Cancel schedule
   */
  async remove(userId: string, scheduleId: string): Promise<{ message: string }> {
    try {
      const schedule = await this.findOne(userId, scheduleId);

      // Tidak bisa delete schedule yang sedang active
      if (schedule.status === ScheduleStatus.ACTIVE) {
        throw new BadRequestException('Cannot delete an active schedule. Please pause or cancel it first.');
      }

      await this.db.collection(this.schedulesCollection).doc(scheduleId).delete();

      return { message: 'Order schedule deleted successfully' };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new BadRequestException(`Failed to delete schedule: ${error.message}`);
    }
  }

  /**
   * Activate/Start schedule
   */
  async activateSchedule(userId: string, scheduleId: string): Promise<OrderSchedule> {
    return this.update(userId, scheduleId, { 
      status: ScheduleStatus.ACTIVE,
      isActive: true 
    });
  }

  /**
   * Pause schedule
   */
  async pauseSchedule(userId: string, scheduleId: string): Promise<OrderSchedule> {
    return this.update(userId, scheduleId, { 
      status: ScheduleStatus.PAUSED,
      isActive: false 
    });
  }

  /**
   * Get execution history
   */
  async getExecutionHistory(
    userId: string, 
    scheduleId: string,
    limit: number = 50
  ): Promise<ScheduleExecution[]> {
    try {
      // Verify ownership
      await this.findOne(userId, scheduleId);

      const snapshot = await this.db
        .collection(this.executionsCollection)
        .where('scheduleId', '==', scheduleId)
        .where('userId', '==', userId)
        .orderBy('executedAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => doc.data() as ScheduleExecution);
    } catch (error) {
      throw new BadRequestException(`Failed to fetch execution history: ${error.message}`);
    }
  }

  /**
   * Get statistics
   */
  async getStatistics(userId: string, scheduleId: string): Promise<ScheduleStatistics[]> {
    try {
      // Verify ownership
      await this.findOne(userId, scheduleId);

      const snapshot = await this.db
        .collection(this.statisticsCollection)
        .where('scheduleId', '==', scheduleId)
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(30)
        .get();

      return snapshot.docs.map(doc => doc.data() as ScheduleStatistics);
    } catch (error) {
      throw new BadRequestException(`Failed to fetch statistics: ${error.message}`);
    }
  }

  // ===================================
  // PRIVATE HELPER METHODS
  // ===================================

  /**
   * Validasi format waktu schedule
   */
  private validateScheduleTimes(schedules: any[]): void {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    
    for (const schedule of schedules) {
      if (!timeRegex.test(schedule.time)) {
        throw new BadRequestException(
          `Invalid time format: ${schedule.time}. Use HH:mm format (e.g., 12:20)`
        );
      }
    }

    // Check for duplicate times
    const times = schedules.map(s => s.time);
    const uniqueTimes = new Set(times);
    if (times.length !== uniqueTimes.size) {
      throw new BadRequestException('Duplicate schedule times are not allowed');
    }
  }

  /**
   * Validasi balance user untuk real account
   */
  private async validateUserBalance(userId: string, requiredAmount: number): Promise<void> {
    try {
      const balanceDoc = await this.db
        .collection('balance')
        .where('user_id', '==', userId)
        .limit(1)
        .get();

      if (balanceDoc.empty) {
        throw new BadRequestException('User balance not found');
      }

      const balance = balanceDoc.docs[0].data();
      
      if (balance.real_balance < requiredAmount) {
        throw new BadRequestException(
          `Insufficient balance. Required: ${requiredAmount}, Available: ${balance.real_balance}`
        );
      }
    } catch (error) {
      throw new BadRequestException(`Balance validation failed: ${error.message}`);
    }
  }

  /**
   * Check apakah sudah mencapai stop loss atau stop profit
   */
  async checkStopLossProfit(scheduleId: string): Promise<boolean> {
    try {
      const scheduleDoc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();
      
      if (!scheduleDoc.exists) {
        return false;
      }

      const schedule = scheduleDoc.data() as OrderSchedule;
      const { stopLossProfit, currentProfit } = schedule;

      // Check stop profit
      if (stopLossProfit.stopProfit && currentProfit >= stopLossProfit.stopProfit) {
        await this.update(schedule.userId, scheduleId, {
          status: ScheduleStatus.COMPLETED,
          isActive: false
        });
        return true;
      }

      // Check stop loss
      if (stopLossProfit.stopLoss && Math.abs(currentProfit) >= stopLossProfit.stopLoss) {
        await this.update(schedule.userId, scheduleId, {
          status: ScheduleStatus.COMPLETED,
          isActive: false
        });
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error checking stop loss/profit:', error);
      return false;
    }
  }

  /**
   * Calculate next martingale amount
   */
  calculateMartingaleAmount(
    baseAmount: number, 
    currentStep: number, 
    multiplier: number
  ): number {
    if (currentStep === 0) {
      return baseAmount;
    }
    return baseAmount * Math.pow(multiplier, currentStep);
  }

  /**
   * Update schedule setelah execution
   */
  async updateAfterExecution(
    scheduleId: string,
    executionResult: 'win' | 'loss' | 'draw',
    profit: number
  ): Promise<void> {
    try {
      const scheduleDoc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();
      
      if (!scheduleDoc.exists) {
        return;
      }

      const schedule = scheduleDoc.data() as OrderSchedule;

      const updates: Partial<OrderSchedule> = {
        totalExecuted: schedule.totalExecuted + 1,
        lastExecutedAt: new Date(),
        lastExecutionResult: executionResult,
        updatedAt: new Date(),
      };

      // Update profit/loss
      updates.currentProfit = schedule.currentProfit + profit;

      if (profit > 0) {
        updates.totalProfit = schedule.totalProfit + profit;
        updates.totalSuccess = schedule.totalSuccess + 1;
        updates.consecutiveLosses = 0;
        updates.currentMartingaleStep = 0; // Reset martingale
      } else if (profit < 0) {
        updates.totalLoss = schedule.totalLoss + Math.abs(profit);
        updates.totalFailed = schedule.totalFailed + 1;
        updates.consecutiveLosses = schedule.consecutiveLosses + 1;

        // Increment martingale step if not at max
        if (schedule.currentMartingaleStep < schedule.martingaleSetting.maxStep) {
          updates.currentMartingaleStep = schedule.currentMartingaleStep + 1;
        }
      }

      await this.db.collection(this.schedulesCollection).doc(scheduleId).update(updates);

      // Check stop loss/profit setelah update
      await this.checkStopLossProfit(scheduleId);
    } catch (error) {
      console.error('Error updating schedule after execution:', error);
    }
  }
}