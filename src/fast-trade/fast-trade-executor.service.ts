// src/fast-trade/fast-trade-executor.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import { FieldValue } from '@google-cloud/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { FastTradeService } from './fast-trade.service';
import { BalanceService } from '../balance/balance.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { UserStatusService } from '../user/user-status.service';
import { TradingGateway } from '../websocket/trading.gateway';
import {
  COLLECTIONS,
  ORDER_STATUS,
  BALANCE_TYPES,
  BALANCE_ACCOUNT_TYPE,
} from '../common/constants';
import { CalculationUtil, TimezoneUtil } from '../common/utils';
import {
  FastTradeSession,
  FastTradeExecution,
  CandleDirection,
} from './interfaces/fast-trade.interface';
import {
  FastTradeTimeframe,
  FastTradeAccountType,
  TIMEFRAME_SECONDS_MAP,
  TIMEFRAME_DURATION_MAP,
} from './dto/create-fast-trade.dto';

// ── Lock flags ─────────────────────────────────────────────────────────────
// Key: sessionId
type SessionLockSet = Set<string>;

@Injectable()
export class FastTradeExecutorService {
  private readonly logger = new Logger(FastTradeExecutorService.name);

  // Prevent concurrent execution for the same session
  private processingLock: SessionLockSet = new Set();

  // Track sessions that are currently waiting for a result poll
  private pollingLock: SessionLockSet = new Set();

  // Stats
  private totalCycles      = 0;
  private totalOrdersPlaced = 0;
  private totalWins        = 0;
  private totalLosses      = 0;

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly fastTradeService: FastTradeService,
    private readonly balanceService: BalanceService,
    private readonly priceFetcherService: PriceFetcherService,
    private readonly userStatusService: UserStatusService,
    private readonly tradingGateway: TradingGateway,
  ) {
    this.logger.log('✅ FastTradeExecutorService initialized');
    this.logger.log('⚡ Engine: candle-boundary detection every 2 seconds');
    this.logger.log('🔄 Result polling: every 5 seconds');
  }

  private get db() {
    return this.firebaseService.getFirestore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 1: Main engine — runs every 2 seconds
  //   Checks all active sessions → fires order at candle boundary
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('*/2 * * * * *')
  async handleCandleTick(): Promise<void> {
    this.totalCycles++;

    let sessions: FastTradeSession[];
    try {
      sessions = await this.fastTradeService.getAllActiveSessions();
    } catch (error) {
      this.logger.error(`❌ Failed to fetch active sessions: ${error.message}`);
      return;
    }

    if (sessions.length === 0) return;

    const nowSec = TimezoneUtil.getCurrentTimestamp();

    // Process each session in parallel (they're independent)
    await Promise.allSettled(
      sessions.map(session => this.processTick(session, nowSec)),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 2: Result poller — runs every 5 seconds
  //   Checks pending FastTrade executions and resolves them
  // ══════════════════════════════════════════════════════════════════════════

  @Cron('*/5 * * * * *')
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

    await Promise.allSettled(
      pending.map(exec => this.resolveExecution(exec)),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRON 3: Daily cleanup
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
    // Skip if already placing/waiting for this session
    if (this.processingLock.has(session.id)) return;
    if (session.status === 'waiting_result') return;  // order in-flight, wait for result poller

    const tfSeconds = TIMEFRAME_SECONDS_MAP[session.timeframe];

    // Fire ONLY at or after the boundary — never before.
    // distanceToCandle <= 0 means boundary has passed, candle is confirmed closed.
    // Firing at distanceToCandle = 1 (1s early) would read a candle still forming.
    const distanceToCandle = session.nextCandleAt - nowSec;
    if (distanceToCandle > 0) return;

    // Lock this session
    this.processingLock.add(session.id);

    try {
      this.logger.log(
        `🕐 [${session.id.slice(-8)}] Candle boundary reached | ` +
        `Asset: ${session.assetSymbol} | TF: ${session.timeframe} | ` +
        `Step: ${session.currentStep} | Amount: ${session.currentAmount.toLocaleString('id-ID')}`,
      );

      // ── Phase 1: Read candle direction ──────────────────────────────────
      await this.fastTradeService.markReadingCandle(session.id);

      // Pass the exact candle timestamp we expect (the one that just closed).
      // getCandleDirection will query that key directly — instant, no blanket delay.
      const expectedCandleTs = session.nextCandleAt - tfSeconds;
      const { direction, candle } = await this.fastTradeService.getCandleDirection(
        session.assetId,
        session.timeframe,
        expectedCandleTs,
      );

      this.logger.log(
        `📊 [${session.id.slice(-8)}] Candle direction: ${direction.toUpperCase()} | ` +
        `Candle t=${candle?.t} O=${candle?.o} C=${candle?.c}`,
      );

      // Skip neutral — just reschedule
      if (direction === 'neutral') {
        this.logger.warn(
          `⚠️ [${session.id.slice(-8)}] Neutral candle — skipping this cycle`,
        );
        const nextCandleAt = this.fastTradeService.calcNextCandleBoundary(tfSeconds);
        await this.fastTradeService.markWaiting(session.id, nextCandleAt);

        // Log skipped execution — no binary direction for neutral candle
        await this.fastTradeService.saveExecution({
          sessionId:        session.id,
          userId:           session.userId,
          candleTimestamp:  candle?.t ?? nowSec,
          candleDirection:  direction,
          timeframe:        session.timeframe,
          direction:        'CALL',   // placeholder; candleDirection=neutral is the truth
          amount:           session.currentAmount,
          martingaleStep:   session.currentStep,
          accountType:      session.accountType,
          assetSymbol:      session.assetSymbol,
          assetId:          session.assetId,
          duration:         TIMEFRAME_DURATION_MAP[session.timeframe],
          status:           'skipped',
          profit:           0,
          placedAt:         this.now(),
        });
        return;
      }

      // ── Phase 2: Place order ────────────────────────────────────────────
      await this.fastTradeService.markPlacingOrder(session.id);

      const binaryDirection: 'CALL' | 'PUT' = direction === 'bullish' ? 'CALL' : 'PUT';

      const { orderId, entryPrice, executionId, error } = await this.placeBinaryOrder(
        session,
        binaryDirection,
        candle?.t ?? nowSec,
        direction,
      );

      if (error || !orderId) {
        // Order failed — reschedule for next candle
        this.logger.error(`❌ [${session.id.slice(-8)}] Order placement failed: ${error}`);
        const nextCandleAt = this.fastTradeService.calcNextCandleBoundary(tfSeconds);
        await this.fastTradeService.markWaiting(session.id, nextCandleAt);
        return;
      }

      // ── Phase 3: Mark waiting result (save direction for martingale retry) ──
      await this.fastTradeService.markWaitingResult(session.id, orderId, executionId!, binaryDirection);

      this.totalOrdersPlaced++;

      this.logger.log(
        `✅ [${session.id.slice(-8)}] Order placed: ${orderId.slice(-8)} | ` +
        `${binaryDirection} @ ${entryPrice} | Amount: ${session.currentAmount.toLocaleString('id-ID')} | ` +
        `Step: ${session.currentStep}`,
      );

      // Emit WebSocket update
      this.emitSessionUpdate(session);

    } catch (error) {
      this.logger.error(
        `❌ [${session.id.slice(-8)}] processTick error: ${error.message}`,
        error.stack,
      );
      // Try to recover by rescheduling
      try {
        const nextCandleAt = this.fastTradeService.calcNextCandleBoundary(tfSeconds);
        await this.fastTradeService.markWaiting(session.id, nextCandleAt);
      } catch {}
    } finally {
      this.processingLock.delete(session.id);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE: Place binary order (mirrors binary-orders.service pattern)
  // ══════════════════════════════════════════════════════════════════════════

  private async placeBinaryOrder(
    session: FastTradeSession,
    direction: 'CALL' | 'PUT',
    candleTimestamp: number,
    candleDirection: CandleDirection,
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
        const accountType = session.accountType as string as 'real' | 'demo';
        const duration    = TIMEFRAME_DURATION_MAP[session.timeframe];

        // ── 1. Check balance ──────────────────────────────────────────────
        const currentBalance = await this.balanceService.getCurrentBalanceStrict(
          session.userId,
          accountType,
        );

        if (currentBalance < amount) {
          const msg =
            `Saldo ${accountType} tidak cukup. ` +
            `Tersedia: Rp ${currentBalance.toLocaleString('id-ID')}, ` +
            `Dibutuhkan: Rp ${amount.toLocaleString('id-ID')}`;

          this.logger.warn(`⚠️ [${session.id.slice(-8)}] ${msg}`);

          // Log skipped execution
          const exec = await this.fastTradeService.saveExecution({
            sessionId:        session.id,
            userId:           session.userId,
            candleTimestamp,
            candleDirection,
            timeframe:        session.timeframe,
            direction,
            amount,
            martingaleStep:   session.currentStep,
            accountType:      session.accountType,
            assetSymbol:      session.assetSymbol,
            assetId:          session.assetId,
            duration,
            status:           'error',
            profit:           0,
            errorMessage:     msg,
            placedAt:         this.now(),
          });

          // Stop session if balance issue
          await this.fastTradeService.forceStopSession(session.id, msg);
          return { executionId: exec.id, error: msg };
        }

        // ── 2. Get asset data ─────────────────────────────────────────────
        const assetDoc = await this.db.collection(COLLECTIONS.ASSETS).doc(session.assetId).get();
        if (!assetDoc.exists) throw new Error(`Asset ${session.assetId} not found`);
        const asset = assetDoc.data() as any;

        // ── 3. Get realtime price ─────────────────────────────────────────
        let entryPrice = 0;
        try {
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(asset, true);
          if (priceData?.price) entryPrice = priceData.price;
        } catch (priceErr) {
          this.logger.warn(
            `⚠️ [${session.id.slice(-8)}] Price fetch failed, using fallback: ${priceErr.message}`,
          );
          entryPrice = asset.simulatorSettings?.currentPrice
            ?? asset.simulatorSettings?.initialPrice
            ?? 0;
        }

        if (!entryPrice) {
          throw new Error(`Cannot get entry price for ${asset.symbol}`);
        }

        // ── 4. Get user status & profit rate ─────────────────────────────
        const userStatus  = await this.userStatusService.getUserStatus(session.userId);
        const statusBonus = this.userStatusService.getProfitBonus(userStatus);
        const profitRate  = (asset.profitRate ?? 85) + statusBonus;

        // ── 5. Calculate expiry ───────────────────────────────────────────
        const entryTimestamp  = TimezoneUtil.getCurrentTimestamp();
        const expiryTimestamp = CalculationUtil.calculateExpiryTimestamp(entryTimestamp, duration);
        const entryDate       = TimezoneUtil.fromTimestamp(entryTimestamp);
        const expiryDate      = TimezoneUtil.fromTimestamp(expiryTimestamp);
        const entryInfo       = TimezoneUtil.getDateTimeInfo(entryDate);
        const expiryInfo      = TimezoneUtil.getDateTimeInfo(expiryDate);

        // ── 6. Create order in Firestore ──────────────────────────────────
        const orderId = await this.firebaseService.generateId(COLLECTIONS.ORDERS);

        const orderData = {
          id:            orderId,
          user_id:       session.userId,
          accountType,
          asset_id:      session.assetId,
          asset_name:    asset.name,
          asset_symbol:  asset.symbol,
          direction,
          amount,
          duration,
          entry_price:   entryPrice,
          entry_time:    entryInfo.datetime_iso,
          exit_price:    null,
          exit_time:     expiryInfo.datetime_iso,
          status:        ORDER_STATUS.ACTIVE,
          profit:        null,
          profitRate,
          baseProfitRate: asset.profitRate ?? 85,
          statusBonus,
          userStatus,
          metadata: {
            isFastTrade:       true,
            fastTradeSessionId: session.id,
            candleTimestamp,
            candleDirection,
            timeframe:         session.timeframe,
            martingaleStep:    session.currentStep,
            timezone:          'Asia/Jakarta',
          },
          createdAt: entryInfo.datetime_iso,
        };

        await this.db.collection(COLLECTIONS.ORDERS).doc(orderId).set(orderData);

        // ── 7. Debit balance ──────────────────────────────────────────────
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
          // Rollback order
          this.logger.error(
            `❌ [${session.id.slice(-8)}] Balance debit failed, rolling back: ${debitErr.message}`,
          );
          await this.db.collection(COLLECTIONS.ORDERS).doc(orderId).delete();
          throw new Error(`Balance debit failed: ${debitErr.message}`);
        }

        this.balanceService.clearUserCache(session.userId);

        // ── 8. Save execution log ─────────────────────────────────────────
        const exec = await this.fastTradeService.saveExecution({
          sessionId:       session.id,
          userId:          session.userId,
          candleTimestamp,
          candleDirection,
          timeframe:       session.timeframe,
          orderId,
          direction,
          amount,
          martingaleStep:  session.currentStep,
          accountType:     session.accountType,
          assetSymbol:     session.assetSymbol,
          assetId:         session.assetId,
          duration,
          status:          'placed',
          profit:          0,
          entryPrice,
          placedAt:        this.now(),
        });

        return { orderId, entryPrice, executionId: exec.id };

      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1;
        this.logger.error(
          `❌ [${session.id.slice(-8)}] placeBinaryOrder attempt ${attempt + 1}/${maxRetries}: ${error.message}`,
        );

        if (!isLastAttempt) {
          await this.sleep(2000 * Math.pow(2, attempt));
          continue;
        }

        // All attempts failed — save error execution
        try {
          const exec = await this.fastTradeService.saveExecution({
            sessionId:       session.id,
            userId:          session.userId,
            candleTimestamp,
            candleDirection,
            timeframe:       session.timeframe,
            direction,
            amount:          session.currentAmount,
            martingaleStep:  session.currentStep,
            accountType:     session.accountType,
            assetSymbol:     session.assetSymbol,
            assetId:         session.assetId,
            duration:        TIMEFRAME_DURATION_MAP[session.timeframe],
            status:          'error',
            profit:          0,
            errorMessage:    error.message,
            placedAt:        this.now(),
          });
          return { executionId: exec.id, error: error.message };
        } catch {}

        return { error: error.message };
      }
    }

    return { error: 'All retries exhausted' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE: Resolve a pending execution (check binary order result)
  // ══════════════════════════════════════════════════════════════════════════

  private async resolveExecution(exec: FastTradeExecution): Promise<void> {
    if (!exec.orderId) return;
    if (this.pollingLock.has(exec.id)) return;

    this.pollingLock.add(exec.id);

    try {
      // ── Fetch order from Firestore ──────────────────────────────────────
      const orderDoc = await this.db.collection(COLLECTIONS.ORDERS).doc(exec.orderId).get();

      if (!orderDoc.exists) {
        // Stale — mark error
        await this.fastTradeService.updateExecution(exec.id, {
          status:       'error',
          errorMessage: 'Binary order not found',
        });
        // Reschedule session
        await this.rescheduleSession(exec.sessionId);
        return;
      }

      const order = orderDoc.data() as any;

      // Still active — wait for next poll
      if (order.status === ORDER_STATUS.ACTIVE) {
        const expiryTs = TimezoneUtil.toTimestamp(new Date(order.exit_time));
        const nowSec   = TimezoneUtil.getCurrentTimestamp();
        const remaining = expiryTs - nowSec;
        this.logger.debug(
          `⏳ [${exec.sessionId.slice(-8)}] Order ${exec.orderId.slice(-8)} still ACTIVE (${remaining}s remaining)`,
        );
        return;
      }

      // ── Settled ─────────────────────────────────────────────────────────
      const result: 'won' | 'lost' =
        order.status === ORDER_STATUS.WON ? 'won' : 'lost';

      const settledProfit = order.profit ?? 0;   // positive for win (platform profit amount)
      const profitRate    = order.profitRate ?? 85;
      const finalAmount   = result === 'won'
        ? Math.round(exec.amount * (profitRate / 100))
        : exec.amount;

      // Update execution log
      const settledAt = this.now();
      await this.fastTradeService.updateExecution(exec.id, {
        status:     result,
        profit:     result === 'won' ? finalAmount : -exec.amount,
        exitPrice:  order.exit_price ?? undefined,
        settledAt,
      });

      // ── Credit balance (only for WIN — debit already done at placement) ──
      if (result === 'won') {
        try {
          await this.balanceService.createBalanceEntry(
            exec.userId,
            {
              accountType: exec.accountType as 'real' | 'demo',
              type:        BALANCE_TYPES.ORDER_PROFIT,
              amount:      exec.amount + finalAmount,   // return stake + profit
              description: `[FastTrade] WIN ${exec.assetSymbol} ${exec.direction} ` +
                           `#${exec.orderId!.slice(-8)} (+${finalAmount.toLocaleString('id-ID')})`,
            },
            true,
          );
          this.balanceService.clearUserCache(exec.userId);
        } catch (creditErr) {
          this.logger.error(
            `❌ [${exec.sessionId.slice(-8)}] Balance credit failed for WIN: ${creditErr.message}`,
          );
        }
      }

      // ── Update session state ─────────────────────────────────────────────
      const session = await this.fastTradeService.getSessionById(exec.sessionId);
      if (!session.isActive) {
        this.logger.warn(
          `⚠️ [${exec.sessionId.slice(-8)}] Session already stopped — skipping state update`,
        );
        return;
      }

      const tfSeconds = TIMEFRAME_SECONDS_MAP[session.timeframe];
      const { shouldStop, stopReason, session: updated, isMartingaleRetry, retryDirection } =
        await this.fastTradeService.applyOrderResult(
          exec.sessionId,
          result,
          finalAmount,
          exec.candleTimestamp,
          tfSeconds,
        );

      // Stats
      if (result === 'won') this.totalWins++;
      else                   this.totalLosses++;

      this.logger.log(
        `${result === 'won' ? '✅ WIN' : '❌ LOSS'} ` +
        `[${exec.sessionId.slice(-8)}] ` +
        `${exec.assetSymbol} ${exec.direction} | ` +
        `Amount: ${exec.amount.toLocaleString('id-ID')} | ` +
        `${result === 'won' ? '+' : '-'}${result === 'won' ? finalAmount : exec.amount} | ` +
        `Step: ${exec.martingaleStep} | ` +
        `TotalPnL: ${updated.totalPnL.toLocaleString('id-ID')}`,
      );

      // ── Emit WebSocket ────────────────────────────────────────────────────
      this.emitOrderSettled(exec.userId, exec.orderId!, result, settledProfit);
      this.emitSessionUpdate(updated);

      if (shouldStop) {
        this.logger.log(
          `🏁 [${exec.sessionId.slice(-8)}] Session completed: ${stopReason}`,
        );
        return;
      }

      // ── Martingale retry: immediately place order in SAME direction ────────
      // (no candle read — direction follows the original losing trade)
      if (isMartingaleRetry && retryDirection) {
        this.logger.log(
          `🔄 [${exec.sessionId.slice(-8)}] Martingale retry step ${updated.currentStep} | ` +
          `Direction: ${retryDirection} (same as losing trade) | ` +
          `Amount: ${updated.currentAmount.toLocaleString('id-ID')}`,
        );

        try {
          await this.fastTradeService.markPlacingOrder(exec.sessionId);

          const { orderId: newOrderId, entryPrice: newEntry, executionId: newExecId, error: retryError } =
            await this.placeBinaryOrder(
              updated,            // session now has updated currentStep + currentAmount
              retryDirection,     // SAME direction as the losing order
              exec.candleTimestamp,
              exec.candleDirection,
            );

          if (retryError || !newOrderId) {
            this.logger.error(`❌ [${exec.sessionId.slice(-8)}] Martingale retry failed: ${retryError}`);
            await this.rescheduleSession(exec.sessionId);
            return;
          }

          await this.fastTradeService.markWaitingResult(
            exec.sessionId,
            newOrderId,
            newExecId!,
            retryDirection,   // keep tracking direction for further martingale
          );

          this.totalOrdersPlaced++;
          this.logger.log(
            `✅ [${exec.sessionId.slice(-8)}] Martingale order placed: ${newOrderId.slice(-8)} | ` +
            `${retryDirection} @ ${newEntry} | Step: ${updated.currentStep}`,
          );
          this.emitSessionUpdate(updated);
        } catch (retryErr) {
          this.logger.error(`❌ Martingale retry error: ${retryErr.message}`);
          await this.rescheduleSession(exec.sessionId);
        }
        return;
      }

    } catch (error) {
      this.logger.error(
        `❌ resolveExecution error [${exec.id.slice(-8)}]: ${error.message}`,
        error.stack,
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
        type:      'fast_trade_session_update',
        sessionId: (session as FastTradeSession).id,
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
        source: 'fast_trade',
      });
    } catch {}
  }

  private now(): string {
    return TimezoneUtil.toISOString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MONITORING
  // ══════════════════════════════════════════════════════════════════════════

  getStats() {
    return {
      totalCycles:         this.totalCycles,
      totalOrdersPlaced:   this.totalOrdersPlaced,
      totalWins:           this.totalWins,
      totalLosses:         this.totalLosses,
      winRate:             this.totalOrdersPlaced > 0
        ? ((this.totalWins / this.totalOrdersPlaced) * 100).toFixed(1) + '%'
        : 'N/A',
      activeProcessingLocks: this.processingLock.size,
      activePollingLocks:    this.pollingLock.size,
      cronInterval:          '2s (candle tick) + 5s (result poll)',
    };
  }
}