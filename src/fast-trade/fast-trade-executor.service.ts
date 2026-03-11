// src/fast-trade/fast-trade-executor.service.ts
//
// ╔══════════════════════════════════════════════════════════════╗
// ║  FIXES                                                       ║
// ║  #1  registerExternalOrder() dipanggil setelah order dibuat  ║
// ║      → order masuk pendingOrderRegistry                      ║
// ║      → processExpiredOrders (tiap 1 detik) langsung settle   ║
// ║      SEBELUMNYA: tidak dipanggil → nyangkut sampai 5 menit   ║
// ║                                                              ║
// ║  #2  Expiry = entryTimestamp + tfSeconds (langsung)          ║
// ║      SEBELUMNYA: pakai calculateExpiryTimestamp() yang       ║
// ║      menambah +1 menit ekstra jika entry di detik > 20       ║
// ║      → order 1m bisa jadi 2m, 5m jadi 6m, dst               ║
// ║                                                              ║
// ║  #3  Cron tick diubah dari */2 ke * (tiap 1 detik)           ║
// ║      → delay eksekusi dari ±2s menjadi ±1s                   ║
// ╚══════════════════════════════════════════════════════════════╝

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';
import { FastTradeService } from './fast-trade.service';
import { BalanceService } from '../balance/balance.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { UserStatusService } from '../user/user-status.service';
import { TradingGateway } from '../websocket/trading.gateway';
import { BinaryOrdersService } from '../binary-orders/binary-orders.service'; // ✅ FIX #1
import {
  COLLECTIONS,
  ORDER_STATUS,
  BALANCE_TYPES,
} from '../common/constants';
import { TimezoneUtil } from '../common/utils';
import {
  FastTradeSession,
  FastTradeExecution,
  CandleDirection,
} from './interfaces/fast-trade.interface';
import {
  TIMEFRAME_SECONDS_MAP,
  TIMEFRAME_DURATION_MAP,
} from './dto/create-fast-trade.dto';
import { BinaryOrder } from '../common/interfaces';

type SessionLockSet = Set<string>;

@Injectable()
export class FastTradeExecutorService {
  private readonly logger = new Logger(FastTradeExecutorService.name);

  private processingLock: SessionLockSet = new Set();
  private pollingLock:    SessionLockSet = new Set();

  private totalCycles       = 0;
  private totalOrdersPlaced = 0;
  private totalWins         = 0;
  private totalLosses       = 0;

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly fastTradeService: FastTradeService,
    private readonly balanceService: BalanceService,
    private readonly priceFetcherService: PriceFetcherService,
    private readonly userStatusService: UserStatusService,
    private readonly tradingGateway: TradingGateway,
    private readonly binaryOrdersService: BinaryOrdersService, // ✅ FIX #1
  ) {
    this.logger.log('✅ FastTradeExecutorService initialized');
    this.logger.log('⚡ Tick engine: every 1 second');
    this.logger.log('🔄 Result poller: every 1 second');
    this.logger.log('🔒 Settlement: via pendingOrderRegistry (instant)');
  }

  private get db() { return this.firebaseService.getFirestore(); }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 1 — Main tick: every 1 second
  // ✅ FIX #3: was */2, now * → delay ±1s instead of ±2s
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('* * * * * *')
  async handleCandleTick(): Promise<void> {
    this.totalCycles++;

    const sessions = this.fastTradeService.getAllActiveSessions();
    if (sessions.length === 0) return;

    const nowSec = TimezoneUtil.getCurrentTimestamp();

    await Promise.allSettled(
      sessions.map(session => this.processTick(session, nowSec)),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 2 — Result poller: every 1 second
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('* * * * * *')
  async checkPendingResults(): Promise<void> {
    let pending: FastTradeExecution[];
    try {
      pending = await this.fastTradeService.getPendingExecutions();
    } catch (error) {
      this.logger.error(`❌ Failed to fetch pending executions: ${error.message}`);
      return;
    }

    if (pending.length === 0) return;

    this.logger.debug(`🔍 Checking ${pending.length} pending FastTrade executions`);
    await Promise.allSettled(pending.map(exec => this.resolveExecution(exec)));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 3 — Daily cleanup
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('0 3 * * *')
  async cleanupOldData(): Promise<void> {
    try {
      const count = await this.fastTradeService.cleanupOldExecutions();
      this.logger.log(`🧹 Cleaned up ${count} old FastTrade executions`);
    } catch (error) {
      this.logger.error(`❌ Cleanup error: ${error.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE: Process one session tick
  // ══════════════════════════════════════════════════════════════════════════

  private async processTick(session: FastTradeSession, nowSec: number): Promise<void> {
    if (this.processingLock.has(session.id)) return;
    if (session.status === 'waiting_result') return;

    const tfSeconds        = TIMEFRAME_SECONDS_MAP[session.timeframe];
    const distanceToCandle = session.nextCandleAt - nowSec;
    if (distanceToCandle > 0) return;

    this.processingLock.add(session.id);

    try {
      this.logger.log(
        `🕐 [${session.id.slice(-8)}] Candle boundary | ` +
        `${session.assetSymbol} ${session.timeframe} | ` +
        `Step: ${session.currentStep} | Rp ${session.currentAmount.toLocaleString('id-ID')}`,
      );

      // Phase 1: read candle direction
      await this.fastTradeService.markReadingCandle(session.id);

      const expectedCandleTs = session.nextCandleAt - tfSeconds;
      const { direction, candle } = await this.fastTradeService.getCandleDirection(
        session.assetId,
        session.timeframe,
        expectedCandleTs,
      );

      this.logger.log(
        `📊 [${session.id.slice(-8)}] Candle: ${direction.toUpperCase()} | ` +
        `t=${candle?.t} O=${candle?.o} C=${candle?.c}`,
      );

      if (direction === 'neutral') {
        this.logger.warn(`⚠️ [${session.id.slice(-8)}] Neutral candle — skipping cycle`);
        const nextCandleAt = this.fastTradeService.calcNextCandleBoundary(tfSeconds);
        await this.fastTradeService.markWaiting(session.id, nextCandleAt);
        await this.fastTradeService.saveExecution({
          sessionId: session.id, userId: session.userId,
          candleTimestamp: candle?.t ?? nowSec, candleDirection: direction,
          timeframe: session.timeframe, direction: 'CALL',
          amount: session.currentAmount, martingaleStep: session.currentStep,
          accountType: session.accountType, assetSymbol: session.assetSymbol,
          assetId: session.assetId, duration: TIMEFRAME_DURATION_MAP[session.timeframe],
          status: 'skipped', profit: 0, placedAt: this.now(),
        });
        return;
      }

      // Phase 2: place order
      await this.fastTradeService.markPlacingOrder(session.id);

      const binaryDirection: 'CALL' | 'PUT' = direction === 'bullish' ? 'CALL' : 'PUT';

      const { orderId, entryPrice, executionId, error } = await this.placeBinaryOrder(
        session, binaryDirection, candle?.t ?? nowSec, direction,
      );

      if (error || !orderId) {
        this.logger.error(`❌ [${session.id.slice(-8)}] Order placement failed: ${error}`);
        const nextCandleAt = this.fastTradeService.calcNextCandleBoundary(tfSeconds);
        await this.fastTradeService.markWaiting(session.id, nextCandleAt);
        return;
      }

      // Phase 3: mark waiting result
      await this.fastTradeService.markWaitingResult(session.id, orderId, executionId!, binaryDirection);
      this.totalOrdersPlaced++;

      this.logger.log(
        `✅ [${session.id.slice(-8)}] Order placed: ${orderId.slice(-8)} | ` +
        `${binaryDirection} @ ${entryPrice} | Rp ${session.currentAmount.toLocaleString('id-ID')} | ` +
        `Step: ${session.currentStep}`,
      );

      this.emitSessionUpdate(session);

    } catch (error) {
      this.logger.error(
        `❌ [${session.id.slice(-8)}] processTick error: ${error.message}`,
        error.stack,
      );
      try {
        const tfSeconds    = TIMEFRAME_SECONDS_MAP[session.timeframe];
        const nextCandleAt = this.fastTradeService.calcNextCandleBoundary(tfSeconds);
        await this.fastTradeService.markWaiting(session.id, nextCandleAt);
      } catch {}
    } finally {
      this.processingLock.delete(session.id);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE: Place binary order
  // ══════════════════════════════════════════════════════════════════════════

  private async placeBinaryOrder(
    session: FastTradeSession,
    direction: 'CALL' | 'PUT',
    candleTimestamp: number,
    candleDirection: CandleDirection,
  ): Promise<{ orderId?: string; entryPrice?: number; executionId?: string; error?: string }> {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const amount      = session.currentAmount;
        const accountType = session.accountType as 'real' | 'demo';
        const tfSeconds   = TIMEFRAME_SECONDS_MAP[session.timeframe];
        const duration    = TIMEFRAME_DURATION_MAP[session.timeframe]; // minutes

        // 1. Check balance
        const currentBalance = await this.balanceService.getCurrentBalanceStrict(
          session.userId, accountType,
        );
        if (currentBalance < amount) {
          const msg =
            `Saldo ${accountType} tidak cukup. ` +
            `Tersedia: Rp ${currentBalance.toLocaleString('id-ID')}, ` +
            `Dibutuhkan: Rp ${amount.toLocaleString('id-ID')}`;
          this.logger.warn(`⚠️ [${session.id.slice(-8)}] ${msg}`);
          const exec = await this.fastTradeService.saveExecution({
            sessionId: session.id, userId: session.userId, candleTimestamp, candleDirection,
            timeframe: session.timeframe, direction, amount, martingaleStep: session.currentStep,
            accountType: session.accountType, assetSymbol: session.assetSymbol,
            assetId: session.assetId, duration, status: 'error', profit: 0,
            errorMessage: msg, placedAt: this.now(),
          });
          await this.fastTradeService.forceStopSession(session.id, msg);
          return { executionId: exec.id, error: msg };
        }

        // 2. Get asset
        const assetDoc = await this.db.collection(COLLECTIONS.ASSETS).doc(session.assetId).get();
        if (!assetDoc.exists) throw new Error(`Asset ${session.assetId} not found`);
        const asset = assetDoc.data() as any;

        // 3. Get realtime price
        let entryPrice = 0;
        try {
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(asset, true);
          if (priceData?.price) entryPrice = priceData.price;
        } catch (priceErr) {
          this.logger.warn(`⚠️ Price fallback: ${priceErr.message}`);
          entryPrice = asset.simulatorSettings?.currentPrice
            ?? asset.simulatorSettings?.initialPrice ?? 0;
        }
        if (!entryPrice) throw new Error(`Cannot get entry price for ${asset.symbol}`);

        // 4. User status & profit rate
        const userStatus  = await this.userStatusService.getUserStatus(session.userId);
        const statusBonus = this.userStatusService.getProfitBonus(userStatus);
        const profitRate  = (asset.profitRate ?? 85) + statusBonus;

        // 5. ✅ FIX #2: Expiry = entryTimestamp + tfSeconds (DIRECT — no extra +1min)
        //    calculateExpiryTimestamp() menambah +1 menit jika entry di detik > 20,
        //    yang menyebabkan order 1m menjadi 2m, 5m menjadi 6m, dst.
        const entryTimestamp  = TimezoneUtil.getCurrentTimestamp();
        const expiryTimestamp = entryTimestamp + tfSeconds;  // ← FIX: langsung tambah detik
        const entryDate       = TimezoneUtil.fromTimestamp(entryTimestamp);
        const expiryDate      = TimezoneUtil.fromTimestamp(expiryTimestamp);
        const entryInfo       = TimezoneUtil.getDateTimeInfo(entryDate);
        const expiryInfo      = TimezoneUtil.getDateTimeInfo(expiryDate);

        this.logger.log(
          `⏱️ [${session.id.slice(-8)}] Entry: ${entryInfo.datetime} | ` +
          `Expiry: ${expiryInfo.datetime} (${tfSeconds}s from now)`,
        );

        // 6. Create order in Firestore
        const orderId = await this.firebaseService.generateId(COLLECTIONS.ORDERS);

        const orderData: any = {
          id:             orderId,
          user_id:        session.userId,
          accountType,
          asset_id:       session.assetId,
          asset_name:     asset.name,
          asset_symbol:   asset.symbol,
          direction,
          amount,
          duration,
          entry_price:    entryPrice,
          entry_time:     entryInfo.datetime_iso,
          exit_price:     null,
          exit_time:      expiryInfo.datetime_iso,
          status:         ORDER_STATUS.ACTIVE,
          profit:         null,
          profitRate,
          baseProfitRate: asset.profitRate ?? 85,
          statusBonus,
          userStatus,
          metadata: {
            isFastTrade:        true,
            fastTradeSessionId: session.id,
            candleTimestamp,
            candleDirection,
            timeframe:          session.timeframe,
            martingaleStep:     session.currentStep,
            timezone:           'Asia/Jakarta',
          },
          createdAt: entryInfo.datetime_iso,
        };

        await this.db.collection(COLLECTIONS.ORDERS).doc(orderId).set(orderData);

        // ✅ FIX #1: Register ke pendingOrderRegistry agar processExpiredOrders
        //    (jalan tiap 1 detik) bisa settle order ini tepat waktu.
        //    TANPA ini, order tidak terdeteksi sampai reconciliation (tiap 5 menit).
        this.binaryOrdersService.registerExternalOrder(orderData as BinaryOrder);

        // 7. Debit balance
        try {
          await this.balanceService.createBalanceEntry(
            session.userId,
            {
              accountType,
              type:        BALANCE_TYPES.ORDER_DEBIT,
              amount,
              description: `[FastTrade] ${session.assetSymbol} ${direction} ${session.timeframe} ` +
                           `#${orderId.slice(-8)} Step:${session.currentStep}`,
            },
            true,
          );
        } catch (debitErr) {
          this.logger.error(`❌ [${session.id.slice(-8)}] Debit failed, rolling back: ${debitErr.message}`);
          await this.db.collection(COLLECTIONS.ORDERS).doc(orderId).delete();
          // registry akan di-clean oleh reconciliation jika rollback
          throw new Error(`Balance debit failed: ${debitErr.message}`);
        }

        this.balanceService.clearUserCache(session.userId);

        // 8. Save execution log
        const exec = await this.fastTradeService.saveExecution({
          sessionId: session.id, userId: session.userId,
          candleTimestamp, candleDirection, timeframe: session.timeframe,
          orderId, direction, amount, martingaleStep: session.currentStep,
          accountType: session.accountType, assetSymbol: session.assetSymbol,
          assetId: session.assetId, duration, status: 'placed',
          profit: 0, entryPrice, placedAt: this.now(),
        });

        return { orderId, entryPrice, executionId: exec.id };

      } catch (error) {
        const isLast = attempt === maxRetries - 1;
        this.logger.error(
          `❌ [${session.id.slice(-8)}] placeBinaryOrder attempt ${attempt + 1}/${maxRetries}: ${error.message}`,
        );
        if (!isLast) {
          await this.sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        try {
          const exec = await this.fastTradeService.saveExecution({
            sessionId: session.id, userId: session.userId,
            candleTimestamp, candleDirection, timeframe: session.timeframe,
            direction, amount: session.currentAmount, martingaleStep: session.currentStep,
            accountType: session.accountType, assetSymbol: session.assetSymbol,
            assetId: session.assetId, duration: TIMEFRAME_DURATION_MAP[session.timeframe],
            status: 'error', profit: 0, errorMessage: error.message, placedAt: this.now(),
          });
          return { executionId: exec.id, error: error.message };
        } catch {}
        return { error: error.message };
      }
    }
    return { error: 'All retries exhausted' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE: Resolve pending execution (baca hasil dari Firestore)
  // Note: Actual settlement (status update + balance credit) dilakukan oleh
  //       processExpiredOrders di BinaryOrdersService. Fungsi ini hanya
  //       membaca hasilnya dan mengupdate session state + martingale.
  // ══════════════════════════════════════════════════════════════════════════

  private async resolveExecution(exec: FastTradeExecution): Promise<void> {
    if (!exec.orderId) return;
    if (this.pollingLock.has(exec.id)) return;

    this.pollingLock.add(exec.id);

    try {
      const orderDoc = await this.db.collection(COLLECTIONS.ORDERS).doc(exec.orderId).get();

      if (!orderDoc.exists) {
        await this.fastTradeService.updateExecution(exec.id, {
          status: 'error', errorMessage: 'Binary order not found',
        });
        await this.rescheduleSession(exec.sessionId);
        return;
      }

      const order = orderDoc.data() as any;

      // Masih ACTIVE → tunggu processExpiredOrders yang settle
      if (order.status === ORDER_STATUS.ACTIVE) {
        const expiryTs  = TimezoneUtil.toTimestamp(new Date(order.exit_time));
        const remaining = expiryTs - TimezoneUtil.getCurrentTimestamp();
        this.logger.debug(
          `⏳ [${exec.sessionId.slice(-8)}] Order ${exec.orderId.slice(-8)} ACTIVE (${remaining}s)`,
        );
        return;
      }

      // Sudah settled oleh processExpiredOrders
      const result: 'won' | 'lost' = order.status === ORDER_STATUS.WON ? 'won' : 'lost';
      const profitRate  = order.profitRate ?? 85;
      const finalAmount = result === 'won'
        ? Math.round(exec.amount * (profitRate / 100))
        : exec.amount;

      const settledAt = this.now();
      await this.fastTradeService.updateExecution(exec.id, {
        status: result, profit: result === 'won' ? finalAmount : -exec.amount,
        exitPrice: order.exit_price ?? undefined, settledAt,
      });

      // Balance credit sudah dilakukan oleh settleOrderInstant di BinaryOrdersService.
      // TIDAK perlu credit ulang di sini untuk menghindari double credit.
      // Note: BinaryOrdersService.settleOrderInstant sudah:
      //   - Update order status ke WON/LOST
      //   - Credit balance jika WON (amount + profit)
      //   - Emit WebSocket orderSettled

      // Update session state & martingale
      const session = await this.fastTradeService.getSessionById(exec.sessionId);
      if (!session.isActive) {
        this.logger.warn(`⚠️ [${exec.sessionId.slice(-8)}] Session already stopped`);
        return;
      }

      const tfSeconds = TIMEFRAME_SECONDS_MAP[session.timeframe];
      const { shouldStop, stopReason, session: updated, isMartingaleRetry, retryDirection } =
        await this.fastTradeService.applyOrderResult(
          exec.sessionId, result, finalAmount, exec.candleTimestamp, tfSeconds,
        );

      if (result === 'won') this.totalWins++;
      else                   this.totalLosses++;

      this.logger.log(
        `${result === 'won' ? '✅ WIN' : '❌ LOSS'} [${exec.sessionId.slice(-8)}] ` +
        `${exec.assetSymbol} ${exec.direction} | ` +
        `Rp ${exec.amount.toLocaleString('id-ID')} | ` +
        `${result === 'won' ? '+' : '-'}${result === 'won' ? finalAmount : exec.amount} | ` +
        `Step: ${exec.martingaleStep} | TotalPnL: ${updated.totalPnL.toLocaleString('id-ID')}`,
      );

      this.emitOrderSettled(exec.userId, exec.orderId!, result, finalAmount);
      this.emitSessionUpdate(updated);

      if (shouldStop) {
        this.logger.log(`🏁 [${exec.sessionId.slice(-8)}] Session completed: ${stopReason}`);
        return;
      }

      // Martingale retry: pasang order langsung tanpa tunggu candle baru
      if (isMartingaleRetry && retryDirection) {
        this.logger.log(
          `🔄 [${exec.sessionId.slice(-8)}] Martingale retry step ${updated.currentStep} | ` +
          `${retryDirection} | Rp ${updated.currentAmount.toLocaleString('id-ID')}`,
        );
        try {
          await this.fastTradeService.markPlacingOrder(exec.sessionId);
          const { orderId: newOrderId, entryPrice: newEntry, executionId: newExecId, error: retryError } =
            await this.placeBinaryOrder(
              updated, retryDirection, exec.candleTimestamp, exec.candleDirection,
            );

          if (retryError || !newOrderId) {
            this.logger.error(`❌ Martingale retry failed: ${retryError}`);
            await this.rescheduleSession(exec.sessionId);
            return;
          }

          await this.fastTradeService.markWaitingResult(
            exec.sessionId, newOrderId, newExecId!, retryDirection,
          );
          this.totalOrdersPlaced++;
          this.logger.log(
            `✅ [${exec.sessionId.slice(-8)}] Martingale order: ${newOrderId.slice(-8)} | ` +
            `${retryDirection} @ ${newEntry} | Step: ${updated.currentStep}`,
          );
          this.emitSessionUpdate(updated);
        } catch (retryErr) {
          this.logger.error(`❌ Martingale retry error: ${retryErr.message}`);
          await this.rescheduleSession(exec.sessionId);
        }
      }
    } catch (error) {
      this.logger.error(
        `❌ resolveExecution [${exec.id.slice(-8)}]: ${error.message}`, error.stack,
      );
    } finally {
      this.pollingLock.delete(exec.id);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private async rescheduleSession(sessionId: string): Promise<void> {
    try {
      const session = await this.fastTradeService.getSessionById(sessionId);
      if (!session.isActive) return;
      const tfSeconds    = TIMEFRAME_SECONDS_MAP[session.timeframe];
      const nextCandleAt = this.fastTradeService.calcNextCandleBoundary(tfSeconds);
      await this.fastTradeService.markWaiting(sessionId, nextCandleAt);
    } catch {}
  }

  private emitSessionUpdate(session: FastTradeSession | Partial<FastTradeSession>): void {
    try {
      const userId = (session as FastTradeSession).userId;
      if (!userId) return;
      this.tradingGateway.emitOrderUpdate(userId, {
        type: 'fast_trade_session_update',
        sessionId: (session as FastTradeSession).id,
        data: session,
      });
    } catch {}
  }

  private emitOrderSettled(userId: string, orderId: string, result: 'won' | 'lost', profit: number): void {
    try {
      this.tradingGateway.emitOrderSettled(userId, {
        orderId,
        result: result === 'won' ? ORDER_STATUS.WON : ORDER_STATUS.LOST,
        profit,
        source: 'fast_trade',
      });
    } catch {}
  }

  private now(): string { return TimezoneUtil.toISOString(); }
  private sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

  getStats() {
    return {
      totalCycles:           this.totalCycles,
      totalOrdersPlaced:     this.totalOrdersPlaced,
      totalWins:             this.totalWins,
      totalLosses:           this.totalLosses,
      winRate:               this.totalOrdersPlaced > 0
        ? ((this.totalWins / this.totalOrdersPlaced) * 100).toFixed(1) + '%'
        : 'N/A',
      activeProcessingLocks: this.processingLock.size,
      activePollingLocks:    this.pollingLock.size,
      cronInterval:          '1s tick + 1s result poll',
      fixes: [
        '#1 registerExternalOrder → instant settlement via pendingOrderRegistry',
        '#2 Expiry = entry + tfSeconds (no extra +1min)',
        '#3 Cron tiap 1s (was 2s)',
      ],
    };
  }
}