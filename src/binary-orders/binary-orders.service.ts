// src/binary-orders/binary-orders.service.ts
// ⚡ INSTANT SETTLEMENT VERSION - No delay notifications!

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { AssetsService } from '../assets/assets.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { CreateBinaryOrderDto } from './dto/create-binary-order.dto';
import { QueryBinaryOrderDto } from './dto/query-binary-order.dto';
import { COLLECTIONS, ORDER_STATUS, BALANCE_TYPES, ALL_DURATIONS, ValidDuration } from '../common/constants';
import { CalculationUtil } from '../common/utils';
import { BinaryOrder, Asset } from '../common/interfaces';

@Injectable()
export class BinaryOrdersService {
  private readonly logger = new Logger(BinaryOrdersService.name);
  
  // ⚡ AGGRESSIVE MULTI-LEVEL CACHING
  private orderCache: Map<string, BinaryOrder> = new Map();
  private assetCache: Map<string, { asset: Asset; timestamp: number }> = new Map();
  private activeOrdersCache: BinaryOrder[] = [];
  private userBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  
  // ✅ SUPER SHORT CACHE TTLs untuk instant updates
  private readonly ORDER_CACHE_TTL = 1000; // ✅ 1 second only!
  private readonly ASSET_CACHE_TTL = 20000;
  private readonly BALANCE_CACHE_TTL = 1000; // ✅ 1 second only!
  private lastCacheUpdate = 0;
  
  // ⚡ PROCESSING OPTIMIZATION
  private isProcessing = false;
  private processingLock = false;
  
  // ⚡ PERFORMANCE METRICS
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
    // Cleanup setiap 10s (lebih sering)
    setInterval(() => this.cleanupStaleCache(), 10000);
  }

  private isValidDuration(duration: number): duration is ValidDuration {
    return (ALL_DURATIONS as readonly number[]).includes(duration);
  }

  /**
   * ⚡ ULTRA-FAST ORDER CREATION
   */
  async createOrder(userId: string, createOrderDto: CreateBinaryOrderDto) {
    const startTime = Date.now();
    
    try {
      if (!this.isValidDuration(createOrderDto.duration)) {
        throw new BadRequestException(
          `Invalid duration. Allowed: ${ALL_DURATIONS.join(', ')} minutes`
        );
      }

      const [currentBalance, asset, priceData] = await Promise.all([
        this.getCachedBalanceFast(userId),
        this.getCachedAssetFast(createOrderDto.asset_id),
        this.getFastPriceWithFallback(createOrderDto.asset_id),
      ]);

      if (currentBalance < createOrderDto.amount) {
        throw new BadRequestException('Insufficient balance');
      }

      if (!asset.isActive) {
        throw new BadRequestException('Asset not active');
      }

      if (!priceData || !priceData.price) {
        throw new BadRequestException('Price unavailable');
      }

      const orderId = await this.firebaseService.generateId(COLLECTIONS.ORDERS);
      const timestamp = new Date().toISOString();
      const expiryTime = CalculationUtil.calculateExpiryTime(
        new Date(), 
        createOrderDto.duration
      );

      const orderData: BinaryOrder = {
        id: orderId,
        user_id: userId,
        asset_id: asset.id,
        asset_name: asset.name,
        direction: createOrderDto.direction as 'CALL' | 'PUT',
        amount: createOrderDto.amount,
        duration: createOrderDto.duration,
        entry_price: priceData.price,
        entry_time: timestamp,
        exit_price: null,
        exit_time: expiryTime.toISOString(),
        status: ORDER_STATUS.ACTIVE,
        profit: null,
        profitRate: asset.profitRate,
        createdAt: timestamp,
      };

      const db = this.firebaseService.getFirestore();
      
      // ✅ Write order (wait)
      await db.collection(COLLECTIONS.ORDERS).doc(orderId).set(orderData);

      // ✅ Balance write in background
      this.balanceService.createBalanceEntry(userId, {
        type: BALANCE_TYPES.ORDER_DEBIT,
        amount: createOrderDto.amount,
        description: `Order #${orderId.slice(-8)} - ${asset.symbol} ${createOrderDto.direction}`,
      }).catch(err => {
        this.logger.error(`Background balance write failed: ${err.message}`);
      });

      // ✅ INSTANT cache update
      this.orderCache.set(orderId, orderData);
      this.activeOrdersCache.push(orderData);
      this.invalidateBalanceCache(userId);
      
      // ✅ FORCE clear active orders cache untuk instant refresh
      this.lastCacheUpdate = 0;

      const duration = Date.now() - startTime;
      this.orderCreateCount++;
      this.avgCreateTime = (this.avgCreateTime * 0.9) + (duration * 0.1);

      this.logger.log(
        `⚡ Order created in ${duration}ms - ${asset.symbol} ${createOrderDto.direction} ${createOrderDto.duration}min`
      );

      return {
        message: 'Order created',
        order: orderData,
        executionTime: duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Order creation failed after ${duration}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * ⚡ INSTANT CACHE METHODS
   */
  private async getCachedBalanceFast(userId: string): Promise<number> {
    const cached = this.userBalanceCache.get(userId);
    const now = Date.now();

    // ✅ Super short TTL
    if (cached && (now - cached.timestamp) < this.BALANCE_CACHE_TTL) {
      return cached.balance;
    }

    const balance = await this.balanceService.getCurrentBalance(userId);
    this.userBalanceCache.set(userId, { balance, timestamp: now });
    
    return balance;
  }

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

  /**
   * ⚡ ULTRA-FAST CRON - EVERY 2 SECONDS! (reduced from 3)
   */
  @Cron('*/2 * * * * *') // ✅ Every 2 seconds!
  async processExpiredOrders() {
    if (this.processingLock) return;

    this.processingLock = true;
    const startTime = Date.now();

    try {
      const now = new Date();
      
      // ✅ Get FRESH active orders (no cache for settlement)
      const activeOrders = await this.getActiveOrdersFromDB();
      
      // ✅ Filter expired with 1 second tolerance
      const expiredOrders = activeOrders.filter(order => {
        const exitTime = new Date(order.exit_time!);
        const diff = exitTime.getTime() - now.getTime();
        return diff <= 1000; // ✅ Settle if within 1 second of expiry
      });

      if (expiredOrders.length === 0) {
        return;
      }

      this.logger.log(`⚡ Processing ${expiredOrders.length} expired orders`);

      // ⚡ PARALLEL SETTLEMENT
      const PARALLEL_LIMIT = 20; // ✅ Increased
      for (let i = 0; i < expiredOrders.length; i += PARALLEL_LIMIT) {
        const batch = expiredOrders.slice(i, i + PARALLEL_LIMIT);
        
        await Promise.allSettled(
          batch.map(order => this.settleOrderInstant(order))
        );
      }

      // ✅ FORCE clear ALL caches
      this.clearAllCache();

      const duration = Date.now() - startTime;
      this.logger.log(`⚡ Settled ${expiredOrders.length} orders in ${duration}ms`);

    } catch (error) {
      this.logger.error(`Settlement error: ${error.message}`);
    } finally {
      this.processingLock = false;
    }
  }

  /**
   * ⚡ INSTANT ORDER SETTLEMENT
   */
  private async settleOrderInstant(order: BinaryOrder): Promise<void> {
    const startTime = Date.now();
    
    try {
      // ⚡ PARALLEL FETCH
      const [asset, priceData] = await Promise.all([
        this.getCachedAssetFast(order.asset_id),
        Promise.race([
          this.priceFetcherService.getCurrentPrice(
            await this.getCachedAssetFast(order.asset_id),
            false
          ),
          new Promise<any>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 1000) // ✅ 1s timeout
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
      
      // ✅ ATOMIC UPDATE - WAIT for completion
      await db.collection(COLLECTIONS.ORDERS)
        .doc(order.id)
        .update({
          exit_price: priceData.price,
          status: result,
          profit,
        });

      // ✅ Balance update - WAIT if won (critical)
      if (result === 'WON') {
        const totalReturn = order.amount + profit;
        
        await this.balanceService.createBalanceEntry(order.user_id, {
          type: BALANCE_TYPES.ORDER_PROFIT,
          amount: totalReturn,
          description: `Won #${order.id.slice(-8)} - ${asset.symbol} +${profit.toFixed(0)}`,
        }, true); // ✅ critical = true, WAIT for completion
      }

      // ✅ FORCE invalidate ALL related caches
      this.orderCache.delete(order.id);
      this.invalidateBalanceCache(order.user_id);
      this.lastCacheUpdate = 0; // Force refresh active orders

      const duration = Date.now() - startTime;
      this.orderSettleCount++;
      this.avgSettleTime = (this.avgSettleTime * 0.9) + (duration * 0.1);

      this.logger.log(
        `⚡ Settled ${order.id.slice(-8)} in ${duration}ms - ${result} ${profit > 0 ? '+' : ''}${profit.toFixed(2)}`
      );

    } catch (error) {
      this.logger.error(`Settlement failed for ${order.id}: ${error.message}`);
    }
  }

  /**
   * ✅ GET ACTIVE ORDERS DIRECTLY FROM DB (no cache for settlement)
   */
  private async getActiveOrdersFromDB(): Promise<BinaryOrder[]> {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('status', '==', ORDER_STATUS.ACTIVE)
      .limit(500)
      .get();

    return snapshot.docs.map(doc => doc.data() as BinaryOrder);
  }

  /**
   * ⚡ FAST ACTIVE ORDERS with MINIMAL CACHE
   */
  private async getActiveOrdersFromCache(): Promise<BinaryOrder[]> {
    const now = Date.now();
    
    // ✅ Super short cache - 1 second only
    if (
      this.activeOrdersCache.length > 0 && 
      (now - this.lastCacheUpdate) < 1000
    ) {
      return this.activeOrdersCache;
    }

    const db = this.firebaseService.getFirestore();
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('status', '==', ORDER_STATUS.ACTIVE)
      .limit(500)
      .get();

    this.activeOrdersCache = snapshot.docs.map(doc => doc.data() as BinaryOrder);
    this.lastCacheUpdate = now;

    return this.activeOrdersCache;
  }

  /**
   * GET ORDERS (with smart caching)
   */
  async getOrders(userId: string, queryDto: QueryBinaryOrderDto) {
    const { status, page = 1, limit = 20 } = queryDto;

    const db = this.firebaseService.getFirestore();
    let query = db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId);

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
    };
  }

  /**
   * GET ORDER BY ID
   */
  async getOrderById(userId: string, orderId: string) {
    // ✅ NO CACHE - always fresh for order detail
    const db = this.firebaseService.getFirestore();
    const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();
    
    if (!orderDoc.exists) {
      throw new NotFoundException('Order not found');
    }

    const order = orderDoc.data() as BinaryOrder;
    
    if (order.user_id !== userId) {
      throw new BadRequestException('Unauthorized');
    }

    return order;
  }

  /**
   * CACHE MANAGEMENT
   */
  private invalidateBalanceCache(userId: string): void {
    this.userBalanceCache.delete(userId);
  }

  private cleanupStaleCache(): void {
    const now = Date.now();
    
    // ✅ More aggressive cleanup
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

    for (const [userId, cached] of this.userBalanceCache.entries()) {
      if (now - cached.timestamp > this.BALANCE_CACHE_TTL * 5) {
        this.userBalanceCache.delete(userId);
      }
    }
  }

  /**
   * ✅ CLEAR ALL CACHE (called after settlement)
   */
  clearAllCache(): void {
    this.orderCache.clear();
    this.activeOrdersCache = [];
    this.lastCacheUpdate = 0;
    this.logger.debug('⚡ All caches cleared for instant updates');
  }

  /**
   * PERFORMANCE STATS
   */
  getPerformanceStats() {
    return {
      ordersCreated: this.orderCreateCount,
      ordersSettled: this.orderSettleCount,
      avgCreateTime: Math.round(this.avgCreateTime),
      avgSettleTime: Math.round(this.avgSettleTime),
      cacheSize: {
        orders: this.orderCache.size,
        activeOrders: this.activeOrdersCache.length,
        assets: this.assetCache.size,
        balances: this.userBalanceCache.size,
      },
      performance: {
        createTimeTarget: 300,
        settleTimeTarget: 200,
        createTimeStatus: this.avgCreateTime < 300 ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
        settleTimeStatus: this.avgSettleTime < 200 ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
      }
    };
  }
}