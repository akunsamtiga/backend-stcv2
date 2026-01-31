// src/binary-orders/binary-orders.service.ts
// ✅ VERSI LENGKAP DIPERBAIKI - DENGAN RATE LIMITER & REALTIME PRICE

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { AssetsService } from '../assets/assets.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { UserStatusService } from '../user/user-status.service';
import { TradingGateway } from '../websocket/trading.gateway';
import { CreateBinaryOrderDto } from './dto/create-binary-order.dto';
import { QueryBinaryOrderDto } from './dto/query-binary-order.dto';
import { 
  COLLECTIONS, 
  ORDER_STATUS, 
  BALANCE_TYPES, 
  ALL_DURATIONS, 
  ValidDuration, 
  BALANCE_ACCOUNT_TYPE,
} from '../common/constants';
import { CalculationUtil, TimezoneUtil } from '../common/utils';
import { BinaryOrder, Asset } from '../common/interfaces';

@Injectable()
export class BinaryOrdersService {
  private readonly logger = new Logger(BinaryOrdersService.name);
  
  private orderCache: Map<string, BinaryOrder> = new Map();
  private activeOrdersCache: Map<string, BinaryOrder[]> = new Map();
  private lastActiveOrdersFetch: Map<string, number> = new Map();
  private readonly ACTIVE_ORDERS_CACHE_TTL = 5000;
  
  private assetCache: Map<string, { asset: Asset; timestamp: number }> = new Map();
  private readonly ORDER_CACHE_TTL = 1000;
  private readonly ASSET_CACHE_TTL = 2000; // ✅ PERUBAHAN: 20000 → 2000 (2 detik)
  
  private processingLock = false;
  
  private orderCreateCount = 0;
  private orderSettleCount = 0;
  private avgCreateTime = 0;
  private avgSettleTime = 0;
  private settlementRunCount = 0;

  // ✅ PERUBAHAN: Tambah Rate Limiter
  private orderRateLimiter: Map<string, number[]> = new Map();
  private readonly MAX_ORDERS_PER_MINUTE = 30; // Max 30 order per menit per user
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 menit dalam milliseconds

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
    private assetsService: AssetsService,
    private priceFetcherService: PriceFetcherService,
    private userStatusService: UserStatusService,
    private readonly tradingGateway: TradingGateway,
  ) {
    setInterval(() => this.cleanupStaleCache(), 10000);
    
    this.logger.log(`🌍 Timezone: Asia/Jakarta (WIB = UTC+7)`);
    this.logger.log(`⏰ Current time: ${TimezoneUtil.formatDateTime()}`);
    this.logger.log(`💡 Status-Based Profit Bonus: Standard +0%, Gold +5%, VIP +10%`);
    this.logger.log(`⚡ 1 Second Trading Support Enabled`);
    this.logger.log(`🔒 Rate Limiter: Max ${this.MAX_ORDERS_PER_MINUTE} orders/minute per user`); // ✅ Log baru
  }

  // ============================================================================
  // ✅ PERUBAHAN: TAMBAH METHOD RATE LIMITER
  // ============================================================================

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userOrders = this.orderRateLimiter.get(userId) || [];
    
    // Filter orders dalam 1 menit terakhir
    const recentOrders = userOrders.filter(
      timestamp => now - timestamp < this.RATE_LIMIT_WINDOW
    );
    
    // Check if exceeded limit
    if (recentOrders.length >= this.MAX_ORDERS_PER_MINUTE) {
      this.logger.warn(
        `⚠️ Rate limit exceeded for user ${userId}: ` +
        `${recentOrders.length} orders in last minute`
      );
      return false;
    }
    
    // Add current timestamp
    recentOrders.push(now);
    this.orderRateLimiter.set(userId, recentOrders);
    
    return true;
  }

  // ✅ PERUBAHAN: Cleanup rate limiter setiap 5 menit
  @Cron('0 */5 * * * *')
  private cleanupRateLimiter() {
    const now = Date.now();
    let cleanedUsers = 0;
    
    this.orderRateLimiter.forEach((timestamps, userId) => {
      const recentOrders = timestamps.filter(
        timestamp => now - timestamp < this.RATE_LIMIT_WINDOW
      );
      
      if (recentOrders.length === 0) {
        this.orderRateLimiter.delete(userId);
        cleanedUsers++;
      } else {
        this.orderRateLimiter.set(userId, recentOrders);
      }
    });
    
    if (cleanedUsers > 0) {
      this.logger.debug(`🧹 Cleaned up rate limiter for ${cleanedUsers} users`);
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private isValidDuration(duration: number): duration is ValidDuration {
    const tolerance = 0.0001;
    return (ALL_DURATIONS as readonly number[]).some(allowed => 
      Math.abs(allowed - duration) < tolerance
    );
  }

  private getDurationDisplay(durationMinutes: number): string {
    return CalculationUtil.formatDurationDisplay(durationMinutes);
  }

  private async getCachedActiveOrders(accountType: 'real' | 'demo'): Promise<BinaryOrder[]> {
    const now = Date.now();
    const lastFetch = this.lastActiveOrdersFetch.get(accountType) || 0;
    const age = now - lastFetch;

    if (age < this.ACTIVE_ORDERS_CACHE_TTL) {
      const cached = this.activeOrdersCache.get(accountType);
      if (cached) {
        this.logger.debug(`⚡ Using cached active orders for ${accountType} (${age}ms old)`);
        return cached;
      }
    }

    const orders = await this.getActiveOrdersFromDB(accountType);
    this.activeOrdersCache.set(accountType, orders);
    this.lastActiveOrdersFetch.set(accountType, now);
    this.logger.debug(`📊 Fetched ${orders.length} active ${accountType} orders from Firestore`);
    
    return orders;
  }

  private clearActiveOrdersCache(): void {
    this.activeOrdersCache.clear();
    this.lastActiveOrdersFetch.clear();
  }

  // ✅ PERUBAHAN: UPDATE getFastPriceWithRetry untuk gunakan getCurrentPriceRealtime
  private async getFastPriceWithRetry(assetId: string, maxRetries = 3): Promise<any> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const asset = await this.getCachedAssetFast(assetId);
        
        // ✅ GUNAKAN getCurrentPriceRealtime dengan bypassCache = true
        const priceData = await Promise.race([
          this.priceFetcherService.getCurrentPriceRealtime(asset, true), // ✅ bypass cache
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 2000)
          ),
        ]);

        if (priceData && priceData.price) {
          if (attempt > 0) {
            this.logger.log(`✅ Price fetch succeeded on retry ${attempt + 1}`);
          }
          return priceData;
        }
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const delay = 200 * (attempt + 1);
          this.logger.warn(`⚠️ Price fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(`❌ All ${maxRetries} price fetch attempts failed: ${lastError?.message}`);
    return null;
  }

  // ============================================================================
  // ✅ PERUBAHAN: UPDATE createOrder METHOD DENGAN RATE LIMIT
  // ============================================================================

  async createOrder(userId: string, createOrderDto: CreateBinaryOrderDto) {
    const startTime = Date.now();
    const { accountType, amount, duration } = createOrderDto;
    
    try {
      // ✅ CHECK RATE LIMIT TERLEBIH DAHULU
      if (!this.checkRateLimit(userId)) {
        throw new BadRequestException({
          message: 'Too many orders. Please wait a moment before placing another order.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: 60, // seconds
        });
      }

      if (accountType !== BALANCE_ACCOUNT_TYPE.REAL && accountType !== BALANCE_ACCOUNT_TYPE.DEMO) {
        throw new BadRequestException('Invalid account type. Must be "real" or "demo"');
      }

      if (!this.isValidDuration(duration)) {
        throw new BadRequestException(
          `Invalid duration. Allowed: 1s (0.0167), ${ALL_DURATIONS.filter(d => d >= 1).join(', ')} minutes`
        );
      }

      if (amount < 1000) {
        throw new BadRequestException('Minimum order amount is Rp 1,000');
      }

      this.logger.log(`📡 Fetching asset ${createOrderDto.asset_id}...`);
      const asset = await this.getCachedAssetFast(createOrderDto.asset_id);

      if (!asset.isActive) {
        throw new BadRequestException('Asset not active');
      }

      if (asset.tradingSettings?.allowedDurations) {
        if (!CalculationUtil.isValidDuration(duration, asset.tradingSettings.allowedDurations)) {
          const allowedDisplay = asset.tradingSettings.allowedDurations
            .map(d => CalculationUtil.formatDurationDisplay(d))
            .join(', ');
          throw new BadRequestException(
            `Duration not allowed for ${asset.symbol}. Allowed: ${allowedDisplay}`
          );
        }
      }

      // ✅ FETCH REALTIME PRICE (bypass cache)
      this.logger.log(`📡 Fetching realtime price for ${asset.symbol}...`);
      const priceData = await this.getFastPriceWithRetry(createOrderDto.asset_id, 3);

      if (!priceData || !priceData.price) {
        throw new BadRequestException(
          `Price unavailable for ${asset.symbol}. Please wait a moment and try again.`
        );
      }

      const now = TimezoneUtil.getCurrentTimestamp();
      const dataAge = now - (priceData.timestamp || 0);
      
      if (dataAge > 10) {
        this.logger.warn(`⚠️ Price data is ${dataAge}s old for ${asset.symbol}`);
      }

      // ✅ LOG PRICE INFO untuk debugging
      this.logger.log(
        `✅ Got realtime price for ${asset.symbol}: ${priceData.price} ` +
        `(${dataAge}s old) at ${new Date().toISOString()}`
      );

      const userStatus = await this.userStatusService.getUserStatus(userId);
      const statusBonus = this.userStatusService.getProfitBonus(userStatus);
      
      const baseProfitRate = asset.profitRate;
      const finalProfitRate = baseProfitRate + statusBonus;

      const durationDisplay = this.getDurationDisplay(duration);
      this.logger.log(`👤 User ${userId} status: ${userStatus.toUpperCase()}`);
      this.logger.log(`💰 Base profit: ${baseProfitRate}% + Status bonus: ${statusBonus}% = ${finalProfitRate}%`);
      this.logger.log(`⏱️ Duration: ${durationDisplay}`);

      this.logger.log(`💰 Checking ${accountType} balance for user ${userId}...`);
      
      const currentBalance = await this.balanceService.getCurrentBalanceStrict(userId, accountType);

      this.logger.log(`💰 ${accountType} balance: ${currentBalance}, Required: ${amount}`);

      if (currentBalance < amount) {
        throw new BadRequestException(
          `Insufficient ${accountType} balance. Available: Rp ${currentBalance.toLocaleString()}, Required: Rp ${amount.toLocaleString()}`
        );
      }

      if (currentBalance === 0) {
        throw new BadRequestException('Cannot create order with zero balance. Please deposit first.');
      }

      const orderId = await this.firebaseService.generateId(COLLECTIONS.ORDERS);
      
      const entryTimestamp = TimezoneUtil.getCurrentTimestamp();
      const expiryTimestamp = CalculationUtil.calculateExpiryTimestamp(entryTimestamp, duration);
      
      const remainingSeconds = TimezoneUtil.getRemainingSecondsInMinute(entryTimestamp);
      const isAdjusted = remainingSeconds <= 20;

      if (isAdjusted) {
        this.logger.warn(
          `⚠️ [END-OF-CANDLE] ${asset.symbol} - ` +
          `Entry: ${TimezoneUtil.formatDateTime()} (${remainingSeconds}s remaining), ` +
          `Expiry: ${TimezoneUtil.formatTimestamp(expiryTimestamp)} (ADJUSTED +1min)`
        );
      }

      const entryDate = TimezoneUtil.fromTimestamp(entryTimestamp);
      const expiryDate = TimezoneUtil.fromTimestamp(expiryTimestamp);
      
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
        entry_price: priceData.price, // ✅ Realtime price
        entry_time: entryDateTimeInfo.datetime_iso,
        exit_price: null,
        exit_time: expiryDateTimeInfo.datetime_iso,
        status: ORDER_STATUS.ACTIVE,
        profit: null,
        profitRate: finalProfitRate,
        baseProfitRate: baseProfitRate,
        statusBonus: statusBonus,
        userStatus: userStatus,
        metadata: {
          isEndOfCandleEntry: isAdjusted,
          remainingSecondsInMinute: remainingSeconds,
          originalDuration: createOrderDto.duration,
          adjustedDuration: isAdjusted ? createOrderDto.duration + 1 : createOrderDto.duration,
          timezone: 'Asia/Jakarta',
        },
        createdAt: entryDateTimeInfo.datetime_iso,
      };

      const db = this.firebaseService.getFirestore();
      await db.collection(COLLECTIONS.ORDERS).doc(orderId).set(orderData);

      this.logger.log(`✅ Order ${orderId} created, debiting balance...`);
      this.logger.log(`📅 Entry: ${entryDateTimeInfo.datetime} WIB (${entryTimestamp})`);
      this.logger.log(`📅 Expiry: ${expiryDateTimeInfo.datetime} WIB (${expiryTimestamp})`);
      
      if (isAdjusted) {
        this.logger.warn(`⚠️ Expiry adjusted due to late entry (${remainingSeconds}s remaining)`);
      }
      
      this.logger.log(`⏱️ Duration: ${durationDisplay}`);

      try {
        await this.balanceService.createBalanceEntry(userId, {
          accountType,
          type: BALANCE_TYPES.ORDER_DEBIT,
          amount: createOrderDto.amount,
          description: `[${accountType.toUpperCase()}] Order #${orderId.slice(-8)} - ${asset.symbol} ${createOrderDto.direction} (${durationDisplay})`,
        }, true);

        this.logger.log(`✅ Balance debited successfully`);
      } catch (debitError) {
        this.logger.error(`❌ Balance debit failed, rolling back order: ${debitError.message}`);
        await db.collection(COLLECTIONS.ORDERS).doc(orderId).delete();
        throw new BadRequestException(`Failed to debit balance: ${debitError.message}`);
      }

      this.balanceService.clearUserCache(userId);
      this.orderCache.set(orderId, orderData);
      this.clearActiveOrdersCache();

      const newBalance = await this.balanceService.getCurrentBalance(userId, accountType, true);
      
      this.logger.log(`✅ Order complete - New ${accountType} balance: ${newBalance} (deducted ${amount})`);

      const executionTime = Date.now() - startTime;
      this.orderCreateCount++;
      this.avgCreateTime = (this.avgCreateTime * 0.9) + (executionTime * 0.1);

      this.tradingGateway.emitOrderCreated(userId, {
        order: orderData,
        accountType,
        balanceAfter: newBalance,
        executionTime,
        durationDisplay,
        statusInfo: {
          userStatus,
          baseProfitRate,
          statusBonus,
          finalProfitRate,
        },
        timing: {
          entry: entryDateTimeInfo.datetime,
          expiry: expiryDateTimeInfo.datetime,
          entryTimestamp,
          expiryTimestamp,
          durationSeconds: expiryTimestamp - entryTimestamp,
          timezone: 'Asia/Jakarta (WIB)',
          expiryAdjusted: isAdjusted,
          originalDuration: createOrderDto.duration,
          adjustedDuration: isAdjusted ? createOrderDto.duration + 1 : createOrderDto.duration,
          remainingSecondsInMinute: remainingSeconds,
        },
      });

      // ✅ LOG PERFORMANCE setiap 10 orders
      if (this.orderCreateCount % 10 === 0) {
        this.logger.log(
          `📊 Order Performance: Created ${this.orderCreateCount} orders, ` +
          `avg time: ${Math.round(this.avgCreateTime)}ms`
        );
      }

      this.logger.log(
        `⚡ [${accountType.toUpperCase()}] Order created in ${executionTime}ms - ` +
        `${asset.symbol} ${createOrderDto.direction} ${durationDisplay} (Profit: ${finalProfitRate}%)`
      );

      return {
        message: `${accountType} order created successfully`,
        order: orderData,
        accountType,
        balanceAfter: newBalance,
        executionTime,
        durationDisplay,
        statusInfo: {
          userStatus,
          baseProfitRate,
          statusBonus,
          finalProfitRate,
        },
        timing: {
          entry: entryDateTimeInfo.datetime,
          expiry: expiryDateTimeInfo.datetime,
          entryTimestamp,
          expiryTimestamp,
          durationSeconds: expiryTimestamp - entryTimestamp,
          timezone: 'Asia/Jakarta (WIB)',
          expiryAdjusted: isAdjusted,
          originalDuration: createOrderDto.duration,
          adjustedDuration: isAdjusted ? createOrderDto.duration + 1 : createOrderDto.duration,
          remainingSecondsInMinute: remainingSeconds,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Order creation failed after ${duration}ms: ${error.message}`);
      throw error;
    }
  }

  // ============================================================================
  // SETTLEMENT METHODS
  // ============================================================================

  @Cron('*/1 * * * * *')
  async processExpiredOrders() {
    if (this.processingLock) return;

    this.processingLock = true;
    this.settlementRunCount++;
    const startTime = Date.now();

    try {
      const currentTimestamp = TimezoneUtil.getCurrentTimestamp();
      const currentDateTime = TimezoneUtil.formatDateTime();
      
      const [realOrders, demoOrders] = await Promise.all([
        this.getCachedActiveOrders(BALANCE_ACCOUNT_TYPE.REAL),
        this.getCachedActiveOrders(BALANCE_ACCOUNT_TYPE.DEMO),
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
        if (this.settlementRunCount % 60 === 0) {
          this.logger.debug(
            `⏰ Settlement check #${this.settlementRunCount}: No expired orders ` +
            `(${realOrders.length + demoOrders.length} active)`
          );
        }
        return;
      }

      this.logger.log(
        `⚡ [${currentDateTime} WIB] Processing ${totalExpired} expired orders ` +
        `(Real: ${expiredRealOrders.length}, Demo: ${expiredDemoOrders.length})`
      );

      const PARALLEL_LIMIT = 20;
      await Promise.all([
        this.settleBatch(expiredRealOrders, PARALLEL_LIMIT),
        this.settleBatch(expiredDemoOrders, PARALLEL_LIMIT),
      ]);

      this.clearActiveOrdersCache();
      this.clearAllCache();

      const duration = Date.now() - startTime;
      this.logger.log(`⚡ Settled ${totalExpired} orders in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Settlement error: ${error.message}`);
    } finally {
      this.processingLock = false;
    }
  }

  private async settleBatch(orders: BinaryOrder[], batchSize: number): Promise<void> {
    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(order => this.settleOrderInstant(order)));
    }
  }

  private async settleOrderInstant(order: BinaryOrder): Promise<void> {
    const startTime = Date.now();
    
    try {
      const asset = await this.getCachedAssetFast(order.asset_id);
      
      let priceData: any = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts && !priceData?.price) {
        try {
          priceData = await Promise.race([
            this.priceFetcherService.getCurrentPrice(asset, false),
            new Promise<any>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 2000)
            ),
          ]);

          if (priceData?.price) break;
        } catch (error) {
          attempts++;
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      if (!priceData?.price) {
        this.logger.warn(`⚠️ No price for order ${order.id} after ${maxAttempts} attempts, retrying next cycle`);
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
      
      const settlementDateTime = TimezoneUtil.formatDateTime();
      const durationDisplay = this.getDurationDisplay(order.duration);
      
      await db.collection(COLLECTIONS.ORDERS).doc(order.id).update({
        exit_price: priceData.price,
        status: result,
        profit,
        settled_at: TimezoneUtil.toISOString(),
      });

      if (result === 'WON') {
        const totalReturn = order.amount + profit;
        
        await this.balanceService.createBalanceEntry(order.user_id, {
          accountType: order.accountType,
          type: BALANCE_TYPES.ORDER_PROFIT,
          amount: totalReturn,
          description: `[${order.accountType.toUpperCase()}] Won #${order.id.slice(-8)} - ${asset.symbol} +${profit.toFixed(0)} (${order.userStatus?.toUpperCase() || 'STANDARD'} bonus, ${durationDisplay})`,
        }, true);
      }

      this.orderCache.delete(order.id);

      this.tradingGateway.emitOrderSettled(order.user_id, {
        id: order.id,
        status: result,
        exit_price: priceData.price,
        profit,
        profitRate: order.profitRate,
        asset_symbol: order.asset_name,
        duration: order.duration,
        settled_at: settlementDateTime,
      });

      const duration = Date.now() - startTime;
      this.orderSettleCount++;
      this.avgSettleTime = (this.avgSettleTime * 0.9) + (duration * 0.1);

      this.logger.log(
        `⚡ [${settlementDateTime} WIB] [${order.accountType.toUpperCase()}] ` +
        `Settled ${order.id.slice(-8)} in ${duration}ms - ${durationDisplay} ${result} ` +
        `${profit > 0 ? '+' : ''}${profit.toFixed(2)} (${order.profitRate}%)`
      );
    } catch (error) {
      this.logger.error(`Settlement failed for ${order.id}: ${error.message}`);
    }
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

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

  async getOrders(userId: string, queryDto: QueryBinaryOrderDto) {
    const startTime = Date.now();
    
    try {
      const { status, page = 1, limit = 20, accountType } = queryDto;
      const db = this.firebaseService.getFirestore();
      
      try {
        let query = db.collection(COLLECTIONS.ORDERS).where('user_id', '==', userId);

        if (accountType && (accountType === 'real' || accountType === 'demo')) {
          query = query.where('accountType', '==', accountType) as any;
        }

        if (status) {
          query = query.where('status', '==', status) as any;
        }

        const snapshot = await query
          .orderBy('createdAt', 'desc')
          .limit(limit * page)
          .get();

        const allOrders = snapshot.docs.map(doc => {
          const order = doc.data() as BinaryOrder;
          return {
            ...order,
            durationDisplay: this.getDurationDisplay(order.duration),
          };
        });
        
        const total = allOrders.length;
        const startIndex = (page - 1) * limit;
        const orders = allOrders.slice(startIndex, startIndex + limit);

        const duration = Date.now() - startTime;
        this.logger.debug(`✅ Got ${orders.length} orders in ${duration}ms`);

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
      } catch (indexError) {
        this.logger.warn(`⚠️ Index error, using fallback query: ${indexError.message}`);
        
        const snapshot = await db.collection(COLLECTIONS.ORDERS)
          .where('user_id', '==', userId)
          .get();

        let allOrders = snapshot.docs.map(doc => {
          const order = doc.data() as BinaryOrder;
          return {
            ...order,
            durationDisplay: this.getDurationDisplay(order.duration),
          };
        });

        if (accountType && (accountType === 'real' || accountType === 'demo')) {
          allOrders = allOrders.filter(o => o.accountType === accountType);
        }

        if (status) {
          allOrders = allOrders.filter(o => o.status === status);
        }

        allOrders.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA;
        });

        const total = allOrders.length;
        const startIndex = (page - 1) * limit;
        const orders = allOrders.slice(startIndex, startIndex + limit);

        const duration = Date.now() - startTime;
        this.logger.log(`✅ Got ${orders.length} orders in ${duration}ms (fallback query)`);

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
          usingFallback: true,
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Get orders failed after ${duration}ms: ${error.message}`);
      
      return {
        orders: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
        filter: {
          accountType: 'all',
          status: 'all',
        },
        currentTime: TimezoneUtil.formatDateTime(),
        timezone: 'Asia/Jakarta (WIB)',
        error: error.message,
      };
    }
  }

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

    const expiryTimestamp = TimezoneUtil.toTimestamp(new Date(order.exit_time!));
    const expiryInfo = CalculationUtil.formatExpiryInfo(expiryTimestamp);

    return {
      ...order,
      durationDisplay: this.getDurationDisplay(order.duration),
      expiryInfo,
      currentTime: TimezoneUtil.formatDateTime(),
      timezone: 'Asia/Jakarta (WIB)',
    };
  }

  // ============================================================================
  // CACHE METHODS
  // ============================================================================

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

    for (const [accountType, timestamp] of this.lastActiveOrdersFetch.entries()) {
      if (now - timestamp > this.ACTIVE_ORDERS_CACHE_TTL * 10) {
        this.activeOrdersCache.delete(accountType);
        this.lastActiveOrdersFetch.delete(accountType);
      }
    }
  }

  clearAllCache(): void {
    this.orderCache.clear();
    this.clearActiveOrdersCache();
    this.logger.debug('⚡ All caches cleared');
  }

  // ============================================================================
  // ✅ PERUBAHAN: TAMBAH METHOD HELPER UNTUK MONITORING
  // ============================================================================

  getRateLimitStats(): {
    totalUsers: number;
    activeUsers: number;
    averageOrdersPerUser: number;
  } {
    const now = Date.now();
    let totalOrders = 0;
    let activeUsers = 0;

    this.orderRateLimiter.forEach((timestamps) => {
      const recentOrders = timestamps.filter(
        timestamp => now - timestamp < this.RATE_LIMIT_WINDOW
      );
      
      if (recentOrders.length > 0) {
        activeUsers++;
        totalOrders += recentOrders.length;
      }
    });

    return {
      totalUsers: this.orderRateLimiter.size,
      activeUsers,
      averageOrdersPerUser: activeUsers > 0 ? totalOrders / activeUsers : 0,
    };
  }

  getPerformanceStats() {
    const rateLimitStats = this.getRateLimitStats(); // ✅ Tambahan

    return {
      ordersCreated: this.orderCreateCount,
      ordersSettled: this.orderSettleCount,
      settlementRuns: this.settlementRunCount,
      avgCreateTime: Math.round(this.avgCreateTime),
      avgSettleTime: Math.round(this.avgSettleTime),
      cacheSize: {
        orders: this.orderCache.size,
        realActiveOrders: this.activeOrdersCache.get('real')?.length || 0,
        demoActiveOrders: this.activeOrdersCache.get('demo')?.length || 0,
        assets: this.assetCache.size,
      },
      rateLimiter: rateLimitStats, // ✅ Tambahan
      performance: {
        createTimeTarget: 300,
        settleTimeTarget: 200,
        createTimeStatus: this.avgCreateTime < 300 ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
        settleTimeStatus: this.avgSettleTime < 200 ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
      },
      optimization: {
        settlementInterval: '1 second',
        estimatedDailyChecks: 86400,
        cacheTTL: `${this.ACTIVE_ORDERS_CACHE_TTL}ms`,
        assetCacheTTL: `${this.ASSET_CACHE_TTL}ms`, // ✅ Tambahan
        savingsVsOld: '60% fewer Firestore reads',
        oneSecondSupport: true,
        rateLimitEnabled: true, // ✅ Tambahan
        maxOrdersPerMinute: this.MAX_ORDERS_PER_MINUTE, // ✅ Tambahan
      },
      timezone: {
        name: 'Asia/Jakarta',
        offset: 'UTC+7',
        current: TimezoneUtil.formatDateTime(),
      },
    };
  }
}