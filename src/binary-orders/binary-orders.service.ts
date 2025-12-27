// src/binary-orders/binary-orders.service.ts
// ✅ UPDATED: Using TimezoneUtil for consistent timezone with simulator

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { AssetsService } from '../assets/assets.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { CreateBinaryOrderDto } from './dto/create-binary-order.dto';
import { QueryBinaryOrderDto } from './dto/query-binary-order.dto';
import { COLLECTIONS, ORDER_STATUS, BALANCE_TYPES, ALL_DURATIONS, ValidDuration, BALANCE_ACCOUNT_TYPE } from '../common/constants';
import { CalculationUtil, TimezoneUtil } from '../common/utils';
import { BinaryOrder, Asset } from '../common/interfaces';

@Injectable()
export class BinaryOrdersService {
  private readonly logger = new Logger(BinaryOrdersService.name);
  
  private orderCache: Map<string, BinaryOrder> = new Map();
  private realActiveOrdersCache: BinaryOrder[] = [];
  private demoActiveOrdersCache: BinaryOrder[] = [];
  private assetCache: Map<string, { asset: Asset; timestamp: number }> = new Map();
  
  private readonly ORDER_CACHE_TTL = 1000;
  private readonly ASSET_CACHE_TTL = 20000;
  private lastRealCacheUpdate = 0;
  private lastDemoCacheUpdate = 0;
  
  private processingLock = false;
  
  private orderCreateCount = 0;
  private orderSettleCount = 0;
  private avgCreateTime = 0;
  private avgSettleTime = 0;

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
    private assetsService: AssetsService,
    private priceFetcherService: PriceFetcherService,
  ) {
    setInterval(() => this.cleanupStaleCache(), 10000);
    
    // ✅ Log timezone info on startup
    this.logger.log(`🌍 Timezone: Asia/Jakarta (WIB = UTC+7)`);
    this.logger.log(`⏰ Current time: ${TimezoneUtil.formatDateTime()}`);
  }

  private isValidDuration(duration: number): duration is ValidDuration {
    return (ALL_DURATIONS as readonly number[]).includes(duration);
  }

  /**
   * ✅ CREATE ORDER - Using TimezoneUtil
   */
  async createOrder(userId: string, createOrderDto: CreateBinaryOrderDto) {
    const startTime = Date.now();
    const { accountType, amount } = createOrderDto;
    
    try {
      // Validate account type
      if (accountType !== BALANCE_ACCOUNT_TYPE.REAL && accountType !== BALANCE_ACCOUNT_TYPE.DEMO) {
        throw new BadRequestException('Invalid account type. Must be "real" or "demo"');
      }

      // Validate duration
      if (!this.isValidDuration(createOrderDto.duration)) {
        throw new BadRequestException(
          `Invalid duration. Allowed: ${ALL_DURATIONS.join(', ')} minutes`
        );
      }

      // Validate amount
      if (amount < 1000) {
        throw new BadRequestException('Minimum order amount is Rp 1,000');
      }

      // Get asset & price
      const [asset, priceData] = await Promise.all([
        this.getCachedAssetFast(createOrderDto.asset_id),
        this.getFastPriceWithFallback(createOrderDto.asset_id),
      ]);

      // Validate asset
      if (!asset.isActive) {
        throw new BadRequestException('Asset not active');
      }

      // Validate price
      if (!priceData || !priceData.price) {
        throw new BadRequestException('Price unavailable, please try again');
      }

      // ✅ STRICT balance validation
      this.logger.log(`🔍 Checking ${accountType} balance for user ${userId}...`);
      
      const currentBalance = await this.balanceService.getCurrentBalanceStrict(
        userId, 
        accountType
      );

      this.logger.log(
        `💰 User ${userId} - ${accountType} balance: ${currentBalance}, Required: ${amount}`
      );

      if (currentBalance < amount) {
        throw new BadRequestException(
          `Insufficient ${accountType} balance. Available: Rp ${currentBalance.toLocaleString()}, Required: Rp ${amount.toLocaleString()}`
        );
      }

      if (currentBalance === 0) {
        throw new BadRequestException(
          `Cannot create order with zero balance. Please deposit first.`
        );
      }

      // ✅ Generate order with TimezoneUtil
      const orderId = await this.firebaseService.generateId(COLLECTIONS.ORDERS);
      
      // ✅ Use TimezoneUtil for consistent timestamps
      const entryTimestamp = TimezoneUtil.getCurrentTimestamp();
      const entryDate = TimezoneUtil.fromTimestamp(entryTimestamp);
      const expiryDate = TimezoneUtil.addMinutes(entryDate, createOrderDto.duration);
      const expiryTimestamp = TimezoneUtil.toTimestamp(expiryDate);
      
      // ✅ Get formatted datetime info
      const entryDateTimeInfo = TimezoneUtil.getDateTimeInfo(entryDate);
      const expiryDateTimeInfo = TimezoneUtil.getDateTimeInfo(expiryDate);

      const orderData: BinaryOrder = {
        id: orderId,
        user_id: userId,
        accountType,
        asset_id: asset.id,
        asset_name: asset.name,
        direction: createOrderDto.direction as 'CALL' | 'PUT',
        amount: createOrderDto.amount,
        duration: createOrderDto.duration,
        entry_price: priceData.price,
        entry_time: entryDateTimeInfo.datetime_iso, // ISO format
        exit_price: null,
        exit_time: expiryDateTimeInfo.datetime_iso, // ISO format
        status: ORDER_STATUS.ACTIVE,
        profit: null,
        profitRate: asset.profitRate,
        createdAt: entryDateTimeInfo.datetime_iso,
      };

      const db = this.firebaseService.getFirestore();
      
      // Write order
      await db.collection(COLLECTIONS.ORDERS).doc(orderId).set(orderData);

      this.logger.log(`✅ Order ${orderId} created, now debiting balance...`);
      this.logger.log(`📅 Entry: ${entryDateTimeInfo.datetime} WIB`);
      this.logger.log(`📅 Expiry: ${expiryDateTimeInfo.datetime} WIB`);
      this.logger.log(`⏱️  Duration: ${createOrderDto.duration} minutes`);

      // Debit balance
      try {
        await this.balanceService.createBalanceEntry(userId, {
          accountType,
          type: BALANCE_TYPES.ORDER_DEBIT,
          amount: createOrderDto.amount,
          description: `[${accountType.toUpperCase()}] Order #${orderId.slice(-8)} - ${asset.symbol} ${createOrderDto.direction}`,
        }, true);

        this.logger.log(`✅ Balance debited successfully`);

      } catch (debitError) {
        // Rollback: Delete order if debit fails
        this.logger.error(`❌ Balance debit failed, rolling back order: ${debitError.message}`);
        
        await db.collection(COLLECTIONS.ORDERS).doc(orderId).delete();
        
        throw new BadRequestException(
          `Failed to debit balance: ${debitError.message}`
        );
      }

      // Clear cache
      this.balanceService.clearUserCache(userId);

      // Update cache
      this.orderCache.set(orderId, orderData);
      
      if (accountType === BALANCE_ACCOUNT_TYPE.REAL) {
        this.realActiveOrdersCache.push(orderData);
        this.lastRealCacheUpdate = 0;
      } else {
        this.demoActiveOrdersCache.push(orderData);
        this.lastDemoCacheUpdate = 0;
      }

      // Verify balance
      const newBalance = await this.balanceService.getCurrentBalance(userId, accountType, true);
      
      this.logger.log(
        `✅ Order complete - New ${accountType} balance: ${newBalance} (deducted ${amount})`
      );

      const duration = Date.now() - startTime;
      this.orderCreateCount++;
      this.avgCreateTime = (this.avgCreateTime * 0.9) + (duration * 0.1);

      this.logger.log(
        `⚡ [${accountType.toUpperCase()}] Order created in ${duration}ms - ${asset.symbol} ${createOrderDto.direction} ${createOrderDto.duration}min`
      );

      return {
        message: `${accountType} order created successfully`,
        order: orderData,
        accountType,
        balanceAfter: newBalance,
        executionTime: duration,
        timing: {
          entry: entryDateTimeInfo.datetime,
          expiry: expiryDateTimeInfo.datetime,
          timezone: 'Asia/Jakarta (WIB)',
        },
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Order creation failed after ${duration}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ SETTLEMENT CRON - Using TimezoneUtil
   */
  @Cron('*/2 * * * * *')
  async processExpiredOrders() {
    if (this.processingLock) return;

    this.processingLock = true;
    const startTime = Date.now();

    try {
      // ✅ Get current timestamp using TimezoneUtil
      const currentTimestamp = TimezoneUtil.getCurrentTimestamp();
      const currentDateTime = TimezoneUtil.formatDateTime();
      
      const [realOrders, demoOrders] = await Promise.all([
        this.getActiveOrdersFromDB(BALANCE_ACCOUNT_TYPE.REAL),
        this.getActiveOrdersFromDB(BALANCE_ACCOUNT_TYPE.DEMO),
      ]);

      const expiredRealOrders = realOrders.filter(order => {
        const exitTimestamp = TimezoneUtil.toTimestamp(new Date(order.exit_time!));
        return currentTimestamp >= exitTimestamp;
      });

      const expiredDemoOrders = demoOrders.filter(order => {
        const exitTimestamp = TimezoneUtil.toTimestamp(new Date(order.exit_time!));
        return currentTimestamp >= exitTimestamp;
      });

      const totalExpired = expiredRealOrders.length + expiredDemoOrders.length;

      if (totalExpired === 0) {
        return;
      }

      this.logger.log(
        `⚡ [${currentDateTime} WIB] Processing ${totalExpired} expired orders (Real: ${expiredRealOrders.length}, Demo: ${expiredDemoOrders.length})`
      );

      const PARALLEL_LIMIT = 20;
      
      await Promise.all([
        this.settleBatch(expiredRealOrders, PARALLEL_LIMIT),
        this.settleBatch(expiredDemoOrders, PARALLEL_LIMIT),
      ]);

      this.clearAllCache();

      const duration = Date.now() - startTime;
      this.logger.log(`⚡ Settled ${totalExpired} orders in ${duration}ms`);

    } catch (error) {
      this.logger.error(`Settlement error: ${error.message}`);
    } finally {
      this.processingLock = false;
    }
  }

  /**
   * ✅ BATCH SETTLEMENT
   */
  private async settleBatch(orders: BinaryOrder[], batchSize: number): Promise<void> {
    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(order => this.settleOrderInstant(order))
      );
    }
  }

  /**
   * ✅ SETTLE SINGLE ORDER - Using TimezoneUtil
   */
  private async settleOrderInstant(order: BinaryOrder): Promise<void> {
    const startTime = Date.now();
    
    try {
      const [asset, priceData] = await Promise.all([
        this.getCachedAssetFast(order.asset_id),
        Promise.race([
          this.priceFetcherService.getCurrentPrice(
            await this.getCachedAssetFast(order.asset_id),
            false
          ),
          new Promise<any>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 1000)
          ),
        ]),
      ]);

      if (!priceData?.price) {
        this.logger.warn(`No price for order ${order.id}, retrying next cycle`);
        return;
      }

      const result = CalculationUtil.determineBinaryResult(
        order.direction,
        order.entry_price,
        priceData.price,
      );

      const profit = result === 'WON' 
        ? CalculationUtil.calculateBinaryProfit(order.amount, order.profitRate)
        : -order.amount;

      const db = this.firebaseService.getFirestore();
      
      // ✅ Use TimezoneUtil for settlement timestamp
      const settlementDateTime = TimezoneUtil.formatDateTime();
      
      await db.collection(COLLECTIONS.ORDERS)
        .doc(order.id)
        .update({
          exit_price: priceData.price,
          status: result,
          profit,
          settled_at: TimezoneUtil.toISOString(), // Add settlement timestamp
        });

      // Credit balance if won
      if (result === 'WON') {
        const totalReturn = order.amount + profit;
        
        await this.balanceService.createBalanceEntry(order.user_id, {
          accountType: order.accountType,
          type: BALANCE_TYPES.ORDER_PROFIT,
          amount: totalReturn,
          description: `[${order.accountType.toUpperCase()}] Won #${order.id.slice(-8)} - ${asset.symbol} +${profit.toFixed(0)}`,
        }, true);
      }

      this.orderCache.delete(order.id);
      if (order.accountType === BALANCE_ACCOUNT_TYPE.REAL) {
        this.lastRealCacheUpdate = 0;
      } else {
        this.lastDemoCacheUpdate = 0;
      }

      const duration = Date.now() - startTime;
      this.orderSettleCount++;
      this.avgSettleTime = (this.avgSettleTime * 0.9) + (duration * 0.1);

      this.logger.log(
        `⚡ [${settlementDateTime} WIB] [${order.accountType.toUpperCase()}] Settled ${order.id.slice(-8)} in ${duration}ms - ${result} ${profit > 0 ? '+' : ''}${profit.toFixed(2)}`
      );

    } catch (error) {
      this.logger.error(`Settlement failed for ${order.id}: ${error.message}`);
    }
  }

  /**
   * GET ACTIVE ORDERS
   */
  private async getActiveOrdersFromDB(accountType?: 'real' | 'demo'): Promise<BinaryOrder[]> {
    const db = this.firebaseService.getFirestore();
    let query = db.collection(COLLECTIONS.ORDERS)
      .where('status', '==', ORDER_STATUS.ACTIVE);

    if (accountType) {
      query = query.where('accountType', '==', accountType) as any;
    }

    const snapshot = await query.limit(500).get();
    return snapshot.docs.map(doc => doc.data() as BinaryOrder);
  }

  /**
   * GET ORDERS
   */
  async getOrders(
    userId: string, 
    queryDto: QueryBinaryOrderDto,
    accountType?: 'real' | 'demo'
  ) {
    const { status, page = 1, limit = 20 } = queryDto;

    const db = this.firebaseService.getFirestore();
    let query = db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId);

    if (accountType) {
      query = query.where('accountType', '==', accountType);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(limit * page)
      .get();

    const allOrders = snapshot.docs.map(doc => doc.data() as BinaryOrder);
    const total = allOrders.length;
    const startIndex = (page - 1) * limit;
    const orders = allOrders.slice(startIndex, startIndex + limit);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      filter: {
        accountType: accountType || 'all',
        status: status || 'all',
      },
      currentTime: TimezoneUtil.formatDateTime(),
      timezone: 'Asia/Jakarta (WIB)',
    };
  }

  /**
   * GET ORDER BY ID
   */
  async getOrderById(userId: string, orderId: string) {
    const db = this.firebaseService.getFirestore();
    const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();
    
    if (!orderDoc.exists) {
      throw new NotFoundException('Order not found');
    }

    const order = orderDoc.data() as BinaryOrder;
    
    if (order.user_id !== userId) {
      throw new BadRequestException('Unauthorized');
    }

    // ✅ Add timing info
    const expiryTimestamp = TimezoneUtil.toTimestamp(new Date(order.exit_time!));
    const expiryInfo = CalculationUtil.formatExpiryInfo(expiryTimestamp);

    return {
      ...order,
      expiryInfo,
      currentTime: TimezoneUtil.formatDateTime(),
      timezone: 'Asia/Jakarta (WIB)',
    };
  }

  /**
   * HELPER METHODS
   */
  private async getCachedAssetFast(assetId: string): Promise<Asset> {
    const cached = this.assetCache.get(assetId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.ASSET_CACHE_TTL) {
      return cached.asset;
    }

    const asset = await this.assetsService.getAssetById(assetId);
    this.assetCache.set(assetId, { asset, timestamp: now });
    
    return asset;
  }

  private async getFastPriceWithFallback(assetId: string) {
    try {
      const asset = await this.getCachedAssetFast(assetId);
      
      return await Promise.race([
        this.priceFetcherService.getCurrentPrice(asset, true),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 800)
        ),
      ]);
    } catch (error) {
      this.logger.error(`Fast price fetch failed: ${error.message}`);
      return null;
    }
  }

  private cleanupStaleCache(): void {
    const now = Date.now();
    
    for (const [orderId, order] of this.orderCache.entries()) {
      if (order.status !== ORDER_STATUS.ACTIVE) {
        this.orderCache.delete(orderId);
      }
    }

    for (const [assetId, cached] of this.assetCache.entries()) {
      if (now - cached.timestamp > this.ASSET_CACHE_TTL * 2) {
        this.assetCache.delete(assetId);
      }
    }
  }

  clearAllCache(): void {
    this.orderCache.clear();
    this.realActiveOrdersCache = [];
    this.demoActiveOrdersCache = [];
    this.lastRealCacheUpdate = 0;
    this.lastDemoCacheUpdate = 0;
    this.logger.debug('⚡ All caches cleared');
  }

  getPerformanceStats() {
    return {
      ordersCreated: this.orderCreateCount,
      ordersSettled: this.orderSettleCount,
      avgCreateTime: Math.round(this.avgCreateTime),
      avgSettleTime: Math.round(this.avgSettleTime),
      cacheSize: {
        orders: this.orderCache.size,
        realActiveOrders: this.realActiveOrdersCache.length,
        demoActiveOrders: this.demoActiveOrdersCache.length,
        assets: this.assetCache.size,
      },
      performance: {
        createTimeTarget: 300,
        settleTimeTarget: 200,
        createTimeStatus: this.avgCreateTime < 300 ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
        settleTimeStatus: this.avgSettleTime < 200 ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
      },
      timezone: {
        name: 'Asia/Jakarta',
        offset: 'UTC+7',
        current: TimezoneUtil.formatDateTime(),
      },
    };
  }
}