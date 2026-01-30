// src/asset-schedule/asset-schedule.service.ts
// ✅ FIX: Inisialisasi Firestore di onModuleInit, bukan di constructor

import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { Firestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { CreateAssetScheduleDto } from './dto/create-asset-schedule.dto';
import { UpdateAssetScheduleDto } from './dto/update-asset-schedule.dto';
import { GetAssetSchedulesQueryDto } from './dto/get-asset-schedules-query.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class AssetScheduleService implements OnModuleInit {
  private readonly logger = new Logger(AssetScheduleService.name);
  private readonly COLLECTION_NAME = 'asset_schedules';
  private firestore: Firestore;

  // ✅ FIX: Jangan akses Firestore di constructor
  constructor(
    private readonly firebaseService: FirebaseService,
  ) {
    this.logger.log('AssetScheduleService created, waiting for Firestore...');
  }

  // ✅ FIX: Inisialisasi Firestore di onModuleInit setelah Firebase siap
  async onModuleInit() {
    try {
      // Tunggu sampai Firestore ready
      await this.firebaseService.waitForFirestore(10000);
      
      // Sekarang ambil Firestore instance
      this.firestore = this.firebaseService.getFirestore();
      
      this.logger.log('✅ AssetScheduleService initialized with Firestore');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Firestore:', error.message);
      throw error;
    }
  }

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

    this.logger.log(`Schedule created: ${docRef.id} for ${createDto.assetSymbol}`);

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
      query = query.where('scheduledTime', '>=', Timestamp.fromDate(new Date(fromDate)));
    }

    if (toDate) {
      query = query.where('scheduledTime', '<=', Timestamp.fromDate(new Date(toDate)));
    }

    // Order by scheduledTime
    query = query.orderBy('scheduledTime', 'desc');

    // Get total count
    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;

    // Apply pagination
    const snapshot = await query.offset(offset).limit(limit).get();

    const schedules = snapshot.docs.map((doc: any) => ({
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
  async getScheduleById(id: string) {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException('Schedule not found');
    }

    const data = doc.data();
    if (!data) {
      throw new NotFoundException('Schedule data not found');
    }

    return {
      success: true,
      data: {
        id: doc.id,
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
  async updateSchedule(id: string, updateDto: UpdateAssetScheduleDto, userId: string) {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException('Schedule not found');
    }

    const currentData = doc.data();
    if (!currentData) {
      throw new NotFoundException('Schedule data not found');
    }

    // Cannot update executed or failed schedules
    if (currentData.status !== 'pending') {
      throw new BadRequestException(`Cannot update ${currentData.status} schedule`);
    }

    // If scheduledTime is being updated, validate it's in the future
    if (updateDto.scheduledTime) {
      const newScheduledTime = new Date(updateDto.scheduledTime);
      const now = new Date();
      if (newScheduledTime <= now) {
        throw new BadRequestException('Scheduled time must be in the future');
      }
    }

    // Verify asset exists if assetSymbol is being updated
    if (updateDto.assetSymbol) {
      const assetDoc = await this.firestore
        .collection('assets')
        .where('symbol', '==', updateDto.assetSymbol)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (assetDoc.empty) {
        throw new NotFoundException(`Asset ${updateDto.assetSymbol} not found or inactive`);
      }
    }

    const updateData: any = {
      ...updateDto,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (updateDto.scheduledTime) {
      updateData.scheduledTime = Timestamp.fromDate(new Date(updateDto.scheduledTime));
    }

    await docRef.update(updateData);

    this.logger.log(`Schedule updated: ${id}`);

    return {
      success: true,
      message: 'Schedule updated successfully',
    };
  }

  /**
   * Cancel schedule
   */
  async cancelSchedule(id: string) {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException('Schedule not found');
    }

    const currentData = doc.data();
    if (!currentData) {
      throw new NotFoundException('Schedule data not found');
    }

    if (currentData.status !== 'pending') {
      throw new BadRequestException(`Cannot cancel ${currentData.status} schedule`);
    }

    await docRef.update({
      status: 'cancelled',
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    this.logger.log(`Schedule cancelled: ${id}`);

    return {
      success: true,
      message: 'Schedule cancelled successfully',
    };
  }

  /**
   * Delete schedule
   */
  async deleteSchedule(id: string) {
    const docRef = this.firestore.collection(this.COLLECTION_NAME).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException('Schedule not found');
    }

    await docRef.delete();

    this.logger.log(`Schedule deleted: ${id}`);

    return {
      success: true,
      message: 'Schedule deleted successfully',
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

      this.logger.log(`Found ${schedulesSnapshot.size} schedules to execute`);

      for (const scheduleDoc of schedulesSnapshot.docs) {
        const scheduleData = scheduleDoc.data();
        await this.executeSchedule(scheduleDoc.id, scheduleData);
      }
    } catch (error) {
      this.logger.error('Error executing pending schedules:', error);
    }
  }

  /**
   * Execute individual schedule
   */
  private async executeSchedule(scheduleId: string, scheduleData: any) {
    try {
      this.logger.log(`Executing schedule ${scheduleId} for ${scheduleData.assetSymbol}`);

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

      // ✅ PUSH SCHEDULED TREND TO REALTIME DATABASE
      await this.pushScheduledTrendToRTDB(
        scheduleData.assetSymbol,
        scheduleData.trend,
        scheduleData.timeframe,
        scheduleId,
        currentPrice
      );

      // Update Firestore asset with last schedule executed
      await this.firestore.collection('assets').doc(assetDoc.id).update({
        lastScheduleExecuted: scheduleId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Mark schedule as executed
      await this.firestore.collection(this.COLLECTION_NAME).doc(scheduleId).update({
        status: 'executed',
        executedAt: FieldValue.serverTimestamp(),
        executionDetails: {
          startPrice: currentPrice,
          startTime: Date.now(),
          success: true,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      this.logger.log(`✅ Successfully executed schedule ${scheduleId} - Trend pushed to RTDB`);
    } catch (error: any) {
      this.logger.error(`Error executing schedule ${scheduleId}:`, error.message);

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
 * ✅ FIXED: Push scheduled trend dengan lowercase path
 */
private async pushScheduledTrendToRTDB(
  assetSymbol: string,
  trend: string,
  timeframe: string,
  scheduleId: string,
  startPrice: number
) {
  try {
    const duration = this.getTimeframeDurationInMs(timeframe);
    const startTime = Date.now();
    const endTime = startTime + duration;

    const trendData = {
      trend: trend,
      timeframe: timeframe,
      startTime: startTime,
      endTime: endTime,
      duration: duration,
      scheduleId: scheduleId,
      startPrice: startPrice,
      isActive: true,
      createdAt: Date.now(),
    };

    // ✅ FIX: Gunakan lowercase untuk path RTDB (match dengan struktur asset)
    const normalizedSymbol = assetSymbol.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const path = `_scheduled_trends/${normalizedSymbol}`;
    
    this.logger.log(`📝 Writing trend to ${path} (original: ${assetSymbol})`);

    // Write dengan critical=true (immediate)
    await this.firebaseService.setRealtimeDbValue(path, trendData, true);

    // Verification dengan delay lebih lama (REST mode kadang lebih lambat)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const verified = await this.firebaseService.getRealtimeDbValue(path);
    
    if (!verified) {
      // Coba sekali lagi untuk memastikan
      this.logger.warn(`⚠️ First verification failed for ${normalizedSymbol}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      const retry = await this.firebaseService.getRealtimeDbValue(path);
      
      if (!retry) {
        throw new Error(`Trend data not found in RTDB after write. Check if:
1. RTDB Rules allow write to _scheduled_trends
2. Asset symbol case matches: ${assetSymbol} -> ${normalizedSymbol}
3. Firebase Realtime DB is accessible`);
      }
    }

    this.logger.log(`🔥 Successfully pushed trend: ${assetSymbol} (${normalizedSymbol}) -> ${trend}`);
    this.logger.log(`📅 Active for ${duration/1000}s (until ${new Date(endTime).toLocaleTimeString()})`);
    
  } catch (error) {
    this.logger.error(`❌ Failed to push trend for ${assetSymbol}: ${error.message}`);
    throw error;
  }
}
  /**
   * Get timeframe duration in milliseconds
   */
  private getTimeframeDurationInMs(timeframe: string): number {
    const durations: { [key: string]: number } = {
      '1m': 60 * 1000,           // 1 minute
      '5m': 5 * 60 * 1000,       // 5 minutes
      '15m': 15 * 60 * 1000,     // 15 minutes
      '30m': 30 * 60 * 1000,     // 30 minutes
      '1h': 60 * 60 * 1000,      // 1 hour
      '4h': 4 * 60 * 60 * 1000,  // 4 hours
      '1d': 24 * 60 * 60 * 1000, // 1 day
    };

    return durations[timeframe] || 60 * 1000; // Default 1 minute
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

    const schedules = snapshot.docs.map((doc: any) => ({
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
   * Get schedule execution history
   */
  async getExecutionHistory(queryDto: GetAssetSchedulesQueryDto) {
    const { page = 1, limit = 50, assetSymbol, trend, timeframe, fromDate, toDate } = queryDto;
    const offset = (page - 1) * limit;

    let query = this.firestore.collection(this.COLLECTION_NAME) as any;

    // Only get executed or failed schedules
    query = query.where('status', 'in', ['executed', 'failed']);

    // Apply additional filters
    if (assetSymbol) {
      query = query.where('assetSymbol', '==', assetSymbol);
    }

    if (trend) {
      query = query.where('trend', '==', trend);
    }

    if (timeframe) {
      query = query.where('timeframe', '==', timeframe);
    }

    if (fromDate) {
      query = query.where('executedAt', '>=', Timestamp.fromDate(new Date(fromDate)));
    }

    if (toDate) {
      query = query.where('executedAt', '<=', Timestamp.fromDate(new Date(toDate)));
    }

    // Order by executedAt
    query = query.orderBy('executedAt', 'desc');

    // Get total count
    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;

    // Apply pagination
    const snapshot = await query.offset(offset).limit(limit).get();

    const history = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
      scheduledTime: doc.data().scheduledTime?.toDate(),
      executedAt: doc.data().executedAt?.toDate(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate(),
    }));

    return {
      success: true,
      data: history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
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