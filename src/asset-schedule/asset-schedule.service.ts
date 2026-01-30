// src/asset-schedule/asset-schedule.service.ts

import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectFirestore } from '@nestjs-community/firebase-admin';
import { Firestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { CreateAssetScheduleDto } from './dto/create-asset-schedule.dto';
import { UpdateAssetScheduleDto } from './dto/update-asset-schedule.dto';
import { GetAssetSchedulesQueryDto } from './dto/get-asset-schedules-query.dto';
import { AssetSchedule } from './interfaces/asset-schedule.interface';
import { Cron, CronExpression } from '@nestjs/schedule';
import { USER_ROLES } from '../common/constants';

@Injectable()
export class AssetScheduleService {
  private readonly COLLECTION_NAME = 'asset_schedules';

  constructor(
    @InjectFirestore() private readonly firestore: Firestore,
  ) {}

  /**
   * Create new asset schedule
   */
  async createSchedule(
    createDto: CreateAssetScheduleDto,
    userId: string,
    userEmail: string,
  ) {
    const scheduledTime = new Date(createDto.scheduledTime);
    const now = new Date();

    // Validate scheduled time is in the future
    if (scheduledTime <= now) {
      throw new BadRequestException('Scheduled time must be in the future');
    }

    // Verify asset exists
    const assetDoc = await this.firestore
      .collection('assets')
      .where('symbol', '==', createDto.assetSymbol)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (assetDoc.empty) {
      throw new NotFoundException(`Asset ${createDto.assetSymbol} not found or inactive`);
    }

    const scheduleData = {
      assetSymbol: createDto.assetSymbol,
      scheduledTime: Timestamp.fromDate(scheduledTime),
      trend: createDto.trend,
      timeframe: createDto.timeframe,
      notes: createDto.notes || '',
      isActive: createDto.isActive !== undefined ? createDto.isActive : true,
      status: 'pending',
      createdBy: userId,
      createdByEmail: userEmail,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await this.firestore.collection(this.COLLECTION_NAME).add(scheduleData);

    return {
      success: true,
      data: {
        id: docRef.id,
        ...scheduleData,
        scheduledTime: scheduledTime,
        createdAt: now,
        updatedAt: now,
      },
      message: 'Asset schedule created successfully',
    };
  }

  /**
   * Get all schedules with filters and pagination
   */
  async getSchedules(queryDto: GetAssetSchedulesQueryDto) {
    const { page = 1, limit = 50, assetSymbol, trend, timeframe, status, isActive, fromDate, toDate } = queryDto;
    const offset = (page - 1) * limit;

    let query = this.firestore.collection(this.COLLECTION_NAME) as any;

    // Apply filters
    if (assetSymbol) {
      query = query.where('assetSymbol', '==', assetSymbol);
    }

    if (trend) {
      query = query.where('trend', '==', trend);
    }

    if (timeframe) {
      query = query.where('timeframe', '==', timeframe);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    if (isActive !== undefined) {
      query = query.where('isActive', '==', isActive);
    }

    if (fromDate) {
      const fromTimestamp = Timestamp.fromDate(new Date(fromDate));
      query = query.where('scheduledTime', '>=', fromTimestamp);
    }

    if (toDate) {
      const toTimestamp = Timestamp.fromDate(new Date(toDate));
      query = query.where('scheduledTime', '<=', toTimestamp);
    }

    // Order by scheduled time descending
    query = query.orderBy('scheduledTime', 'desc');

    // Get total count
    const countSnapshot = await query.get();
    const total = countSnapshot.size;

    // Apply pagination
    const snapshot = await query.limit(limit).offset(offset).get();

    const schedules = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      scheduledTime: doc.data().scheduledTime?.toDate(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate(),
      executedAt: doc.data().executedAt?.toDate(),
    }));

    return {
      success: true,
      data: schedules,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get schedule by ID
   */
  async getScheduleById(scheduleId: string) {
    const docRef = await this.firestore.collection(this.COLLECTION_NAME).doc(scheduleId).get();

    if (!docRef.exists) {
      throw new NotFoundException('Schedule not found');
    }

    const data = docRef.data();
    return {
      success: true,
      data: {
        id: docRef.id,
        ...data,
        scheduledTime: data.scheduledTime?.toDate(),
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate(),
        executedAt: data.executedAt?.toDate(),
      },
    };
  }

  /**
   * Update schedule
   */
  async updateSchedule(
    scheduleId: string,
    updateDto: UpdateAssetScheduleDto,
    userId: string,
  ) {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(scheduleId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException('Schedule not found');
    }

    const currentData = doc.data();

    // Prevent updating executed or failed schedules
    if (['executed', 'failed'].includes(currentData.status)) {
      throw new BadRequestException(`Cannot update ${currentData.status} schedule`);
    }

    const updateData: any = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (updateDto.assetSymbol) {
      // Verify new asset exists
      const assetDoc = await this.firestore
        .collection('assets')
        .where('symbol', '==', updateDto.assetSymbol)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (assetDoc.empty) {
        throw new NotFoundException(`Asset ${updateDto.assetSymbol} not found or inactive`);
      }
      updateData.assetSymbol = updateDto.assetSymbol;
    }

    if (updateDto.scheduledTime) {
      const scheduledTime = new Date(updateDto.scheduledTime);
      const now = new Date();
      
      if (scheduledTime <= now) {
        throw new BadRequestException('Scheduled time must be in the future');
      }
      updateData.scheduledTime = Timestamp.fromDate(scheduledTime);
    }

    if (updateDto.trend) updateData.trend = updateDto.trend;
    if (updateDto.timeframe) updateData.timeframe = updateDto.timeframe;
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;
    if (updateDto.isActive !== undefined) updateData.isActive = updateDto.isActive;

    await docRef.update(updateData);

    const updatedDoc = await docRef.get();
    const data = updatedDoc.data();

    return {
      success: true,
      data: {
        id: scheduleId,
        ...data,
        scheduledTime: data.scheduledTime?.toDate(),
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate(),
      },
      message: 'Schedule updated successfully',
    };
  }

  /**
   * Delete schedule
   */
  async deleteSchedule(scheduleId: string) {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(scheduleId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException('Schedule not found');
    }

    await docRef.delete();

    return {
      success: true,
      message: 'Schedule deleted successfully',
    };
  }

  /**
   * Cancel schedule (soft delete - change status)
   */
  async cancelSchedule(scheduleId: string) {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(scheduleId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException('Schedule not found');
    }

    const currentData = doc.data();

    if (currentData.status !== 'pending') {
      throw new BadRequestException(`Cannot cancel ${currentData.status} schedule`);
    }

    await docRef.update({
      status: 'cancelled',
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Schedule cancelled successfully',
    };
  }

  /**
   * Execute pending schedules (called by cron job every minute)
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async executePendingSchedules() {
    try {
      const now = new Date();
      const nowTimestamp = Timestamp.fromDate(now);

      // Get all pending schedules that should be executed
      const schedulesSnapshot = await this.firestore
        .collection(this.COLLECTION_NAME)
        .where('status', '==', 'pending')
        .where('isActive', '==', true)
        .where('scheduledTime', '<=', nowTimestamp)
        .get();

      if (schedulesSnapshot.empty) {
        return;
      }

      console.log(`[AssetSchedule] Found ${schedulesSnapshot.size} schedules to execute`);

      for (const scheduleDoc of schedulesSnapshot.docs) {
        const scheduleData = scheduleDoc.data();
        await this.executeSchedule(scheduleDoc.id, scheduleData);
      }
    } catch (error) {
      console.error('[AssetSchedule] Error executing pending schedules:', error);
    }
  }

  /**
   * Execute individual schedule
   */
  private async executeSchedule(scheduleId: string, scheduleData: any) {
    try {
      console.log(`[AssetSchedule] Executing schedule ${scheduleId} for ${scheduleData.assetSymbol}`);

      // Get current asset data
      const assetSnapshot = await this.firestore
        .collection('assets')
        .where('symbol', '==', scheduleData.assetSymbol)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (assetSnapshot.empty) {
        throw new Error(`Asset ${scheduleData.assetSymbol} not found`);
      }

      const assetDoc = assetSnapshot.docs[0];
      const assetData = assetDoc.data();
      const currentPrice = assetData.currentPrice || 0;

      // Calculate price change based on trend
      // For 'buy' trend, price should go up
      // For 'sell' trend, price should go down
      const priceChangePercent = this.calculatePriceChange(scheduleData.timeframe);
      const priceChange = scheduleData.trend === 'buy' 
        ? currentPrice * priceChangePercent 
        : currentPrice * -priceChangePercent;
      
      const newPrice = currentPrice + priceChange;

      // Update asset price (this will trigger the market movement)
      await this.firestore.collection('assets').doc(assetDoc.id).update({
        currentPrice: newPrice,
        lastScheduleExecuted: scheduleId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Mark schedule as executed
      await this.firestore.collection(this.COLLECTION_NAME).doc(scheduleId).update({
        status: 'executed',
        executedAt: FieldValue.serverTimestamp(),
        executionDetails: {
          startPrice: currentPrice,
          endPrice: newPrice,
          priceChange: priceChange,
          success: true,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[AssetSchedule] Successfully executed schedule ${scheduleId}`);
    } catch (error) {
      console.error(`[AssetSchedule] Error executing schedule ${scheduleId}:`, error);

      // Mark schedule as failed
      await this.firestore.collection(this.COLLECTION_NAME).doc(scheduleId).update({
        status: 'failed',
        executedAt: FieldValue.serverTimestamp(),
        executionDetails: {
          success: false,
          errorMessage: error.message,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  /**
   * Calculate price change percentage based on timeframe
   */
  private calculatePriceChange(timeframe: string): number {
    // Define price change percentages for different timeframes
    const changes = {
      '1m': 0.001,   // 0.1%
      '5m': 0.003,   // 0.3%
      '15m': 0.005,  // 0.5%
      '30m': 0.008,  // 0.8%
      '1h': 0.01,    // 1%
      '4h': 0.02,    // 2%
      '1d': 0.05,    // 5%
    };

    return changes[timeframe] || 0.001;
  }

  /**
   * Get upcoming schedules (next 24 hours)
   */
  async getUpcomingSchedules() {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const snapshot = await this.firestore
      .collection(this.COLLECTION_NAME)
      .where('status', '==', 'pending')
      .where('isActive', '==', true)
      .where('scheduledTime', '>=', Timestamp.fromDate(now))
      .where('scheduledTime', '<=', Timestamp.fromDate(tomorrow))
      .orderBy('scheduledTime', 'asc')
      .get();

    const schedules = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      scheduledTime: doc.data().scheduledTime?.toDate(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate(),
    }));

    return {
      success: true,
      data: schedules,
      total: schedules.length,
    };
  }

  /**
   * Get schedule statistics
   */
  async getStatistics() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTimestamp = Timestamp.fromDate(today);

    // Get all schedules
    const allSnapshot = await this.firestore.collection(this.COLLECTION_NAME).get();
    
    // Get today's schedules
    const todaySnapshot = await this.firestore
      .collection(this.COLLECTION_NAME)
      .where('createdAt', '>=', todayTimestamp)
      .get();

    // Get pending schedules
    const pendingSnapshot = await this.firestore
      .collection(this.COLLECTION_NAME)
      .where('status', '==', 'pending')
      .where('isActive', '==', true)
      .get();

    // Get executed schedules
    const executedSnapshot = await this.firestore
      .collection(this.COLLECTION_NAME)
      .where('status', '==', 'executed')
      .get();

    // Get failed schedules
    const failedSnapshot = await this.firestore
      .collection(this.COLLECTION_NAME)
      .where('status', '==', 'failed')
      .get();

    return {
      success: true,
      data: {
        total: allSnapshot.size,
        todayTotal: todaySnapshot.size,
        pending: pendingSnapshot.size,
        executed: executedSnapshot.size,
        failed: failedSnapshot.size,
        cancelled: allSnapshot.size - pendingSnapshot.size - executedSnapshot.size - failedSnapshot.size,
      },
    };
  }
}