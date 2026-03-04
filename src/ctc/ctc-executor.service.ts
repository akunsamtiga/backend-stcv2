// src/ctc/ctc-executor.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service';
import { CtcService } from './ctc.service';
import { BalanceService } from '../balance/balance.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { UserStatusService } from '../user/user-status.service';
import { TradingGateway } from '../websocket/trading.gateway';
import {
  COLLECTIONS,
  ORDER_STATUS,
  BALANCE_TYPES,
} from '../common/constants';
import { CalculationUtil, TimezoneUtil } from '../common/utils';
import { CtcSession, CtcExecution, CtcCandleDirection } from './interfaces/ctc.interface';
import { CTC_TIMEFRAME_SECONDS, CTC_ORDER_DURATION } from './dto/create-ctc.dto';

type SessionLockSet = Set<string>;

@Injectable()
export class CtcExecutorService {
  private readonly logger = new Logger(CtcExecutorService.name);

  private processingLock: SessionLockSet = new Set();
  private pollingLock:    SessionLockSet = new Set();

  // Stats
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
  ) {
    this.logger.log('✅ CtcExecutorService initialized');
    this.logger.log('⚡ Engine: boundary detection setiap 2 detik');
    this.logger.log('🔄 Result polling: setiap 1 detik');
  }

  private get db() { return this.firebaseService.getFirestore(); }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 1: Main engine — tiap 2 detik
  //   Deteksi batas candle 1m → langsung eksekusi order
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('*/2 * * * * *')
  async handleCandleTick(): Promise<void> {
    this.totalCycles++;

    let sessions: CtcSession[];
    try {
      sessions = await this.ctcService.getAllActiveSessions();
    } catch (error) {
      this.logger.error(`❌ Gagal fetch active CTC sessions: ${error.message}`);
      return;
    }
    if (!sessions.length) return;

    const nowSec = TimezoneUtil.getCurrentTimestamp();
    await Promise.allSettled(sessions.map(s => this.processTick(s, nowSec)));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 2: Result poller — tiap 1 detik
  //   Cek pending CTC execution → resolve WIN/LOSE
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
  // CRON 3: Daily cleanup
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
    if (session.status === 'waiting_result')  return;  // tunggu result poller

    // Batas candle harus sudah lewat (distanceToCandle ≤ 0)
    const distanceToCandle = session.nextCandleAt - nowSec;
    if (distanceToCandle > 0) return;

    this.processingLock.add(session.id);

    try {
      // ── Tentukan arah order ──────────────────────────────────────────────
      //
      // CTC priority:
      //   1. session.nextDirection !== null → gunakan langsung (WIN continue / martingale)
      //   2. null → baca candle dari RTDB
      //
      let orderDirection: 'CALL' | 'PUT';
      let candleDirection: CtcCandleDirection;
      let candleTimestamp: number;
      let isMartingaleRetry = false;
      let isWinContinue     = false;

      if (session.nextDirection !== null) {
        // ── Arah sudah ditentukan (WIN lanjut / martingale) ──────────────
        orderDirection = session.nextDirection;

        // Tentukan flag berdasarkan context
        if (session.consecutiveLosses > 0) {
          isMartingaleRetry = true;
          this.logger.log(
            `🔄 [${session.id.slice(-8)}] Martingale retry | ` +
            `Step: ${session.currentStep} | Direction: ${orderDirection} (candle yg kalah) | ` +
            `Amount: Rp ${session.currentAmount.toLocaleString('id-ID')}`,
          );
        } else {
          isWinContinue = true;
          this.logger.log(
            `⚡ [${session.id.slice(-8)}] WIN continue | ` +
            `Direction: ${orderDirection} (sama dgn order menang) | ` +
            `Amount: Rp ${session.currentAmount.toLocaleString('id-ID')}`,
          );
        }

        // Gunakan timestamp candle sebelumnya untuk logging
        candleTimestamp  = session.lastCandleTimestamp ?? session.nextCandleAt - CTC_TIMEFRAME_SECONDS;
        candleDirection  = orderDirection === 'CALL' ? 'bullish' : 'bearish';

      } else {
        // ── Baca candle baru dari RTDB ───────────────────────────────────
        await this.ctcService.markReadingCandle(session.id);

        const expectedCandleTs = session.nextCandleAt - CTC_TIMEFRAME_SECONDS;
        const { direction, candle } = await this.ctcService.getCandleDirection(
          session.assetId,
          expectedCandleTs,
        );

        this.logger.log(
          `📊 [${session.id.slice(-8)}] Candle: ${direction.toUpperCase()} | ` +
          `t=${candle?.t} O=${candle?.o} C=${candle?.c}`,
        );

        if (direction === 'neutral') {
          this.logger.warn(`⚠️ [${session.id.slice(-8)}] Neutral candle — skip cycle`);
          await this.ctcService.saveExecution({
            sessionId:        session.id,
            userId:           session.userId,
            candleTimestamp:  candle?.t ?? expectedCandleTs,
            candleDirection:  'neutral',
            orderId:          undefined,
            direction:        'CALL',
            amount:           session.currentAmount,
            martingaleStep:   session.currentStep,
            accountType:      session.accountType,
            assetSymbol:      session.assetSymbol,
            assetId:          session.assetId,
            duration:         CTC_ORDER_DURATION,
            isMartingaleRetry: false,
            isWinContinue:    false,
            status:           'skipped',
            profit:           0,
            placedAt:         this.now(),
          });
          await this.ctcService.markWaiting(session.id);
          return;
        }

        orderDirection   = direction === 'bullish' ? 'CALL' : 'PUT';
        candleDirection  = direction;
        candleTimestamp  = candle?.t ?? expectedCandleTs;
      }

      // ── Place order ──────────────────────────────────────────────────────
      await this.ctcService.markPlacingOrder(session.id);

      const { orderId, entryPrice, executionId, error } = await this.placeBinaryOrder(
        session,
        orderDirection,
        candleTimestamp,
        candleDirection,
        isMartingaleRetry,
        isWinContinue,
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
        `Step: ${session.currentStep}${isMartingaleRetry ? ' [MARTINGALE]' : isWinContinue ? ' [WIN-CONTINUE]' : ' [FRESH]'}`,
      );

      this.emitSessionUpdate(session);

    } catch (error) {
      this.logger.error(
        `❌ [${session.id.slice(-8)}] processTick error: ${error.message}`,
        error.stack,
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
  ): Promise<{
    orderId?: string;
    entryPrice?: number;
    executionId?: string;
    error?: string;
  }> {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const amount      = session.currentAmount;
        const accountType = session.accountType as 'real' | 'demo';

        // ── 1. Cek saldo ───────────────────────────────────────────────────
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

        // ── 2. Get asset ───────────────────────────────────────────────────
        const assetDoc = await this.db.collection(COLLECTIONS.ASSETS).doc(session.assetId).get();
        if (!assetDoc.exists) throw new Error(`Asset ${session.assetId} not found`);
        const asset = assetDoc.data() as any;

        // ── 3. Get entry price ─────────────────────────────────────────────
        let entryPrice = 0;
        try {
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(asset, true);
          if (priceData?.price) entryPrice = priceData.price;
        } catch {
          entryPrice =
            asset.simulatorSettings?.currentPrice ??
            asset.simulatorSettings?.initialPrice ?? 0;
        }
        if (!entryPrice) throw new Error(`Cannot get entry price for ${asset.symbol}`);

        // ── 4. User status & profit rate ───────────────────────────────────
        const userStatus  = await this.userStatusService.getUserStatus(session.userId);
        const statusBonus = this.userStatusService.getProfitBonus(userStatus);
        const profitRate  = (asset.profitRate ?? 85) + statusBonus;

        // ── 5. Calculate expiry (selalu 1 menit) ───────────────────────────
        const entryTimestamp  = TimezoneUtil.getCurrentTimestamp();
        const expiryTimestamp = CalculationUtil.calculateExpiryTimestamp(
          entryTimestamp,
          CTC_ORDER_DURATION,
        );
        const entryDate  = TimezoneUtil.fromTimestamp(entryTimestamp);
        const expiryDate = TimezoneUtil.fromTimestamp(expiryTimestamp);
        const entryInfo  = TimezoneUtil.getDateTimeInfo(entryDate);
        const expiryInfo = TimezoneUtil.getDateTimeInfo(expiryDate);

        // ── 6. Create order ────────────────────────────────────────────────
        const orderId = await this.firebaseService.generateId(COLLECTIONS.ORDERS);

        await this.db.collection(COLLECTIONS.ORDERS).doc(orderId).set({
          id:           orderId,
          user_id:      session.userId,
          accountType,
          asset_id:     session.assetId,
          asset_name:   asset.name,
          asset_symbol: asset.symbol,
          direction,
          amount,
          duration:     CTC_ORDER_DURATION,
          entry_price:  entryPrice,
          entry_time:   entryInfo.datetime_iso,
          exit_price:   null,
          exit_time:    expiryInfo.datetime_iso,
          status:       ORDER_STATUS.ACTIVE,
          profit:       null,
          profitRate,
          baseProfitRate: asset.profitRate ?? 85,
          statusBonus,
          userStatus,
          metadata: {
            isCtc:          true,
            ctcSessionId:   session.id,
            candleTimestamp,
            candleDirection,
            martingaleStep: session.currentStep,
            isMartingaleRetry,
            isWinContinue,
            timezone:       'Asia/Jakarta',
          },
          createdAt: entryInfo.datetime_iso,
        });

        // ── 7. Debit saldo ─────────────────────────────────────────────────
        try {
          await this.balanceService.createBalanceEntry(
            session.userId,
            {
              accountType,
              type:        BALANCE_TYPES.ORDER_DEBIT,
              amount,
              description:
                `[CTC] ${session.assetSymbol} ${direction} 1m ` +
                `#${orderId.slice(-8)} Step:${session.currentStep}` +
                (isMartingaleRetry ? ' [MG]' : isWinContinue ? ' [WIN+]' : ''),
            },
            true,
          );
        } catch (debitErr) {
          this.logger.error(`❌ Debit failed, rollback order: ${debitErr.message}`);
          await this.db.collection(COLLECTIONS.ORDERS).doc(orderId).delete();
          throw new Error(`Balance debit failed: ${debitErr.message}`);
        }

        this.balanceService.clearUserCache(session.userId);

        // ── 8. Save execution log ──────────────────────────────────────────
        const exec = await this.ctcService.saveExecution({
          sessionId:   session.id,
          userId:      session.userId,
          candleTimestamp,
          candleDirection,
          orderId,
          direction,
          amount,
          martingaleStep: session.currentStep,
          accountType:    session.accountType,
          assetSymbol:    session.assetSymbol,
          assetId:        session.assetId,
          duration:       CTC_ORDER_DURATION,
          isMartingaleRetry,
          isWinContinue,
          status:         'placed',
          profit:         0,
          entryPrice,
          placedAt:       this.now(),
        });

        return { orderId, entryPrice, executionId: exec.id };

      } catch (error) {
        const isLast = attempt === maxRetries - 1;
        this.logger.error(
          `❌ [${session.id.slice(-8)}] placeBinaryOrder attempt ${attempt + 1}/${maxRetries}: ${error.message}`,
        );

        if (!isLast) {
          await this.sleep(2000 * Math.pow(2, attempt));
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
  // CORE: Resolve pending execution (cek hasil binary order)
  // ══════════════════════════════════════════════════════════════════════════

  private async resolveExecution(exec: CtcExecution): Promise<void> {
    if (!exec.orderId) return;
    if (this.pollingLock.has(exec.id)) return;

    this.pollingLock.add(exec.id);

    try {
      const orderDoc = await this.db.collection(COLLECTIONS.ORDERS).doc(exec.orderId).get();

      if (!orderDoc.exists) {
        await this.ctcService.updateExecution(exec.id, { status: 'error', errorMessage: 'Order not found' });
        await this.ctcService.markWaiting(exec.sessionId);
        return;
      }

      const order = orderDoc.data() as any;

      // Masih ACTIVE → tunggu
      if (order.status === ORDER_STATUS.ACTIVE) {
        const expiryTs  = TimezoneUtil.toTimestamp(new Date(order.exit_time));
        const remaining = expiryTs - TimezoneUtil.getCurrentTimestamp();
        this.logger.debug(
          `⏳ [${exec.sessionId.slice(-8)}] CTC order ${exec.orderId.slice(-8)} ACTIVE (${remaining}s)`,
        );
        return;
      }

      // ── Settled ──────────────────────────────────────────────────────────
      const result: 'won' | 'lost' =
        order.status === ORDER_STATUS.WON ? 'won' : 'lost';

      const profitRate  = order.profitRate ?? 85;
      const finalAmount = result === 'won'
        ? Math.round(exec.amount * (profitRate / 100))
        : exec.amount;

      const settledAt = this.now();
      await this.ctcService.updateExecution(exec.id, {
        status:    result,
        profit:    result === 'won' ? finalAmount : -exec.amount,
        exitPrice: order.exit_price ?? undefined,
        settledAt,
      });

      // ── Kredit saldo (WIN only) ───────────────────────────────────────────
      if (result === 'won') {
        try {
          await this.balanceService.createBalanceEntry(
            exec.userId,
            {
              accountType: exec.accountType as 'real' | 'demo',
              type:        BALANCE_TYPES.ORDER_PROFIT,
              amount:      exec.amount + finalAmount,
              description:
                `[CTC] WIN ${exec.assetSymbol} ${exec.direction} ` +
                `#${exec.orderId!.slice(-8)} (+Rp ${finalAmount.toLocaleString('id-ID')})`,
            },
            true,
          );
          this.balanceService.clearUserCache(exec.userId);
        } catch (creditErr) {
          this.logger.error(`❌ [${exec.sessionId.slice(-8)}] Credit failed: ${creditErr.message}`);
        }
      }

      // ── Update session state ─────────────────────────────────────────────
      const session = await this.ctcService.getSessionById(exec.sessionId);
      if (!session.isActive) {
        this.logger.warn(`⚠️ [${exec.sessionId.slice(-8)}] Session sudah stop — skip state update`);
        return;
      }

      const { shouldStop, stopReason, session: updated } =
        await this.ctcService.applyOrderResult(
          exec.sessionId,
          result,
          finalAmount,
          exec.candleTimestamp,
          exec.direction,
        );

      if (result === 'won') this.totalWins++;
      else                   this.totalLosses++;

      this.logger.log(
        `${result === 'won' ? '✅ WIN' : '❌ LOSE'} ` +
        `[${exec.sessionId.slice(-8)}] ` +
        `${exec.assetSymbol} ${exec.direction} | ` +
        `Rp ${exec.amount.toLocaleString('id-ID')} | ` +
        `${result === 'won' ? `+Rp ${finalAmount.toLocaleString('id-ID')}` : `-Rp ${exec.amount.toLocaleString('id-ID')}`} | ` +
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
        `❌ resolveExecution CTC [${exec.id.slice(-8)}]: ${error.message}`,
        error.stack,
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
        type:      'ctc_session_update',
        sessionId: (session as CtcSession).id,
        data:      session,
      });
    } catch {}
  }

  private emitOrderSettled(
    userId: string,
    orderId: string,
    result: 'won' | 'lost',
    profit: number,
  ): void {
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

  // ══════════════════════════════════════════════════════════════════════════
  // MONITORING
  // ══════════════════════════════════════════════════════════════════════════

  getStats() {
    return {
      feature:             'CTC (Copy The Candle)',
      totalCycles:         this.totalCycles,
      totalOrdersPlaced:   this.totalOrdersPlaced,
      totalWins:           this.totalWins,
      totalLosses:         this.totalLosses,
      winRate:             this.totalOrdersPlaced > 0
        ? ((this.totalWins / this.totalOrdersPlaced) * 100).toFixed(1) + '%'
        : 'N/A',
      activeProcessingLocks: this.processingLock.size,
      activePollingLocks:    this.pollingLock.size,
      cronInterval:          '2s (candle tick) + 1s (result poll)',
      logic: {
        timeframe:       '1m (fixed)',
        orderDuration:   '1 menit',
        winBehavior:     'Lanjut arah sama tanpa baca candle baru',
        loseBehavior:    'Martingale: arah = candle yang kalah (opposite bet)',
        maxStepBehavior: 'Reset amount + baca candle baru',
      },
    };
  }
}