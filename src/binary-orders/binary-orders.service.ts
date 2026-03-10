// src/binary-orders/binary-orders.service.ts
// ✅ OPTIMIZED: In-memory pendingOrderRegistry menggantikan activeOrdersCache
//   - onModuleInit: hydrate registry sekali dari Firestore
//   - createOrder: register ke memory
//   - settleOrderInstant: unregister dari memory
//   - processExpiredOrders: ZERO Firestore read jika tidak ada order aktif

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { AssetsService } from '../assets/assets.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { UserStatusService } from '../user/user-status.service';
import { TradingGateway } from '../websocket/trading.gateway';
import { AutoLoseSystemService } from '../auto-lose-system/auto-lose-system.service';
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
export class BinaryOrdersService implements OnModuleInit {
  private readonly logger = new Logger(BinaryOrdersService.name);

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ IN-MEMORY PENDING ORDER REGISTRY
  //
  // Menggantikan activeOrdersCache yang masih query Firestore tiap 5s.
  // Registry ini adalah sumber kebenaran untuk order yang sedang AKTIF.
  //
  // Lifecycle:
  //   onModuleInit  → hydrate dari Firestore (sekali saja)
  //   createOrder   → tambah ke registry
  //   settleOrder   → hapus dari registry
  //   processExpiredOrders → pakai registry, ZERO Firestore read
  // ─────────────────────────────────────────────────────────────────────────
  private pendingOrderRegistry: Map<string, BinaryOrder> = new Map();
  private registryHydrated = false;

  // Asset cache (tidak berubah dari sebelumnya)
  private assetCache: Map<string, { asset: Asset; timestamp: number }> = new Map();
  private readonly ASSET_CACHE_TTL = 2000;

  // Order cache untuk getOrderById
  private orderCache: Map<string, BinaryOrder> = new Map();

  private processingLock = false;

  private orderCreateCount   = 0;
  private orderSettleCount   = 0;
  private avgCreateTime      = 0;
  private avgSettleTime      = 0;
  private settlementRunCount = 0;

  private orderRateLimiter: Map<string, number[]> = new Map();
  private readonly MAX_ORDERS_PER_MINUTE = 30;
  private readonly RATE_LIMIT_WINDOW     = 60000;

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
    private assetsService: AssetsService,
    private priceFetcherService: PriceFetcherService,
    private userStatusService: UserStatusService,
    private readonly tradingGateway: TradingGateway,
    private readonly autoLoseService: AutoLoseSystemService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    setInterval(() => this.cleanupStaleCache(), 10000);

    this.logger.log(`🌍 Timezone: Asia/Jakarta (WIB = UTC+7)`);
    this.logger.log(`⏰ Current time: ${TimezoneUtil.formatDateTime()}`);
    this.logger.log(`💡 Status-Based Profit Bonus: Standard +0%, Gold +5%, VIP +10%`);
    this.logger.log(`⚡ 1 Second Trading Support Enabled`);
    this.logger.log(`🔒 Rate Limiter: Max ${this.MAX_ORDERS_PER_MINUTE} orders/minute per user`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ MODULE INIT — hydrate pendingOrderRegistry dari Firestore (sekali saja)
  // ─────────────────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.hydrateRegistry();
  }

  private async hydrateRegistry(): Promise<void> {
    try {
      this.logger.log('🔄 Hydrating pendingOrderRegistry from Firestore...');
      const db = this.firebaseService.getFirestore();

      // Hydrate real orders
      const [realSnap, demoSnap] = await Promise.all([
        db.collection(COLLECTIONS.ORDERS)
          .where('status', '==', ORDER_STATUS.ACTIVE)
          .where('accountType', '==', BALANCE_ACCOUNT_TYPE.REAL)
          .get(),
        db.collection(COLLECTIONS.ORDERS)
          .where('status', '==', ORDER_STATUS.ACTIVE)
          .where('accountType', '==', BALANCE_ACCOUNT_TYPE.DEMO)
          .get(),
      ]);

      this.pendingOrderRegistry.clear();

      realSnap.docs.forEach(doc => {
        const order = doc.data() as BinaryOrder;
        this.pendingOrderRegistry.set(order.id, order);
      });

      demoSnap.docs.forEach(doc => {
        const order = doc.data() as BinaryOrder;
        this.pendingOrderRegistry.set(order.id, order);
      });

      this.registryHydrated = true;
      this.logger.log(
        `✅ pendingOrderRegistry hydrated: ${this.pendingOrderRegistry.size} active orders ` +
        `(Real: ${realSnap.size}, Demo: ${demoSnap.size})`,
      );
    } catch (error) {
      this.logger.error(`❌ Failed to hydrate pendingOrderRegistry: ${error.message}`);
      // Jika hydration gagal, set flag agar tidak di-skip settlement
      this.registryHydrated = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RATE LIMITER
  // ─────────────────────────────────────────────────────────────────────────

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userOrders = this.orderRateLimiter.get(userId) || [];
    const recentOrders = userOrders.filter(ts => now - ts < this.RATE_LIMIT_WINDOW);

    if (recentOrders.length >= this.MAX_ORDERS_PER_MINUTE) {
      this.logger.warn(
        `⚠️ Rate limit exceeded for user ${userId}: ` +
        `${recentOrders.length} orders in last minute`,
      );
      return false;
    }

    recentOrders.push(now);
    this.orderRateLimiter.set(userId, recentOrders);
    return true;
  }

  @Cron('0 */5 * * * *')
  private cleanupRateLimiter() {
    const now = Date.now();
    let cleanedUsers = 0;

    this.orderRateLimiter.forEach((timestamps, userId) => {
      const recentOrders = timestamps.filter(ts => now - ts < this.RATE_LIMIT_WINDOW);
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

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private isValidDuration(duration: number): duration is ValidDuration {
    const tolerance = 0.0001;
    return (ALL_DURATIONS as readonly number[]).some(
      allowed => Math.abs(allowed - duration) < tolerance,
    );
  }

  private getDurationDisplay(durationMinutes: number): string {
    return CalculationUtil.formatDurationDisplay(durationMinutes);
  }

  private async getFastPriceWithRetry(assetId: string, maxRetries = 3): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const asset = await this.getCachedAssetFast(assetId);

        const priceData = await Promise.race([
          this.priceFetcherService.getCurrentPriceRealtime(asset, true),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 2000),
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
          this.logger.warn(
            `⚠️ Price fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(`❌ All ${maxRetries} price fetch attempts failed: ${lastError?.message}`);
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE ORDER
  // ─────────────────────────────────────────────────────────────────────────

  async createOrder(userId: string, createOrderDto: CreateBinaryOrderDto) {
    const startTime = Date.now();
    const { accountType, amount, duration } = createOrderDto;

    try {
      if (!this.checkRateLimit(userId)) {
        throw new BadRequestException({
          message: 'Too many orders. Please wait a moment before placing another order.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: 60,
        });
      }

      if (accountType !== BALANCE_ACCOUNT_TYPE.REAL && accountType !== BALANCE_ACCOUNT_TYPE.DEMO) {
        throw new BadRequestException('Invalid account type. Must be "real" or "demo"');
      }

      if (!this.isValidDuration(duration)) {
        throw new BadRequestException(
          `Invalid duration. Allowed: 1s (0.0167), ${ALL_DURATIONS.filter(d => d >= 1).join(', ')} minutes`,
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
            `Duration not allowed for ${asset.symbol}. Allowed: ${allowedDisplay}`,
          );
        }
      }

      this.logger.log(`📡 Fetching realtime price for ${asset.symbol}...`);
      const priceData = await this.getFastPriceWithRetry(createOrderDto.asset_id, 3);

      if (!priceData || !priceData.price) {
        throw new BadRequestException(
          `Price unavailable for ${asset.symbol}. Please wait a moment and try again.`,
        );
      }

      const now     = TimezoneUtil.getCurrentTimestamp();
      const dataAge = now - (priceData.timestamp || 0);

      if (dataAge > 10) {
        this.logger.warn(`⚠️ Price data is ${dataAge}s old for ${asset.symbol}`);
      }

      this.logger.log(
        `✅ Got realtime price for ${asset.symbol}: ${priceData.price} ` +
        `(${dataAge}s old) at ${new Date().toISOString()}`,
      );

      const userStatus   = await this.userStatusService.getUserStatus(userId);
      const statusBonus  = this.userStatusService.getProfitBonus(userStatus);
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
          `Insufficient ${accountType} balance. Available: Rp ${currentBalance.toLocaleString()}, Required: Rp ${amount.toLocaleString()}`,
        );
      }

      if (currentBalance === 0) {
        throw new BadRequestException('Cannot create order with zero balance. Please deposit first.');
      }

      const orderId = await this.firebaseService.generateId(COLLECTIONS.ORDERS);

      const entryTimestamp  = TimezoneUtil.getCurrentTimestamp();
      const expiryTimestamp = CalculationUtil.calculateExpiryTimestamp(entryTimestamp, duration);

      const remainingSeconds = TimezoneUtil.getRemainingSecondsInMinute(entryTimestamp);
      const isAdjusted       = remainingSeconds <= 20;

      if (isAdjusted) {
        this.logger.warn(
          `⚠️ [END-OF-CANDLE] ${asset.symbol} - ` +
          `Entry: ${TimezoneUtil.formatDateTime()} (${remainingSeconds}s remaining), ` +
          `Expiry: ${TimezoneUtil.formatTimestamp(expiryTimestamp)} (ADJUSTED +1min)`,
        );
      }

      const entryDate  = TimezoneUtil.fromTimestamp(entryTimestamp);
      const expiryDate = TimezoneUtil.fromTimestamp(expiryTimestamp);

      const entryDateTimeInfo  = TimezoneUtil.getDateTimeInfo(entryDate);
      const expiryDateTimeInfo = TimezoneUtil.getDateTimeInfo(expiryDate);

      const orderData: BinaryOrder = {
        id: orderId,
        user_id: userId,
        accountType,
        asset_id:   asset.id,
        asset_name: asset.name,
        direction:  createOrderDto.direction as 'CALL' | 'PUT',
        amount:     createOrderDto.amount,
        duration:   createOrderDto.duration,
        entry_price: priceData.price,
        entry_time:  entryDateTimeInfo.datetime_iso,
        exit_price:  null,
        exit_time:   expiryDateTimeInfo.datetime_iso,
        status:      ORDER_STATUS.ACTIVE,
        profit:      null,
        profitRate:     finalProfitRate,
        baseProfitRate: baseProfitRate,
        statusBonus:    statusBonus,
        userStatus:     userStatus,
        metadata: {
          isEndOfCandleEntry:       isAdjusted,
          remainingSecondsInMinute: remainingSeconds,
          originalDuration:         createOrderDto.duration,
          adjustedDuration:         isAdjusted ? createOrderDto.duration + 1 : createOrderDto.duration,
          timezone:                 'Asia/Jakarta',
        },
        createdAt: entryDateTimeInfo.datetime_iso,
      };

      const db = this.firebaseService.getFirestore();
      await db.collection(COLLECTIONS.ORDERS).doc(orderId).set(orderData);

      this.logger.log(`✅ Order ${orderId} created, debiting balance...`);
      this.logger.log(`📅 Entry: ${entryDateTimeInfo.datetime} WIB (${entryTimestamp})`);
      this.logger.log(`📅 Expiry: ${expiryDateTimeInfo.datetime} WIB (${expiryTimestamp})`);

      try {
        await this.balanceService.createBalanceEntry(
          userId,
          {
            accountType,
            type:        BALANCE_TYPES.ORDER_DEBIT,
            amount:      createOrderDto.amount,
            description: `[${accountType.toUpperCase()}] Order #${orderId.slice(-8)} - ${asset.symbol} ${createOrderDto.direction} (${durationDisplay})`,
          },
          true,
        );
        this.logger.log(`✅ Balance debited successfully`);
      } catch (debitError) {
        this.logger.error(`❌ Balance debit failed, rolling back order: ${debitError.message}`);
        await db.collection(COLLECTIONS.ORDERS).doc(orderId).delete();
        throw new BadRequestException(`Failed to debit balance: ${debitError.message}`);
      }

      this.balanceService.clearUserCache(userId);

      // ✅ Daftarkan ke in-memory registry (menggantikan clearActiveOrdersCache)
      this.pendingOrderRegistry.set(orderId, orderData);
      this.orderCache.set(orderId, orderData);

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
          entry:                   entryDateTimeInfo.datetime,
          expiry:                  expiryDateTimeInfo.datetime,
          entryTimestamp,
          expiryTimestamp,
          durationSeconds:         expiryTimestamp - entryTimestamp,
          timezone:                'Asia/Jakarta (WIB)',
          expiryAdjusted:          isAdjusted,
          originalDuration:        createOrderDto.duration,
          adjustedDuration:        isAdjusted ? createOrderDto.duration + 1 : createOrderDto.duration,
          remainingSecondsInMinute: remainingSeconds,
        },
      });

      this.autoLoseService.registerOrder(
        orderId,
        userId,
        createOrderDto.amount,
        accountType,
        userStatus,
        entryTimestamp,
      );

      if (this.orderCreateCount % 10 === 0) {
        this.logger.log(
          `📊 Order Performance: Created ${this.orderCreateCount} orders, ` +
          `avg time: ${Math.round(this.avgCreateTime)}ms`,
        );
      }

      this.logger.log(
        `⚡ [${accountType.toUpperCase()}] Order created in ${executionTime}ms - ` +
        `${asset.symbol} ${createOrderDto.direction} ${durationDisplay} (Profit: ${finalProfitRate}%)`,
      );

      return {
        message: `${accountType} order created successfully`,
        order: orderData,
        accountType,
        balanceAfter: newBalance,
        executionTime,
        durationDisplay,
        statusInfo: { userStatus, baseProfitRate, statusBonus, finalProfitRate },
        timing: {
          entry:                   entryDateTimeInfo.datetime,
          expiry:                  expiryDateTimeInfo.datetime,
          entryTimestamp,
          expiryTimestamp,
          durationSeconds:         expiryTimestamp - entryTimestamp,
          timezone:                'Asia/Jakarta (WIB)',
          expiryAdjusted:          isAdjusted,
          originalDuration:        createOrderDto.duration,
          adjustedDuration:        isAdjusted ? createOrderDto.duration + 1 : createOrderDto.duration,
          remainingSecondsInMinute: remainingSeconds,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Order creation failed after ${duration}ms: ${error.message}`);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ SETTLEMENT CRON — ZERO Firestore read ketika tidak ada order aktif
  // ─────────────────────────────────────────────────────────────────────────

  @Cron('*/1 * * * * *')
  async processExpiredOrders() {
    if (this.processingLock) return;

    // ✅ Fast path: jika registry kosong, skip semua — ZERO Firestore read
    if (this.pendingOrderRegistry.size === 0) {
      this.settlementRunCount++;
      if (this.settlementRunCount % 60 === 0) {
        this.logger.debug(
          `⏰ Settlement check #${this.settlementRunCount}: Registry empty, no orders to settle`,
        );
      }
      return;
    }

    // ✅ Jika registry belum berhasil di-hydrate (startup error), coba sekali lagi
    if (!this.registryHydrated) {
      this.logger.warn('⚠️ Registry not hydrated yet, retrying...');
      await this.hydrateRegistry();
      return;
    }

    this.processingLock = true;
    this.settlementRunCount++;
    const startTime = Date.now();

    try {
      const currentTimestamp = TimezoneUtil.getCurrentTimestamp();
      const currentDateTime  = TimezoneUtil.formatDateTime();

      // ✅ Ambil semua order dari in-memory registry — ZERO Firestore read
      const allOrders = Array.from(this.pendingOrderRegistry.values());

      // Filter berdasarkan accountType dan expiry
      const expiredRealOrders = allOrders.filter(order => {
        if (order.accountType !== BALANCE_ACCOUNT_TYPE.REAL) return false;
        const exitTimestamp = TimezoneUtil.toTimestamp(new Date(order.exit_time!));
        return currentTimestamp >= exitTimestamp;
      });

      const expiredDemoOrders = allOrders.filter(order => {
        if (order.accountType !== BALANCE_ACCOUNT_TYPE.DEMO) return false;
        const exitTimestamp = TimezoneUtil.toTimestamp(new Date(order.exit_time!));
        return currentTimestamp >= exitTimestamp;
      });

      const totalExpired = expiredRealOrders.length + expiredDemoOrders.length;

      if (totalExpired === 0) {
        if (this.settlementRunCount % 60 === 0) {
          this.logger.debug(
            `⏰ Settlement check #${this.settlementRunCount}: No expired orders ` +
            `(${allOrders.length} active in registry)`,
          );
        }
        return;
      }

      this.logger.log(
        `⚡ [${currentDateTime} WIB] Processing ${totalExpired} expired orders ` +
        `(Real: ${expiredRealOrders.length}, Demo: ${expiredDemoOrders.length})`,
      );

      const PARALLEL_LIMIT = 20;
      await Promise.all([
        this.settleBatch(expiredRealOrders, PARALLEL_LIMIT),
        this.settleBatch(expiredDemoOrders, PARALLEL_LIMIT),
      ]);

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
      let attempts       = 0;
      const maxAttempts  = 3;

      while (attempts < maxAttempts && !priceData?.price) {
        try {
          priceData = await Promise.race([
            this.priceFetcherService.getCurrentPrice(asset, false),
            new Promise<any>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 2000),
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
        this.logger.warn(
          `⚠️ No price for order ${order.id} after ${maxAttempts} attempts, retrying next cycle`,
        );
        return;
      }

      // ── AutoLoseSystem ────────────────────────────────────────────────────
      const autoLoseCheck = await this.autoLoseService.shouldForceLose(order);

      let exitPrice: number;
      let result: 'WON' | 'LOST';

      if (autoLoseCheck.shouldForceLose) {
        exitPrice = this.autoLoseService.calculateForcedLosePrice(
          order.direction,
          order.entry_price,
        );
        result = 'LOST';

        this.logger.warn(
          `💀 [AutoLose][${order.accountType.toUpperCase()}] ` +
          `Force LOSE order ${order.id.slice(-8)} ` +
          `(${order.direction} | amount: ${order.amount} | status: ${order.userStatus || 'standard'}) ` +
          `| Reason: ${autoLoseCheck.reason} ` +
          `| Price: ${priceData.price} → Manipulated: ${exitPrice.toFixed(6)}`,
        );

        this.autoLoseService
          .logForcedLose(order, autoLoseCheck.reason!, exitPrice)
          .catch(err =>
            this.logger.warn(`⚠️ AutoLose log failed (non-critical): ${err.message}`),
          );
      } else {
        exitPrice = priceData.price;
        result    = CalculationUtil.determineBinaryResult(
          order.direction,
          order.entry_price,
          exitPrice,
        );
      }
      // ─────────────────────────────────────────────────────────────────────

      const profit = result === 'WON'
        ? CalculationUtil.calculateBinaryProfit(order.amount, order.profitRate)
        : -order.amount;

      const db               = this.firebaseService.getFirestore();
      const settlementDateTime = TimezoneUtil.formatDateTime();
      const durationDisplay    = this.getDurationDisplay(order.duration);

      await db.collection(COLLECTIONS.ORDERS).doc(order.id).update({
        exit_price:  exitPrice,
        status:      result,
        profit,
        settled_at:  TimezoneUtil.toISOString(),
      });

      if (result === 'WON') {
        const totalReturn = order.amount + profit;
        await this.balanceService.createBalanceEntry(
          order.user_id,
          {
            accountType: order.accountType,
            type:        BALANCE_TYPES.ORDER_PROFIT,
            amount:      totalReturn,
            description: `[${order.accountType.toUpperCase()}] Won #${order.id.slice(-8)} - ${asset.symbol} +${profit.toFixed(0)} (${order.userStatus?.toUpperCase() || 'STANDARD'} bonus, ${durationDisplay})`,
          },
          true,
        );
      }

      if (result === 'LOST' && order.accountType === BALANCE_ACCOUNT_TYPE.REAL) {
        this.eventEmitter.emit('affiliate.order.lost', {
          ...order,
          profit,
          status: result,
        } as BinaryOrder);
        this.logger.debug(`📡 Emitted affiliate.order.lost for order ${order.id}`);
      }

      // ✅ Hapus dari registry setelah settled
      this.pendingOrderRegistry.delete(order.id);
      this.orderCache.delete(order.id);

      this.tradingGateway.emitOrderSettled(order.user_id, {
        id:          order.id,
        status:      result,
        exit_price:  exitPrice,
        profit,
        profitRate:  order.profitRate,
        asset_symbol: order.asset_name,
        duration:    order.duration,
        settled_at:  settlementDateTime,
      });

      const duration = Date.now() - startTime;
      this.orderSettleCount++;
      this.avgSettleTime = (this.avgSettleTime * 0.9) + (duration * 0.1);

      this.logger.log(
        `⚡ [${settlementDateTime} WIB] [${order.accountType.toUpperCase()}] ` +
        `Settled ${order.id.slice(-8)} in ${duration}ms - ${durationDisplay} ${result} ` +
        `${profit > 0 ? '+' : ''}${profit.toFixed(2)} (${order.profitRate}%)` +
        `${autoLoseCheck.shouldForceLose ? ' [AUTOLOST💀]' : ''}`,
      );
    } catch (error) {
      this.logger.error(`Settlement failed for ${order.id}: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QUERY METHODS
  // ─────────────────────────────────────────────────────────────────────────

  async getOrders(userId: string, queryDto: QueryBinaryOrderDto) {
    const startTime = Date.now();

    try {
      const { status, page = 1, limit = 20, accountType } = queryDto;

      const statusArray: string[] | undefined = status
        ? Array.isArray(status) ? status : [status]
        : undefined;

      const db = this.firebaseService.getFirestore();

      try {
        let query = db.collection(COLLECTIONS.ORDERS).where('user_id', '==', userId);

        if (accountType && (accountType === 'real' || accountType === 'demo')) {
          query = query.where('accountType', '==', accountType) as any;
        }

        if (statusArray && statusArray.length > 0) {
          if (statusArray.length === 1) {
            query = query.where('status', '==', statusArray[0]) as any;
          } else {
            query = query.where('status', 'in', statusArray.slice(0, 10)) as any;
          }
        }

        const snapshot = await query
          .orderBy('createdAt', 'desc')
          .limit(limit * page)
          .get();

        const allOrders = snapshot.docs.map(doc => {
          const order = doc.data() as BinaryOrder;
          return { ...order, durationDisplay: this.getDurationDisplay(order.duration) };
        });

        const total      = allOrders.length;
        const startIndex = (page - 1) * limit;
        const orders     = allOrders.slice(startIndex, startIndex + limit);

        const duration = Date.now() - startTime;
        this.logger.debug(`✅ Got ${orders.length} orders in ${duration}ms`);

        return {
          orders,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          filter: { accountType: accountType || 'all', status: statusArray ? statusArray.join(',') : 'all' },
          currentTime: TimezoneUtil.formatDateTime(),
          timezone:    'Asia/Jakarta (WIB)',
        };
      } catch (indexError) {
        this.logger.warn(`⚠️ Index error, using fallback query: ${indexError.message}`);

        const snapshot = await db.collection(COLLECTIONS.ORDERS)
          .where('user_id', '==', userId)
          .get();

        let allOrders = snapshot.docs.map(doc => {
          const order = doc.data() as BinaryOrder;
          return { ...order, durationDisplay: this.getDurationDisplay(order.duration) };
        });

        if (accountType && (accountType === 'real' || accountType === 'demo')) {
          allOrders = allOrders.filter(o => o.accountType === accountType);
        }
        if (statusArray && statusArray.length > 0) {
          allOrders = allOrders.filter(o => statusArray.includes(o.status));
        }

        allOrders.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        const total      = allOrders.length;
        const startIndex = (page - 1) * limit;
        const orders     = allOrders.slice(startIndex, startIndex + limit);

        return {
          orders,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          filter: { accountType: accountType || 'all', status: statusArray ? statusArray.join(',') : 'all' },
          currentTime:  TimezoneUtil.formatDateTime(),
          timezone:     'Asia/Jakarta (WIB)',
          usingFallback: true,
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Get orders failed after ${duration}ms: ${error.message}`);
      return {
        orders: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        filter: { accountType: 'all', status: 'all' },
        currentTime: TimezoneUtil.formatDateTime(),
        timezone:    'Asia/Jakarta (WIB)',
        error:       error.message,
      };
    }
  }

  async getOrderById(userId: string, orderId: string) {
    const db       = this.firebaseService.getFirestore();
    const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();

    if (!orderDoc.exists) throw new NotFoundException('Order not found');

    const order = orderDoc.data() as BinaryOrder;
    if (order.user_id !== userId) throw new BadRequestException('Unauthorized');

    const expiryTimestamp = TimezoneUtil.toTimestamp(new Date(order.exit_time!));
    const expiryInfo      = CalculationUtil.formatExpiryInfo(expiryTimestamp);

    return {
      ...order,
      durationDisplay: this.getDurationDisplay(order.duration),
      expiryInfo,
      currentTime: TimezoneUtil.formatDateTime(),
      timezone:    'Asia/Jakarta (WIB)',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ASSET CACHE
  // ─────────────────────────────────────────────────────────────────────────

  private async getCachedAssetFast(assetId: string): Promise<Asset> {
    const cached = this.assetCache.get(assetId);
    const now    = Date.now();

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

    // ✅ Bersihkan entry di registry yang sudah tidak ACTIVE (safety net)
    for (const [orderId, order] of this.pendingOrderRegistry.entries()) {
      if (order.status !== ORDER_STATUS.ACTIVE) {
        this.pendingOrderRegistry.delete(orderId);
        this.logger.debug(`🧹 Removed stale order ${orderId.slice(-8)} from registry`);
      }
    }
  }

  clearAllCache(): void {
    this.orderCache.clear();
    this.assetCache.clear();
    this.logger.debug('⚡ All caches cleared');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ REGISTER EXTERNAL ORDER
  //
  // Dipanggil oleh OrderScheduleExecutorService setelah membuat order langsung
  // ke Firestore (tanpa melewati createOrder()).
  // Tanpa ini, order schedule tidak akan pernah di-settle oleh processExpiredOrders.
  // ─────────────────────────────────────────────────────────────────────────
  registerExternalOrder(order: BinaryOrder): void {
    this.pendingOrderRegistry.set(order.id, order);
    this.logger.debug(
      `📋 Registered external order ${order.id.slice(-8)} ` +
      `[${order.accountType.toUpperCase()}] into pendingOrderRegistry ` +
      `(registry size: ${this.pendingOrderRegistry.size})`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ RECONCILIATION CRON — Safety net setiap 5 menit
  //
  // Menjamin tidak ada order ACTIVE yang terlewat di registry.
  // Menangani edge case:
  //   - Server restart saat ada order aktif (sudah di-handle onModuleInit)
  //   - registerExternalOrder gagal/belum dipanggil
  //   - Order dibuat oleh service lain tanpa lewat BinaryOrdersService
  // ─────────────────────────────────────────────────────────────────────────
  @Cron('0 */5 * * * *')
  private async reconcileRegistry(): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();

      const [realSnap, demoSnap] = await Promise.all([
        db.collection(COLLECTIONS.ORDERS)
          .where('status', '==', ORDER_STATUS.ACTIVE)
          .where('accountType', '==', BALANCE_ACCOUNT_TYPE.REAL)
          .get(),
        db.collection(COLLECTIONS.ORDERS)
          .where('status', '==', ORDER_STATUS.ACTIVE)
          .where('accountType', '==', BALANCE_ACCOUNT_TYPE.DEMO)
          .get(),
      ]);

      let added = 0;

      [...realSnap.docs, ...demoSnap.docs].forEach(doc => {
        const order = doc.data() as BinaryOrder;
        if (!this.pendingOrderRegistry.has(order.id)) {
          this.pendingOrderRegistry.set(order.id, order);
          added++;
        }
      });

      if (added > 0) {
        this.logger.warn(
          `🔄 Registry reconciliation: added ${added} missed active orders ` +
          `(total registry: ${this.pendingOrderRegistry.size})`,
        );
      } else {
        this.logger.debug(
          `✅ Registry reconciliation OK — no missed orders ` +
          `(registry: ${this.pendingOrderRegistry.size})`,
        );
      }
    } catch (error) {
      this.logger.error(`❌ Registry reconciliation failed: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────────────────

  getRateLimitStats() {
    const now = Date.now();
    let totalOrders  = 0;
    let activeUsers  = 0;

    this.orderRateLimiter.forEach(timestamps => {
      const recentOrders = timestamps.filter(ts => now - ts < this.RATE_LIMIT_WINDOW);
      if (recentOrders.length > 0) {
        activeUsers++;
        totalOrders += recentOrders.length;
      }
    });

    return {
      totalUsers:           this.orderRateLimiter.size,
      activeUsers,
      averageOrdersPerUser: activeUsers > 0 ? totalOrders / activeUsers : 0,
    };
  }

  getPerformanceStats() {
    const rateLimitStats = this.getRateLimitStats();

    return {
      ordersCreated:    this.orderCreateCount,
      ordersSettled:    this.orderSettleCount,
      settlementRuns:   this.settlementRunCount,
      avgCreateTime:    Math.round(this.avgCreateTime),
      avgSettleTime:    Math.round(this.avgSettleTime),
      registryHydrated: this.registryHydrated,
      cacheSize: {
        pendingOrders:     this.pendingOrderRegistry.size,
        realActiveOrders:  Array.from(this.pendingOrderRegistry.values()).filter(o => o.accountType === 'real').length,
        demoActiveOrders:  Array.from(this.pendingOrderRegistry.values()).filter(o => o.accountType === 'demo').length,
        assets:            this.assetCache.size,
      },
      rateLimiter: rateLimitStats,
      performance: {
        createTimeTarget:  300,
        settleTimeTarget:  200,
        createTimeStatus:  this.avgCreateTime < 300 ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
        settleTimeStatus:  this.avgSettleTime < 200 ? 'EXCELLENT' : 'NEEDS_IMPROVEMENT',
      },
      optimization: {
        settlementInterval:   '1 second',
        estimatedDailyChecks: 86400,
        pendingOrderRegistry: 'in-memory — ZERO Firestore reads when empty',
        savingsVsOld:         '~99% fewer Firestore reads on settlement cron',
        oneSecondSupport:     true,
        rateLimitEnabled:     true,
        maxOrdersPerMinute:   this.MAX_ORDERS_PER_MINUTE,
      },
      timezone: {
        name:    'Asia/Jakarta',
        offset:  'UTC+7',
        current: TimezoneUtil.formatDateTime(),
      },
    };
  }
}