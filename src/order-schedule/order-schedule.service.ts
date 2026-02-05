// src/order-schedule/order-schedule.service.ts

import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service';
import { 
  CreateOrderScheduleDto,
  ScheduleStatus 
} from './dto/create-order-schedule.dto';
import { UpdateOrderScheduleDto } from './dto/update-order-schedule.dto';
import { QueryOrderScheduleDto } from './dto/query-order-schedule.dto';
import { OrderSchedule, ScheduleExecution, OrderMartingaleState } from './entities/order-schedule.entity';

@Injectable()
export class OrderScheduleService {
  private readonly logger = new Logger(OrderScheduleService.name);
  
  private readonly schedulesCollection = 'order_schedules';
  private readonly executionsCollection = 'schedule_executions';
  private readonly statisticsCollection = 'schedule_statistics';

  constructor(private firebaseService: FirebaseService) {}

  private get db(): Firestore {
    return this.firebaseService.getFirestore();
  }

  private toPlainObject<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  async create(userId: string, userEmail: string, createDto: CreateOrderScheduleDto): Promise<OrderSchedule> {
    try {
      this.validateScheduleTimes(createDto.schedules);
      
      if (createDto.accountType === 'real') {
        await this.validateUserBalance(userId, createDto.amount);
      }

      const scheduleId = uuidv4();
      const now = new Date();

      const plainDto = this.toPlainObject(createDto);

      // ✅ Inisialisasi state martingale untuk setiap order
      const orderMartingaleStates: OrderMartingaleState[] = createDto.schedules.map(schedule => ({
        scheduledTime: schedule.time,
        currentStep: 0,
        consecutiveLosses: 0,
        lastResult: null,
        lastExecutedAt: null,
        totalExecuted: 0,
        totalWins: 0,
        totalLosses: 0,
      }));

      const newSchedule: OrderSchedule = {
        id: scheduleId,
        userId,
        userEmail,
        assetSymbol: plainDto.assetSymbol,
        assetName: plainDto.assetName,
        accountType: plainDto.accountType,
        duration: plainDto.duration,
        amount: plainDto.amount,
        schedules: plainDto.schedules,
        martingaleSetting: plainDto.martingaleSetting,
        stopLossProfit: plainDto.stopLossProfit || {},
        status: ScheduleStatus.PENDING,
        isActive: plainDto.isActive ?? true,
        orderMartingaleStates,
        totalExecuted: 0,
        totalSuccess: 0,
        totalFailed: 0,
        currentProfit: 0,
        totalProfit: 0,
        totalLoss: 0,
        currentMartingaleStep: 0,
        consecutiveLosses: 0,
        notes: plainDto.notes,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.collection(this.schedulesCollection).doc(scheduleId).set(newSchedule);

      this.logger.log(`✅ Created schedule ${scheduleId} for user ${userEmail} with ${orderMartingaleStates.length} order states`);

      return newSchedule;
    } catch (error) {
      this.logger.error(`❌ Failed to create schedule: ${error.message}`);
      throw new BadRequestException(`Failed to create order schedule: ${error.message}`);
    }
  }

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
      this.logger.error(`❌ Failed to fetch schedules: ${error.message}`);
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
        
        // ✅ Re-inisialisasi state martingale jika schedules berubah
        const existingStates = (schedule as any).orderMartingaleStates || [];
        const newStates: OrderMartingaleState[] = updateDto.schedules.map(newSchedule => {
          const existingState = existingStates.find((s: OrderMartingaleState) => 
            s.scheduledTime === newSchedule.time
          );
          
          if (existingState) {
            return existingState;
          }
          
          return {
            scheduledTime: newSchedule.time,
            currentStep: 0,
            consecutiveLosses: 0,
            lastResult: null,
            lastExecutedAt: null,
            totalExecuted: 0,
            totalWins: 0,
            totalLosses: 0,
          };
        });
        
        (updateDto as any).orderMartingaleStates = newStates;
      }

      const plainDto = this.toPlainObject(updateDto);

      const updatedData: Record<string, any> = {
        ...plainDto,
        updatedAt: new Date(),
      };

      if (updateDto.status === ScheduleStatus.ACTIVE && schedule.status !== ScheduleStatus.ACTIVE) {
        updatedData.startedAt = new Date();
        this.logger.log(`🚀 Schedule ${scheduleId} activated`);
      } else if (updateDto.status === ScheduleStatus.PAUSED) {
        updatedData.pausedAt = new Date();
        this.logger.log(`⏸️ Schedule ${scheduleId} paused`);
      } else if (updateDto.status === ScheduleStatus.COMPLETED || updateDto.status === ScheduleStatus.CANCELLED) {
        updatedData.completedAt = new Date();
        this.logger.log(`✅ Schedule ${scheduleId} ${updateDto.status}`);
      }

      await this.db.collection(this.schedulesCollection)
        .doc(scheduleId)
        .update(updatedData);

      return this.findOne(userId, scheduleId);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`❌ Failed to update schedule: ${error.message}`);
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

      this.logger.log(`🗑️ Deleted schedule ${scheduleId}`);

      return { message: 'Order schedule deleted successfully' };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`❌ Failed to delete schedule: ${error.message}`);
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
      this.logger.error(`❌ Failed to fetch execution history: ${error.message}`);
      throw new BadRequestException(`Failed to fetch execution history: ${error.message}`);
    }
  }

  async getStatistics(userId: string, scheduleId: string): Promise<any[]> {
    try {
      await this.findOne(userId, scheduleId);

      const snapshot = await this.db
        .collection(this.statisticsCollection)
        .where('scheduleId', '==', scheduleId)
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(30)
        .get();

      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      this.logger.error(`❌ Failed to fetch statistics: ${error.message}`);
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
      if (error instanceof BadRequestException) {
        throw error;
      }
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

      if (!stopLossProfit) {
        return false;
      }

      if (stopLossProfit.stopProfit && currentProfit >= stopLossProfit.stopProfit) {
        this.logger.log(`🎯 Stop profit reached for schedule ${scheduleId}: ${currentProfit}`);
        
        await this.db.collection(this.schedulesCollection).doc(scheduleId).update({
          status: ScheduleStatus.COMPLETED,
          isActive: false,
          completedAt: new Date(),
          updatedAt: new Date(),
        });
        
        return true;
      }

      if (stopLossProfit.stopLoss && Math.abs(currentProfit) >= stopLossProfit.stopLoss) {
        this.logger.log(`🛑 Stop loss reached for schedule ${scheduleId}: ${currentProfit}`);
        
        await this.db.collection(this.schedulesCollection).doc(scheduleId).update({
          status: ScheduleStatus.COMPLETED,
          isActive: false,
          completedAt: new Date(),
          updatedAt: new Date(),
        });
        
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`❌ Error checking stop loss/profit: ${error.message}`);
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
    return Math.round(baseAmount * Math.pow(multiplier, currentStep));
  }

  // ✅ Get martingale state untuk order tertentu
  getOrderMartingaleState(
    schedule: OrderSchedule, 
    scheduledTime: string
  ): OrderMartingaleState {
    const states = (schedule as any).orderMartingaleStates as OrderMartingaleState[] || [];
    
    let state = states.find(s => s.scheduledTime === scheduledTime);
    
    if (!state) {
      state = {
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
    
    return state;
  }

  // ✅ Update setelah eksekusi - update state per order
  async updateAfterExecution(
    scheduleId: string,
    scheduledTime: string,
    executionResult: 'win' | 'loss' | 'draw',
    profit: number
  ): Promise<void> {
    try {
      await this.firebaseService.runTransaction(async (transaction) => {
        const scheduleRef = this.db.collection(this.schedulesCollection).doc(scheduleId);
        const scheduleDoc = await transaction.get(scheduleRef);
        
        if (!scheduleDoc.exists) {
          throw new Error('Schedule not found');
        }

        const schedule = scheduleDoc.data() as OrderSchedule;
        
        // ✅ Ambil state martingale untuk order ini
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

        // ✅ Update state untuk order ini saja
        orderState.lastExecutedAt = new Date();
        orderState.totalExecuted++;
        orderState.lastResult = executionResult;

        if (executionResult === 'win') {
          orderState.totalWins++;
          orderState.consecutiveLosses = 0;
          orderState.currentStep = 0;
        } else if (executionResult === 'loss') {
          orderState.totalLosses++;
          orderState.consecutiveLosses++;
          
          if (orderState.currentStep < schedule.martingaleSetting.maxStep) {
            orderState.currentStep++;
          }
        }

        if (orderStateIndex >= 0) {
          orderStates[orderStateIndex] = orderState;
        } else {
          orderStates.push(orderState);
        }

        // ✅ Update total aggregated
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

        // Update backward compatibility fields
        const avgStep = orderStates.reduce((sum, s) => sum + s.currentStep, 0) / orderStates.length;
        updates.currentMartingaleStep = Math.round(avgStep);
        updates.consecutiveLosses = orderStates.reduce((sum, s) => sum + s.consecutiveLosses, 0);

        transaction.update(scheduleRef, updates);

        this.logger.log(
          `✅ Order ${scheduledTime} result: ${executionResult.toUpperCase()}, ` +
          `Step: ${orderState.currentStep}, Consecutive Losses: ${orderState.consecutiveLosses}, ` +
          `Profit: ${profit}`
        );
      });

      await this.checkStopLossProfit(scheduleId);
      
    } catch (error) {
      this.logger.error(`❌ Error updating schedule after execution: ${error.message}`, error.stack);
      throw error;
    }
  }
}