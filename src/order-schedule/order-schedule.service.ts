// src/order-schedule/order-schedule.service.ts

import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Firestore } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service';
import { 
  CreateOrderScheduleDto,
  ScheduleStatus 
} from './dto/create-order-schedule.dto';
import { UpdateOrderScheduleDto } from './dto/update-order-schedule.dto';
import { QueryOrderScheduleDto } from './dto/query-order-schedule.dto';
import { OrderSchedule, ScheduleExecution, ScheduleStatistics } from './entities/order-schedule.entity';

@Injectable()
export class OrderScheduleService {
  // ✅ PERBAIKAN: Hapus inisialisasi db di constructor
  // private readonly db: Firestore; // ❌ HAPUS INI
  
  private readonly schedulesCollection = 'order_schedules';
  private readonly executionsCollection = 'schedule_executions';
  private readonly statisticsCollection = 'schedule_statistics';

  constructor(private firebaseService: FirebaseService) {
    // ✅ PERBAIKAN: Jangan panggil getFirestore() di sini
    // this.db = this.firebaseService.getFirestore(); // ❌ HAPUS INI
  }

  // ✅ TAMBAHKAN: Getter untuk lazy initialization
  private get db(): Firestore {
    return this.firebaseService.getFirestore();
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

  // ... rest of the methods remain the same, they will use this.db getter automatically
  
  async findAll(userId: string, query?: QueryOrderScheduleDto): Promise<OrderSchedule[]> {
    try {
      let firestoreQuery = this.db
        .collection(this.schedulesCollection)
        .where('userId', '==', userId);

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

  async findOne(userId: string, scheduleId: string): Promise<OrderSchedule> {
    try {
      const doc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();

      if (!doc.exists) {
        throw new NotFoundException('Order schedule not found');
      }

      const schedule = doc.data() as OrderSchedule;

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

  async update(
    userId: string, 
    scheduleId: string, 
    updateDto: UpdateOrderScheduleDto
  ): Promise<OrderSchedule> {
    try {
      const schedule = await this.findOne(userId, scheduleId);

      if (schedule.status === ScheduleStatus.ACTIVE && updateDto.schedules) {
        throw new BadRequestException('Cannot modify schedules of an active schedule. Please pause it first.');
      }

      if (updateDto.schedules) {
        this.validateScheduleTimes(updateDto.schedules);
      }

      const updatedData: Record<string, any> = {
        ...updateDto,
        updatedAt: new Date(),
      };

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

  async remove(userId: string, scheduleId: string): Promise<{ message: string }> {
    try {
      const schedule = await this.findOne(userId, scheduleId);

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

  async activateSchedule(userId: string, scheduleId: string): Promise<OrderSchedule> {
    return this.update(userId, scheduleId, { 
      status: ScheduleStatus.ACTIVE,
      isActive: true 
    });
  }

  async pauseSchedule(userId: string, scheduleId: string): Promise<OrderSchedule> {
    return this.update(userId, scheduleId, { 
      status: ScheduleStatus.PAUSED,
      isActive: false 
    });
  }

  async getExecutionHistory(
    userId: string, 
    scheduleId: string,
    limit: number = 50
  ): Promise<ScheduleExecution[]> {
    try {
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

  async getStatistics(userId: string, scheduleId: string): Promise<ScheduleStatistics[]> {
    try {
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

  private validateScheduleTimes(schedules: any[]): void {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    
    for (const schedule of schedules) {
      if (!timeRegex.test(schedule.time)) {
        throw new BadRequestException(
          `Invalid time format: ${schedule.time}. Use HH:mm format (e.g., 12:20)`
        );
      }
    }

    const times = schedules.map(s => s.time);
    const uniqueTimes = new Set(times);
    if (times.length !== uniqueTimes.size) {
      throw new BadRequestException('Duplicate schedule times are not allowed');
    }
  }

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

  async checkStopLossProfit(scheduleId: string): Promise<boolean> {
    try {
      const scheduleDoc = await this.db.collection(this.schedulesCollection).doc(scheduleId).get();
      
      if (!scheduleDoc.exists) {
        return false;
      }

      const schedule = scheduleDoc.data() as OrderSchedule;
      const { stopLossProfit, currentProfit } = schedule;

      if (stopLossProfit.stopProfit && currentProfit >= stopLossProfit.stopProfit) {
        await this.update(schedule.userId, scheduleId, {
          status: ScheduleStatus.COMPLETED,
          isActive: false
        });
        return true;
      }

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

      updates.currentProfit = schedule.currentProfit + profit;

      if (profit > 0) {
        updates.totalProfit = schedule.totalProfit + profit;
        updates.totalSuccess = schedule.totalSuccess + 1;
        updates.consecutiveLosses = 0;
        updates.currentMartingaleStep = 0;
      } else if (profit < 0) {
        updates.totalLoss = schedule.totalLoss + Math.abs(profit);
        updates.totalFailed = schedule.totalFailed + 1;
        updates.consecutiveLosses = schedule.consecutiveLosses + 1;

        if (schedule.currentMartingaleStep < schedule.martingaleSetting.maxStep) {
          updates.currentMartingaleStep = schedule.currentMartingaleStep + 1;
        }
      }

      await this.db.collection(this.schedulesCollection).doc(scheduleId).update(updates);

      await this.checkStopLossProfit(scheduleId);
    } catch (error) {
      console.error('Error updating schedule after execution:', error);
    }
  }
}