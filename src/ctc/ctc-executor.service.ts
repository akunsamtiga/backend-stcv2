// src/ctc/ctc-executor.service.ts
//
// ╔══════════════════════════════════════════════════════════════╗
// ║  FIXES                                                       ║
// ║  #1  registerExternalOrder() dipanggil setelah order dibuat  ║
// ║      → order masuk pendingOrderRegistry                      ║
// ║      → processExpiredOrders (tiap 1 detik) langsung settle   ║
// ║      SEBELUMNYA: tidak dipanggil → nyangkut sampai 5 menit   ║
// ║                                                              ║
// ║  #2  Expiry = entryTimestamp + CTC_TIMEFRAME_SECONDS (60s)   ║
// ║      SEBELUMNYA: pakai calculateExpiryTimestamp() yang       ║
// ║      menambah +1 menit ekstra jika entry di detik > 20       ║
// ║      → order 1m CTC bisa jadi 2m                             ║
// ║                                                              ║
// ║  #3  Cron tick diubah dari */2 ke * (tiap 1 detik)           ║
// ║      → delay eksekusi dari ±2s menjadi ±1s                   ║
// ╚══════════════════════════════════════════════════════════════╝

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';
import { CtcService } from './ctc.service';
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
import { CtcSession, CtcExecution, CtcCandleDirection } from './interfaces/ctc.interface';
import { CTC_TIMEFRAME_SECONDS, CTC_ORDER_DURATION } from './dto/create-ctc.dto';
import { BinaryOrder } from '../common/interfaces';

type SessionLockSet = Set<string>;

@Injectable()
export class CtcExecutorService {
  private readonly logger = new Logger(CtcExecutorService.name);

  private processingLock: SessionLockSet = new Set();
  private pollingLock:    SessionLockSet = new Set();

  private totalCycles       = 0;
  private totalOrdersPlaced = 0;
  private totalWins         = 0;
  private totalLosses       = 0;

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly ctcService: CtcService,
    private readonly balanceService: BalanceService,
    private readonly priceFetcherService: PriceFetcherService,
    private readonly userStatusService: UserStatusService,
    private readonly tradingGateway: TradingGateway,
    private readonly binaryOrdersService: BinaryOrdersService, // ✅ FIX #1
  ) {
    this.logger.log('✅ CtcExecutorService initialized');
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
    const sessions = this.ctcService.getAllActiveSessions();
    if (!sessions.length) return;
    const nowSec = TimezoneUtil.getCurrentTimestamp();
    await Promise.allSettled(sessions.map(s => this.processTick(s, nowSec)));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 2 — Result poller: every 1 second
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('* * * * * *')
  async checkPendingResults(): Promise<void> {
    let pending: CtcExecution[];
    try {
      pending = await this.ctcService.getPendingExecutions();
    } catch (error) {
      this.logger.error(`❌ Gagal fetch pending CTC executions: ${error.message}`);
      return;
    }
    if (!pending.length) return;
    this.logger.debug(`🔍 Checking ${pending.length} pending CTC executions`);
    await Promise.allSettled(pending.map(exec => this.resolveExecution(exec)));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 3 — Daily cleanup
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('0 3 * * *')
  async cleanupOldData(): Promise<void> {
    try {
      const count = await this.ctcService.cleanupOldExecutions();
      this.logger.log(`🧹 Cleaned up ${count} old CTC executions`);
    } catch (error) {
      this.logger.error(`❌ CTC cleanup error: ${error.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE: Process satu sesi pada satu tick
  // ══════════════════════════════════════════════════════════════════════════

  private async processTick(session: CtcSession, nowSec: number): Promise<void> {
    if (this.processingLock.has(session.id)) return;
    if (session.status === 'waiting_result') return;

    const distanceToCandle = session.nextCandleAt - nowSec;
    if (distanceToCandle > 0) return;

    this.processingLock.add(session.id);

    try {
      let orderDirection: 'CALL' | 'PUT';
      let candleDirection: CtcCandleDirection;
      let candleTimestamp: number;
      let isMartingaleRetry = false;
      let isWinContinue     = false;

      if (session.nextDirection !== null) {
        // Arah sudah ditentukan (WIN lanjut / martingale)
        orderDirection = session.nextDirection;

        if (session.consecutiveLosses > 0) {
          isMartingaleRetry = true;
          this.logger.log(
            `🔄 [${session.id.slice(-8)}] Martingale retry | ` +
            `Step: ${session.currentStep} | ${orderDirection} | ` +
            `Rp ${session.currentAmount.toLocaleString('id-ID')}`,
          );
        } else {
          isWinContinue = true;
          this.logger.log(
            `⚡ [${session.id.slice(-8)}] WIN continue | ` +
            `${orderDirection} | Rp ${session.currentAmount.toLocaleString('id-ID')}`,
          );
        }

        candleTimestamp = session.lastCandleTimestamp ?? session.nextCandleAt - CTC_TIMEFRAME_SECONDS;
        candleDirection = orderDirection === 'CALL' ? 'bullish' : 'bearish';

      } else {
        // Baca candle baru dari RTDB
        await this.ctcService.markReadingCandle(session.id);

        const expectedCandleTs = session.nextCandleAt - CTC_TIMEFRAME_SECONDS;
        const { direction, candle } = await this.ctcService.getCandleDirection(
          session.assetId, expectedCandleTs,
        );

        this.logger.log(
          `📊 [${session.id.slice(-8)}] Candle: ${direction.toUpperCase()} | ` +
          `t=${candle?.t} O=${candle?.o} C=${candle?.c}`,
        );

        if (direction === 'neutral') {
          this.logger.warn(`⚠️ [${session.id.slice(-8)}] Neutral candle — skip cycle`);
          await this.ctcService.saveExecution({
            sessionId: session.id, userId: session.userId,
            candleTimestamp: candle?.t ?? expectedCandleTs, candleDirection: 'neutral',
            orderId: undefined, direction: 'CALL', amount: session.currentAmount,
            martingaleStep: session.currentStep, accountType: session.accountType,
            assetSymbol: session.assetSymbol, assetId: session.assetId,
            duration: CTC_ORDER_DURATION, isMartingaleRetry: false, isWinContinue: false,
            status: 'skipped', profit: 0, placedAt: this.now(),
          });
          await this.ctcService.markWaiting(session.id);
          return;
        }

        orderDirection  = direction === 'bullish' ? 'CALL' : 'PUT';
        candleDirection = direction;
        candleTimestamp = candle?.t ?? expectedCandleTs;
      }

      // Place order
      await this.ctcService.markPlacingOrder(session.id);

      const { orderId, entryPrice, executionId, error } = await this.placeBinaryOrder(
        session, orderDirection, candleTimestamp, candleDirection, isMartingaleRetry, isWinContinue,
      );

      if (error || !orderId) {
        this.logger.error(`❌ [${session.id.slice(-8)}] Order placement failed: ${error}`);
        await this.ctcService.markWaiting(session.id);
        return;
      }

      await this.ctcService.markWaitingResult(session.id, orderId, executionId!, orderDirection);
      this.totalOrdersPlaced++;

      this.logger.log(
        `✅ [${session.id.slice(-8)}] Order placed: ${orderId.slice(-8)} | ` +
        `${orderDirection} @ ${entryPrice} | Rp ${session.currentAmount.toLocaleString('id-ID')} | ` +
        `Step: ${session.currentStep}` +
        `${isMartingaleRetry ? ' [MARTINGALE]' : isWinContinue ? ' [WIN+]' : ' [FRESH]'}`,
      );

      this.emitSessionUpdate(session);

    } catch (error) {
      this.logger.error(
        `❌ [${session.id.slice(-8)}] processTick error: ${error.message}`, error.stack,
      );
      try { await this.ctcService.markWaiting(session.id); } catch {}
    } finally {
      this.processingLock.delete(session.id);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE: Place binary order (1 menit duration)
  // ══════════════════════════════════════════════════════════════════════════

  private async placeBinaryOrder(
    session: CtcSession,
    direction: 'CALL' | 'PUT',
    candleTimestamp: number,
    candleDirection: CtcCandleDirection,
    isMartingaleRetry: boolean,
    isWinContinue: boolean,
  ): Promise<{ orderId?: string; entryPrice?: number; executionId?: string; error?: string }> {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const amount      = session.currentAmount;
        const accountType = session.accountType as 'real' | 'demo';

        // 1. Cek saldo
        const balance = await this.balanceService.getCurrentBalanceStrict(session.userId, accountType);
        if (balance < amount) {
          const msg =
            `Saldo ${accountType} tidak cukup. ` +
            `Tersedia: Rp ${balance.toLocaleString('id-ID')}, ` +
            `Dibutuhkan: Rp ${amount.toLocaleString('id-ID')}`;
          this.logger.warn(`⚠️ [${session.id.slice(-8)}] ${msg}`);
          const exec = await this.ctcService.saveExecution({
            sessionId: session.id, userId: session.userId,
            candleTimestamp, candleDirection, direction, amount,
            martingaleStep: session.currentStep, accountType: session.accountType,
            assetSymbol: session.assetSymbol, assetId: session.assetId,
            duration: CTC_ORDER_DURATION, isMartingaleRetry, isWinContinue,
            status: 'error', profit: 0, errorMessage: msg, placedAt: this.now(),
          });
          await this.ctcService.forceStopSession(session.id, msg);
          return { executionId: exec.id, error: msg };
        }

        // 2. Get asset
        const assetDoc = await this.db.collection(COLLECTIONS.ASSETS).doc(session.assetId).get();
        if (!assetDoc.exists) throw new Error(`Asset ${session.assetId} not found`);
        const asset = assetDoc.data() as any;

        // 3. Get entry price
        let entryPrice = 0;
        try {
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(asset, true);
          if (priceData?.price) entryPrice = priceData.price;
        } catch {
          entryPrice = asset.simulatorSettings?.currentPrice
            ?? asset.simulatorSettings?.initialPrice ?? 0;
        }
        if (!entryPrice) throw new Error(`Cannot get entry price for ${asset.symbol}`);

        // 4. User status & profit rate
        const userStatus  = await this.userStatusService.getUserStatus(session.userId);
        const statusBonus = this.userStatusService.getProfitBonus(userStatus);
        const profitRate  = (asset.profitRate ?? 85) + statusBonus;

        // 5. ✅ FIX #2: Expiry = entryTimestamp + 60 detik (DIRECT — no extra +1min)
        //    calculateExpiryTimestamp() menambah +1 menit jika entry di detik > 20.
        //    CTC order durasi 1 menit HARUS tepat 60 detik dari waktu entry.
        const entryTimestamp  = TimezoneUtil.getCurrentTimestamp();
        const expiryTimestamp = entryTimestamp + CTC_TIMEFRAME_SECONDS; // ← FIX: +60 detik langsung
        const entryDate  = TimezoneUtil.fromTimestamp(entryTimestamp);
        const expiryDate = TimezoneUtil.fromTimestamp(expiryTimestamp);
        const entryInfo  = TimezoneUtil.getDateTimeInfo(entryDate);
        const expiryInfo = TimezoneUtil.getDateTimeInfo(expiryDate);

        this.logger.log(
          `⏱️ [${session.id.slice(-8)}] Entry: ${entryInfo.datetime} | ` +
          `Expiry: ${expiryInfo.datetime} (60s from now)`,
        );

        // 6. Create order
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
          duration:       CTC_ORDER_DURATION,
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
            isCtc:           true,
            ctcSessionId:    session.id,
            candleTimestamp,
            candleDirection,
            martingaleStep:  session.currentStep,
            isMartingaleRetry,
            isWinContinue,
            timezone:        'Asia/Jakarta',
          },
          createdAt: entryInfo.datetime_iso,
        };

        await this.db.collection(COLLECTIONS.ORDERS).doc(orderId).set(orderData);

        // ✅ FIX #1: Register ke pendingOrderRegistry agar processExpiredOrders
        //    (jalan tiap 1 detik) bisa settle order ini tepat waktu.
        //    TANPA ini, order tidak terdeteksi sampai reconciliation (tiap 5 menit).
        this.binaryOrdersService.registerExternalOrder(orderData as BinaryOrder);

        // 7. Debit saldo
        try {
          await this.balanceService.createBalanceEntry(
            session.userId,
            {
              accountType,
              type:        BALANCE_TYPES.ORDER_DEBIT,
              amount,
              description: `[CTC] ${session.assetSymbol} ${direction} 1m ` +
                           `#${orderId.slice(-8)} Step:${session.currentStep}` +
                           (isMartingaleRetry ? ' [MG]' : isWinContinue ? ' [WIN+]' : ''),
            },
            true,
          );
        } catch (debitErr) {
          this.logger.error(`❌ Debit failed, rollback: ${debitErr.message}`);
          await this.db.collection(COLLECTIONS.ORDERS).doc(orderId).delete();
          throw new Error(`Balance debit failed: ${debitErr.message}`);
        }

        this.balanceService.clearUserCache(session.userId);

        // 8. Save execution log
        const exec = await this.ctcService.saveExecution({
          sessionId: session.id, userId: session.userId,
          candleTimestamp, candleDirection, orderId, direction, amount,
          martingaleStep: session.currentStep, accountType: session.accountType,
          assetSymbol: session.assetSymbol, assetId: session.assetId,
          duration: CTC_ORDER_DURATION, isMartingaleRetry, isWinContinue,
          status: 'placed', profit: 0, entryPrice, placedAt: this.now(),
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
          const exec = await this.ctcService.saveExecution({
            sessionId: session.id, userId: session.userId,
            candleTimestamp, candleDirection, direction,
            amount: session.currentAmount, martingaleStep: session.currentStep,
            accountType: session.accountType, assetSymbol: session.assetSymbol,
            assetId: session.assetId, duration: CTC_ORDER_DURATION,
            isMartingaleRetry, isWinContinue,
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
  //       membaca hasilnya dan mengupdate session state + martingale/win-continue.
  // ══════════════════════════════════════════════════════════════════════════

  private async resolveExecution(exec: CtcExecution): Promise<void> {
    if (!exec.orderId) return;
    if (this.pollingLock.has(exec.id)) return;

    this.pollingLock.add(exec.id);

    try {
      const orderDoc = await this.db.collection(COLLECTIONS.ORDERS).doc(exec.orderId).get();

      if (!orderDoc.exists) {
        await this.ctcService.updateExecution(exec.id, {
          status: 'error', errorMessage: 'Order not found',
        });
        await this.ctcService.markWaiting(exec.sessionId);
        return;
      }

      const order = orderDoc.data() as any;

      // Masih ACTIVE → tunggu processExpiredOrders yang settle
      if (order.status === ORDER_STATUS.ACTIVE) {
        const expiryTs  = TimezoneUtil.toTimestamp(new Date(order.exit_time));
        const remaining = expiryTs - TimezoneUtil.getCurrentTimestamp();
        this.logger.debug(
          `⏳ [${exec.sessionId.slice(-8)}] CTC order ${exec.orderId.slice(-8)} ACTIVE (${remaining}s)`,
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
      await this.ctcService.updateExecution(exec.id, {
        status: result, profit: result === 'won' ? finalAmount : -exec.amount,
        exitPrice: order.exit_price ?? undefined, settledAt,
      });

      // Balance credit sudah dilakukan oleh settleOrderInstant di BinaryOrdersService.
      // TIDAK perlu credit ulang di sini untuk menghindari double credit.

      // Update session state
      const session = await this.ctcService.getSessionById(exec.sessionId);
      if (!session.isActive) {
        this.logger.warn(`⚠️ [${exec.sessionId.slice(-8)}] Session sudah stop — skip state update`);
        return;
      }

      const { shouldStop, stopReason, session: updated } =
        await this.ctcService.applyOrderResult(
          exec.sessionId, result, finalAmount, exec.candleTimestamp, exec.direction,
        );

      if (result === 'won') this.totalWins++;
      else                   this.totalLosses++;

      this.logger.log(
        `${result === 'won' ? '✅ WIN' : '❌ LOSE'} [${exec.sessionId.slice(-8)}] ` +
        `${exec.assetSymbol} ${exec.direction} | ` +
        `Rp ${exec.amount.toLocaleString('id-ID')} | ` +
        `${result === 'won'
          ? `+Rp ${finalAmount.toLocaleString('id-ID')}`
          : `-Rp ${exec.amount.toLocaleString('id-ID')}`} | ` +
        `NextDir: ${updated.nextDirection ?? 'read-candle'} | ` +
        `TotalPnL: ${updated.totalPnL >= 0 ? '+' : ''}Rp ${updated.totalPnL.toLocaleString('id-ID')}`,
      );

      this.emitOrderSettled(exec.userId, exec.orderId!, result, finalAmount);
      this.emitSessionUpdate(updated);

      if (shouldStop) {
        this.logger.log(`🏁 [${exec.sessionId.slice(-8)}] CTC session completed: ${stopReason}`);
      }

    } catch (error) {
      this.logger.error(
        `❌ resolveExecution CTC [${exec.id.slice(-8)}]: ${error.message}`, error.stack,
      );
    } finally {
      this.pollingLock.delete(exec.id);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private emitSessionUpdate(session: CtcSession | Partial<CtcSession>): void {
    try {
      const userId = (session as CtcSession).userId;
      if (!userId) return;
      this.tradingGateway.emitOrderUpdate(userId, {
        type: 'ctc_session_update',
        sessionId: (session as CtcSession).id,
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
        source: 'ctc',
      });
    } catch {}
  }

  private now(): string { return TimezoneUtil.toISOString(); }
  private sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

  getStats() {
    return {
      feature:               'CTC (Copy The Candle)',
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
        '#2 Expiry = entry + 60s (no extra +1min)',
        '#3 Cron tiap 1s (was 2s)',
      ],
      logic: {
        timeframe:     '1m (fixed)',
        orderDuration: '1 menit (tepat 60 detik)',
        winBehavior:   'Lanjut arah sama tanpa baca candle baru',
        loseBehavior:  'Martingale: arah = candle yang kalah (opposite bet)',
        maxStep:       'Reset amount + baca candle baru',
      },
    };
  }
}