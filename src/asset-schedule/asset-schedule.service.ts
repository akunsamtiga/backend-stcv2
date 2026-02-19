// src/asset-schedule/asset-schedule.service.ts

import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { Firestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { CreateAssetScheduleDto } from './dto/create-asset-schedule.dto';
import { UpdateAssetScheduleDto } from './dto/update-asset-schedule.dto';
import { GetAssetSchedulesQueryDto } from './dto/get-asset-schedules-query.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class AssetScheduleService implements OnModuleInit {
  private readonly logger = new Logger(AssetScheduleService.name);
  private readonly COLLECTION_NAME = 'asset_schedules';
  private firestore: Firestore;

  constructor(private readonly firebaseService: FirebaseService) {
    this.logger.log('AssetScheduleService created, waiting for Firestore...');
  }

  async onModuleInit() {
    try {
      await this.firebaseService.waitForFirestore(10000);
      this.firestore = this.firebaseService.getFirestore();
      this.logger.log('AssetScheduleService initialized with Firestore');
    } catch (error) {
      this.logger.error('Failed to initialize Firestore:', error.message);
      throw error;
    }
  }

  async createSchedule(createDto: CreateAssetScheduleDto, userId: string, userEmail: string) {
    const scheduledTime = new Date(createDto.scheduledTime);
    const now = new Date();

    if (scheduledTime <= now) {
      throw new BadRequestException('Scheduled time must be in the future');
    }

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

  async getSchedules(queryDto: GetAssetSchedulesQueryDto) {
    const { page = 1, limit = 50, assetSymbol, trend, timeframe, status, isActive, fromDate, toDate } = queryDto;
    const offset = (page - 1) * limit;

    let query = this.firestore.collection(this.COLLECTION_NAME) as any;

    if (assetSymbol) query = query.where('assetSymbol', '==', assetSymbol);
    if (trend) query = query.where('trend', '==', trend);
    if (timeframe) query = query.where('timeframe', '==', timeframe);
    if (status) query = query.where('status', '==', status);
    if (isActive !== undefined) query = query.where('isActive', '==', isActive);
    if (fromDate) query = query.where('scheduledTime', '>=', Timestamp.fromDate(new Date(fromDate)));
    if (toDate) query = query.where('scheduledTime', '<=', Timestamp.fromDate(new Date(toDate)));

    query = query.orderBy('scheduledTime', 'desc');

    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;

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

    if (currentData.status !== 'pending') {
      throw new BadRequestException(`Cannot update ${currentData.status} schedule`);
    }

    if (updateDto.scheduledTime) {
      const newScheduledTime = new Date(updateDto.scheduledTime);
      const now = new Date();
      if (newScheduledTime <= now) {
        throw new BadRequestException('Scheduled time must be in the future');
      }
    }

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

  @Cron(CronExpression.EVERY_MINUTE)
  async executePendingSchedules() {
    try {
      const now = new Date();
      const nowTimestamp = Timestamp.fromDate(now);
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
      const windowStart = Timestamp.fromDate(twoMinutesAgo);

      const schedulesSnapshot = await this.firestore
        .collection(this.COLLECTION_NAME)
        .where('status', '==', 'pending')
        .where('isActive', '==', true)
        .where('scheduledTime', '>=', windowStart)
        .where('scheduledTime', '<=', nowTimestamp)
        .orderBy('scheduledTime', 'asc')
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

  private async executeSchedule(scheduleId: string, scheduleData: any) {
    try {
      this.logger.log(`Executing schedule ${scheduleId} for ${scheduleData.assetSymbol}`);

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

      const scheduledTime: Date = scheduleData.scheduledTime?.toDate
        ? scheduleData.scheduledTime.toDate()
        : new Date(scheduleData.scheduledTime);

      await this.pushScheduledTrendToRTDB(
        scheduleData.assetSymbol,
        scheduleData.trend,
        scheduleData.timeframe,
        scheduleId,
        currentPrice,
        scheduledTime,
      );

      await this.firestore.collection('assets').doc(assetDoc.id).update({
        lastScheduleExecuted: scheduleId,
        updatedAt: FieldValue.serverTimestamp(),
      });

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

      this.logger.log(`Successfully executed schedule ${scheduleId} - Trend pushed to RTDB`);
    } catch (error: any) {
      this.logger.error(`Error executing schedule ${scheduleId}:`, error.message);

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

  private async pushScheduledTrendToRTDB(
    assetSymbol: string,
    trend: string,
    timeframe: string,
    scheduleId: string,
    startPrice?: number,
    scheduledTime?: Date,
  ): Promise<void> {
    try {
      const startTime = scheduledTime ? scheduledTime.getTime() : Date.now();
      const duration = this.getTimeframeDurationInMs(timeframe);
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

      const normalizedSymbol = assetSymbol.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const path = `_scheduled_trends/${normalizedSymbol}/${scheduleId}`;

      this.logger.log(`Writing trend to ${path} (original: ${assetSymbol})`);

      let writeSuccess = false;
      const maxWriteAttempts = 3;

      for (let attempt = 1; attempt <= maxWriteAttempts; attempt++) {
        try {
          await this.firebaseService.setRealtimeDbValue(path, trendData, true);

          const verifyDelay = attempt === 1 ? 1000 : 1500;
          await new Promise(resolve => setTimeout(resolve, verifyDelay));

          const verified = await this.firebaseService.getRealtimeDbValue(path, false);

          if (verified && verified.scheduleId === scheduleId) {
            writeSuccess = true;
            this.logger.log(`Trend verified on attempt ${attempt}: ${normalizedSymbol}/${scheduleId}`);
            break;
          } else {
            this.logger.warn(`Verification failed on attempt ${attempt}/${maxWriteAttempts}`);

            if (attempt < maxWriteAttempts) {
              await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            }
          }
        } catch (writeError) {
          this.logger.error(`Write attempt ${attempt}/${maxWriteAttempts} failed: ${writeError.message}`);

          if (attempt < maxWriteAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      if (!writeSuccess) {
        throw new Error(`Failed to write trend after ${maxWriteAttempts} attempts. Possible causes:
1. RTDB Rules deny write to _scheduled_trends
2. Network connectivity issues
3. Firebase REST API rate limiting
4. Path: ${path}

Please check:
- Firebase Console → Realtime Database → Rules
- Network connectivity to Firebase
- Firebase service status`);
      }

      this.logger.log(`Successfully pushed trend: ${assetSymbol}/${scheduleId} → ${trend}`);
      this.logger.log(`Active from ${new Date(startTime).toLocaleTimeString()} to ${new Date(endTime).toLocaleTimeString()} (${duration / 1000}s)`);
    } catch (error) {
      this.logger.error(`Failed to push trend for ${assetSymbol}: ${error.message}`);
      throw error;
    }
  }

  private getTimeframeDurationInMs(timeframe: string): number {
    const durations: { [key: string]: number } = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };

    return durations[timeframe] || 60 * 1000;
  }

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

  async getExecutionHistory(queryDto: GetAssetSchedulesQueryDto) {
    const { page = 1, limit = 50, assetSymbol, trend, timeframe, fromDate, toDate } = queryDto;
    const offset = (page - 1) * limit;

    let query = this.firestore.collection(this.COLLECTION_NAME) as any;

    query = query.where('status', 'in', ['executed', 'failed']);

    if (assetSymbol) query = query.where('assetSymbol', '==', assetSymbol);
    if (trend) query = query.where('trend', '==', trend);
    if (timeframe) query = query.where('timeframe', '==', timeframe);
    if (fromDate) query = query.where('executedAt', '>=', Timestamp.fromDate(new Date(fromDate)));
    if (toDate) query = query.where('executedAt', '<=', Timestamp.fromDate(new Date(toDate)));

    query = query.orderBy('executedAt', 'desc');

    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;

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

  async getStatistics() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTimestamp = Timestamp.fromDate(today);

    const allSnapshot = await this.firestore.collection(this.COLLECTION_NAME).get();
    const todaySnapshot = await this.firestore
      .collection(this.COLLECTION_NAME)
      .where('createdAt', '>=', todayTimestamp)
      .get();
    const pendingSnapshot = await this.firestore
      .collection(this.COLLECTION_NAME)
      .where('status', '==', 'pending')
      .where('isActive', '==', true)
      .get();
    const executedSnapshot = await this.firestore
      .collection(this.COLLECTION_NAME)
      .where('status', '==', 'executed')
      .get();
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