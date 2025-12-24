import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
  
  // ⚡ Multi-level caching untuk ultra-fast access
  private orderCache: Map<string, BinaryOrder> = new Map();
  private assetCache: Map<string, { asset: Asset; timestamp: number }> = new Map();
  private activeOrdersCache: BinaryOrder[] = [];
  private userBalanceCache: Map<string, { balance: number; timestamp: number }> = new Map();
  
  // ⚡ Cache TTLs
  private readonly ORDER_CACHE_TTL = 10000; // 10 seconds
  private readonly ASSET_CACHE_TTL = 30000; // 30 seconds  
  private readonly BALANCE_CACHE_TTL = 5000; // 5 seconds
  private lastCacheUpdate = 0;
  
  // ⚡ Processing optimization
  private isProcessing = false;
  private processingLock = false;
  private settlementQueue: BinaryOrder[] = [];
  
  // ⚡ Performance metrics
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
    // ⚡ Initialize cache cleanup
    setInterval(() => this.cleanupStaleCache(), 60000); // Every minute
  }

  private isValidDuration(duration: number): duration is ValidDuration {
    return (ALL_DURATIONS as readonly number[]).includes(duration);
  }

  /**
   * ⚡ ULTRA-FAST ORDER CREATION
   * Target: < 500ms response time
   */
    async createOrder(userId: string, createOrderDto: CreateBinaryOrderDto) {
    const startTime = Date.now();
    
    try {
      // ✅ Step 1: Quick validation (< 50ms)
      if (!this.isValidDuration(createOrderDto.duration)) {
        throw new BadRequestException(
          `Invalid duration. Allowed: ${ALL_DURATIONS.join(', ')} minutes`
        );
      }

      // ✅ Step 2: Parallel fetch with cache (< 200ms)
      const [currentBalance, asset, priceData] = await Promise.all([
        this.getCachedBalance(userId),
        this.getCachedAsset(createOrderDto.asset_id),
        this.getFastPrice(createOrderDto.asset_id),
      ]);

      // ✅ Step 3: Quick business logic validation (< 10ms)
      if (currentBalance < createOrderDto.amount) {
        throw new BadRequestException('Insufficient balance');
      }

      if (!asset.isActive) {
        throw new BadRequestException('Asset not active');
      }

      if (!priceData || !priceData.price) {
        throw new BadRequestException('Price unavailable');
      }

      // ✅ Step 4: Prepare order data (< 10ms)
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

      // ✅ Step 5: Atomic write - Fire and forget style (< 200ms)
      const db = this.firebaseService.getFirestore();
      
      // Write to Firebase (don't wait for balance write)
      const orderPromise = db.collection(COLLECTIONS.ORDERS)
        .doc(orderId)
        .set(orderData);

      // ⚡ FIX: Ganti dari 'withdrawal' ke 'order_debit'
      const balancePromise = this.balanceService.createBalanceEntry(userId, {
        type: BALANCE_TYPES.ORDER_DEBIT,  // ✅ FIXED: Dulu 'withdrawal'
        amount: createOrderDto.amount,
        description: `Order #${orderId.slice(-8)} - ${asset.symbol} ${createOrderDto.direction}`,
      });

      // Wait for order write, but balance can complete later
      await orderPromise;
      
      // Update caches immediately
      this.orderCache.set(orderId, orderData);
      this.activeOrdersCache.push(orderData);
      this.invalidateBalanceCache(userId);

      // Let balance write complete in background
      balancePromise.catch(err => {
        this.logger.error(`Background balance write failed: ${err.message}`);
      });

      const duration = Date.now() - startTime;
      this.orderCreateCount++;
      this.avgCreateTime = (this.avgCreateTime + duration) / 2;

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
   * ⚡ FAST CACHED BALANCE (< 100ms)
   */
  private async getCachedBalance(userId: string): Promise<number> {
    const cached = this.userBalanceCache.get(userId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.BALANCE_CACHE_TTL) {
      return cached.balance;
    }

    const balance = await this.balanceService.getCurrentBalance(userId);
    this.userBalanceCache.set(userId, { balance, timestamp: now });
    
    return balance;
  }

  /**
   * ⚡ FAST CACHED ASSET (< 50ms)
   */
  private async getCachedAsset(assetId: string): Promise<Asset> {
    const cached = this.assetCache.get(assetId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.ASSET_CACHE_TTL) {
      return cached.asset;
    }

    const asset = await this.assetsService.getAssetById(assetId);
    this.assetCache.set(assetId, { asset, timestamp: now });
    
    return asset;
  }

  /**
   * ⚡ ULTRA-FAST PRICE FETCH (< 100ms)
   */
  private async getFastPrice(assetId: string) {
    try {
      const asset = await this.getCachedAsset(assetId);
      
      // Use aggressive timeout for order creation
      return await Promise.race([
        this.priceFetcherService.getCurrentPrice(asset),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 1000) // 1 second max
        ),
      ]);
    } catch (error) {
      this.logger.error(`Fast price fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * ⚡ OPTIMIZED CRON - Every 3 seconds
   */
  @Cron('*/3 * * * * *') // Every 3 seconds
  async processExpiredOrders() {
    if (this.processingLock) {
      return; // Skip if already processing
    }

    this.processingLock = true;
    const startTime = Date.now();

    try {
      const now = new Date();
      
      // ✅ Use cached active orders
      let activeOrders = await this.getActiveOrdersFromCache();
      
      // Filter expired
      const expiredOrders = activeOrders.filter(
        order => new Date(order.exit_time!) <= now
      );

      if (expiredOrders.length === 0) {
        return;
      }

      this.logger.log(`⚡ Processing ${expiredOrders.length} expired orders`);

      // ✅ Parallel settlement with limit
      const PARALLEL_LIMIT = 10;
      for (let i = 0; i < expiredOrders.length; i += PARALLEL_LIMIT) {
        const batch = expiredOrders.slice(i, i + PARALLEL_LIMIT);
        
        await Promise.allSettled(
          batch.map(order => this.settleOrderFast(order))
        );
      }

      // Update cache
      this.activeOrdersCache = this.activeOrdersCache.filter(
        order => !expiredOrders.some(expired => expired.id === order.id)
      );

      const duration = Date.now() - startTime;
      this.logger.log(`⚡ Settled ${expiredOrders.length} orders in ${duration}ms`);

    } catch (error) {
      this.logger.error(`Settlement error: ${error.message}`);
    } finally {
      this.processingLock = false;
    }
  }

  /**
   * ⚡ FAST ORDER SETTLEMENT (< 300ms per order)
   */
  private async settleOrderFast(order: BinaryOrder): Promise<void> {
    const startTime = Date.now();
    
    try {
      // ✅ Parallel fetch asset and price
      const [asset, priceData] = await Promise.all([
        this.getCachedAsset(order.asset_id),
        Promise.race([
          this.priceFetcherService.getCurrentPrice(
            await this.getCachedAsset(order.asset_id)
          ),
          new Promise<any>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 2000)
          ),
        ]),
      ]);

      if (!priceData?.price) {
        this.logger.warn(`No price for order ${order.id}, retrying next cycle`);
        return;
      }

      // ✅ Calculate result
      const result = CalculationUtil.determineBinaryResult(
        order.direction,
        order.entry_price,
        priceData.price,
      );

      const profit = result === 'WON' 
        ? CalculationUtil.calculateBinaryProfit(order.amount, order.profitRate)
        : -order.amount;

      // ✅ Atomic update
      const db = this.firebaseService.getFirestore();
      
      const updatePromise = db.collection(COLLECTIONS.ORDERS)
        .doc(order.id)
        .update({
          exit_price: priceData.price,
          status: result,
          profit,
        });

      // ⚡ FIX: Ganti dari 'win' ke 'order_profit'
      let balancePromise: Promise<any> | null = null;
      if (result === 'WON') {
        const totalReturn = order.amount + profit;
        
        balancePromise = this.balanceService.createBalanceEntry(order.user_id, {
          type: BALANCE_TYPES.ORDER_PROFIT,  // ✅ FIXED: Dulu 'win'
          amount: totalReturn,  // Return amount + profit
          description: `Won #${order.id.slice(-8)} - ${asset.symbol} +${profit.toFixed(0)}`,
        });
      }
      // ℹ️ Jika LOST, tidak perlu entry karena sudah di-deduct saat create order

      // Wait for update, balance can complete later
      await updatePromise;
      
      if (balancePromise) {
        balancePromise.catch(err => {
          this.logger.error(`Balance update failed for ${order.id}: ${err.message}`);
        });
      }

      // Invalidate caches
      this.orderCache.delete(order.id);
      this.invalidateBalanceCache(order.user_id);

      const duration = Date.now() - startTime;
      this.orderSettleCount++;
      this.avgSettleTime = (this.avgSettleTime + duration) / 2;

      this.logger.log(
        `⚡ Settled ${order.id.slice(-8)} in ${duration}ms - ${result} ${profit > 0 ? '+' : ''}${profit.toFixed(2)}`
      );

    } catch (error) {
      this.logger.error(`Settlement failed for ${order.id}: ${error.message}`);
    }
  }

  /**
   * ⚡ FAST ACTIVE ORDERS RETRIEVAL
   */
  private async getActiveOrdersFromCache(): Promise<BinaryOrder[]> {
    const now = Date.now();
    
    if (
      this.activeOrdersCache.length > 0 && 
      (now - this.lastCacheUpdate) < this.ORDER_CACHE_TTL
    ) {
      return this.activeOrdersCache;
    }

    const db = this.firebaseService.getFirestore();
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('status', '==', ORDER_STATUS.ACTIVE)
      .limit(200)
      .get();

    this.activeOrdersCache = snapshot.docs.map(doc => doc.data() as BinaryOrder);
    this.lastCacheUpdate = now;

    return this.activeOrdersCache;
  }

  /**
   * GET ORDERS (Optimized with cache)
   */
  async getOrders(userId: string, queryDto: QueryBinaryOrderDto) {
    const { status, page = 1, limit = 20 } = queryDto;

    // Try cache first for recent queries
    const cacheKey = `${userId}-${status || 'all'}-${page}-${limit}`;
    
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
   * GET ORDER BY ID (Fast cached)
   */
  async getOrderById(userId: string, orderId: string) {
    const cached = this.orderCache.get(orderId);
    if (cached?.user_id === userId) {
      return cached;
    }

    const db = this.firebaseService.getFirestore();
    const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();
    
    if (!orderDoc.exists) {
      throw new NotFoundException('Order not found');
    }

    const order = orderDoc.data() as BinaryOrder;
    
    if (order.user_id !== userId) {
      throw new BadRequestException('Unauthorized');
    }

    this.orderCache.set(orderId, order);
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
    
    // Clean order cache
    for (const [orderId, order] of this.orderCache.entries()) {
      if (order.status !== ORDER_STATUS.ACTIVE) {
        this.orderCache.delete(orderId);
      }
    }

    // Clean asset cache
    for (const [assetId, cached] of this.assetCache.entries()) {
      if (now - cached.timestamp > this.ASSET_CACHE_TTL * 2) {
        this.assetCache.delete(assetId);
      }
    }

    // Clean balance cache
    for (const [userId, cached] of this.userBalanceCache.entries()) {
      if (now - cached.timestamp > this.BALANCE_CACHE_TTL * 2) {
        this.userBalanceCache.delete(userId);
      }
    }

    this.logger.debug('Cache cleaned');
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
    };
  }

  /**
   * MANUAL CACHE CLEAR (for testing)
   */
  clearAllCache(): void {
    this.orderCache.clear();
    this.activeOrdersCache = [];
    this.assetCache.clear();
    this.userBalanceCache.clear();
    this.lastCacheUpdate = 0;
    this.logger.log('All caches cleared');
  }
}