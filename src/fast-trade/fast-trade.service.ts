// src/fast-trade/fast-trade.service.ts

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { FieldValue } from '@google-cloud/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { TimezoneUtil } from '../common/utils';
import {
  CreateFastTradeDto,
  FastTradeTimeframe,
  FastTradeAccountType,
  TIMEFRAME_SECONDS_MAP,
} from './dto/create-fast-trade.dto';
import {
  FastTradeSession,
  FastTradeExecution,
  OhlcCandle,
  CandleDirection,
  FastTradeSessionStatus,
} from './interfaces/fast-trade.interface';

// ── Collection names ───────────────────────────────────────────────────────
const COL_SESSIONS   = 'fast_trade_sessions';
const COL_EXECUTIONS = 'fast_trade_executions';
const COL_ASSETS     = 'assets';

@Injectable()
export class FastTradeService {
  private readonly logger = new Logger(FastTradeService.name);

  // In-memory cache — avoids Firestore reads on every cron tick
  private sessionCache: Map<string, FastTradeSession> = new Map();

  constructor(private readonly firebaseService: FirebaseService) {
    this.logger.log('✅ FastTradeService initialized');
    // Cleanup cache every 5 min
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Getters
  // ──────────────────────────────────────────────────────────────────────────

  private get db() {
    return this.firebaseService.getFirestore();
  }

  private get rtdb(): admin.database.Database {
    return admin.database();
  }

  private now(): string {
    return TimezoneUtil.toISOString();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. CREATE SESSION
  // ──────────────────────────────────────────────────────────────────────────

  async createSession(
    userId: string,
    userEmail: string,
    dto: CreateFastTradeDto,
  ): Promise<FastTradeSession> {
    // Only 1 active session per user
    const existing = await this.getUserActiveSession(userId);
    if (existing) {
      throw new ConflictException(
        `Sudah ada sesi FastTrade aktif (${existing.id}). ` +
        `Stop dulu sebelum membuat yang baru.`,
      );
    }

    // Validate asset
    const assetDoc = await this.db.collection(COL_ASSETS).doc(dto.assetId).get();
    if (!assetDoc.exists) {
      throw new NotFoundException(`Aset ${dto.assetId} tidak ditemukan`);
    }

    const asset = assetDoc.data() as any;
    if (!asset.isActive) {
      throw new BadRequestException(`Aset ${asset.symbol} tidak aktif`);
    }

    if (!asset.realtimeDbPath) {
      throw new BadRequestException(
        `Aset ${asset.symbol} tidak memiliki realtimeDbPath. ` +
        `Data OHLC tidak tersedia untuk FastTrade.`,
      );
    }

    // Validate timeframe duration is supported by this asset
    // (some assets may restrict certain durations)
    const tfSeconds  = TIMEFRAME_SECONDS_MAP[dto.timeframe];
    const nextCandle = this.calcNextCandleBoundary(tfSeconds);
    const sessionId  = uuidv4();
    const ts         = this.now();

    const session: FastTradeSession = {
      id: sessionId,
      userId,
      userEmail,

      assetId:     dto.assetId,
      assetSymbol: asset.symbol,
      assetName:   asset.name,
      timeframe:   dto.timeframe,
      accountType: dto.accountType,
      baseAmount:  dto.amount,

      martingaleEnabled:    dto.martingale.enabled,
      martingaleMaxStep:    dto.martingale.maxStep,
      martingaleMultiplier: dto.martingale.multiplier,

      stopProfit: dto.stopProfit,
      stopLoss:   dto.stopLoss,

      status:   'waiting',
      isActive: true,

      currentStep:       0,
      currentAmount:     dto.amount,
      consecutiveLosses: 0,

      totalPnL:    0,
      totalProfit: 0,
      totalLoss:   0,
      wins:        0,
      losses:      0,
      totalOrders: 0,

      nextCandleAt: nextCandle,
      startedAt:    ts,
      createdAt:    ts,
      updatedAt:    ts,
    };

    await this.db.collection(COL_SESSIONS).doc(sessionId).set(session);
    this.sessionCache.set(sessionId, session);

    this.logger.log(
      `✅ FastTrade session created: ${sessionId.slice(-8)} | ` +
      `User: ${userEmail} | Asset: ${asset.symbol} | TF: ${dto.timeframe} | ` +
      `Amount: ${dto.amount.toLocaleString('id-ID')} | ` +
      `Martingale: ${dto.martingale.enabled ? `ON (max ${dto.martingale.maxStep} steps ×${dto.martingale.multiplier})` : 'OFF'} | ` +
      `NextCandle: ${new Date(nextCandle * 1000).toISOString()}`,
    );

    return session;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. STOP SESSION
  // ──────────────────────────────────────────────────────────────────────────

  async stopSession(
    userId: string,
    sessionId: string,
    reason = 'Dihentikan manual oleh user',
  ): Promise<FastTradeSession> {
    const session = await this.getAndVerifyOwner(userId, sessionId);

    if (!session.isActive) {
      throw new BadRequestException('Sesi sudah dalam keadaan berhenti');
    }

    return this.forceStopSession(sessionId, reason, session);
  }

  async forceStopSession(
    sessionId: string,
    reason: string,
    cachedSession?: FastTradeSession,
  ): Promise<FastTradeSession> {
    const session = cachedSession ?? this.sessionCache.get(sessionId);
    const ts = this.now();

    const updates: Partial<FastTradeSession> = {
      isActive:   false,
      status:     'stopped',
      stopReason: reason,
      stoppedAt:  ts,
      updatedAt:  ts,
    };

    await this.db.collection(COL_SESSIONS).doc(sessionId).update(updates);
    const updated = session ? { ...session, ...updates } : updates as FastTradeSession;
    this.sessionCache.set(sessionId, updated as FastTradeSession);
    this.logger.log(`🛑 FastTrade session stopped: ${sessionId.slice(-8)} | Reason: ${reason}`);
    return updated as FastTradeSession;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. GET ONE SESSION
  // ──────────────────────────────────────────────────────────────────────────

  async getSession(userId: string, sessionId: string): Promise<FastTradeSession> {
    return this.getAndVerifyOwner(userId, sessionId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. GET ALL USER SESSIONS
  // ──────────────────────────────────────────────────────────────────────────

  async getUserSessions(userId: string, activeOnly = false): Promise<FastTradeSession[]> {
    let q = this.db
      .collection(COL_SESSIONS)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(50) as FirebaseFirestore.Query;

    if (activeOnly) {
      q = q.where('isActive', '==', true);
    }

    const snap = await q.get();
    return snap.docs.map(d => d.data() as FastTradeSession);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. GET ACTIVE SESSION (single)
  // ──────────────────────────────────────────────────────────────────────────

  async getUserActiveSession(userId: string): Promise<FastTradeSession | null> {
    const snap = await this.db
      .collection(COL_SESSIONS)
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    return snap.empty ? null : (snap.docs[0].data() as FastTradeSession);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. GET ALL ACTIVE SESSIONS  (called by executor)
  // ──────────────────────────────────────────────────────────────────────────

  async getAllActiveSessions(): Promise<FastTradeSession[]> {
    const snap = await this.db
      .collection(COL_SESSIONS)
      .where('isActive', '==', true)
      .get();

    const sessions = snap.docs.map(d => {
      const s = d.data() as FastTradeSession;
      this.sessionCache.set(s.id, s);
      return s;
    });

    return sessions;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. GET EXECUTIONS
  // ──────────────────────────────────────────────────────────────────────────

  async getExecutions(
    userId: string,
    sessionId: string,
    limit = 50,
  ): Promise<FastTradeExecution[]> {
    await this.getAndVerifyOwner(userId, sessionId);

    const snap = await this.db
      .collection(COL_EXECUTIONS)
      .where('sessionId', '==', sessionId)
      .orderBy('createdAt', 'desc')
      .limit(Math.min(limit, 200))
      .get();

    return snap.docs.map(d => d.data() as FastTradeExecution);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. READ OHLC — get last completed candle direction
  // ──────────────────────────────────────────────────────────────────────────

  async getCandleDirection(
    assetId: string,
    timeframe: FastTradeTimeframe,
    expectedCandleTs?: number,  // unix seconds of candle to read (nextCandleAt - tfSeconds)
  ): Promise<{ direction: CandleDirection; candle: OhlcCandle | null }> {
    try {
      const assetDoc = await this.db.collection(COL_ASSETS).doc(assetId).get();
      if (!assetDoc.exists) throw new Error(`Asset ${assetId} not found`);

      const asset    = assetDoc.data() as any;
      const rtpRaw   = asset.realtimeDbPath as string;
      const rtPath   = rtpRaw.startsWith('/') ? rtpRaw : `/${rtpRaw}`;
      const ohlcPath = `${rtPath}/ohlc_${timeframe}`;

      const parseCandle = (key: string, v: any): OhlcCandle | null => {
        const open  = v?.o ?? v?.open;
        const high  = v?.h ?? v?.high;
        const low   = v?.l ?? v?.low;
        const close = v?.c ?? v?.close;
        if (typeof open !== 'number' || typeof close !== 'number') return null;
        return {
          t: parseInt(key, 10),
          o: open,
          h: high ?? open,
          l: low  ?? open,
          c: close,
          v: v?.v ?? v?.volume ?? 0,
        };
      };

      const directionOf = (candle: OhlcCandle): CandleDirection => {
        const diff      = candle.c - candle.o;
        const threshold = candle.o * 0.000001;
        if      (diff >  threshold) return 'bullish';
        else if (diff < -threshold) return 'bearish';
        else                        return 'neutral';
      };

      // ── Strategy 1: query exact timestamp (instant, no delay needed) ──────
      // We know exactly which candle just closed: the one that started at
      // (nextCandleAt - tfSeconds). Query that key directly.
      if (expectedCandleTs) {
        const MAX_ATTEMPTS = 4;
        const RETRY_MS     = 300; // retry every 300ms if simulator hasn't written yet

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const snap = await this.rtdb
            .ref(`${ohlcPath}/${expectedCandleTs}`)
            .once('value');

          if (snap.exists()) {
            const candle = parseCandle(String(expectedCandleTs), snap.val());
            if (candle) {
              const direction = directionOf(candle);
              this.logger.debug(
                `📊 [exact-key] ${asset.symbol}/${timeframe} ` +
                `t=${candle.t} O:${candle.o} C:${candle.c} → ${direction.toUpperCase()} ` +
                `(attempt ${attempt + 1})`,
              );
              return { direction, candle };
            }
          }

          if (attempt < MAX_ATTEMPTS - 1) {
            this.logger.debug(
              `⏳ Candle t=${expectedCandleTs} not yet in RTDB, retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${RETRY_MS}ms`,
            );
            await new Promise(r => setTimeout(r, RETRY_MS));
          }
        }

        this.logger.warn(
          `⚠️ Exact candle t=${expectedCandleTs} not found after ${MAX_ATTEMPTS} attempts — falling back to limitToLast`,
        );
      }

      // ── Strategy 2: fallback — limitToLast(2), use most recent closed bar ──
      const snapshot = await this.rtdb
        .ref(ohlcPath)
        .orderByKey()
        .limitToLast(2)
        .once('value');

      if (!snapshot.exists()) {
        this.logger.warn(`⚠️ No OHLC data at ${ohlcPath}`);
        return { direction: 'neutral', candle: null };
      }

      const candles: OhlcCandle[] = [];
      snapshot.forEach(child => {
        const c = parseCandle(child.key!, child.val());
        if (c) candles.push(c);
      });

      candles.sort((a, b) => a.t - b.t);

      if (candles.length < 1) {
        this.logger.warn(`⚠️ Not enough OHLC bars for ${asset.symbol}/${timeframe}`);
        return { direction: 'neutral', candle: null };
      }

      const lastCompleted = candles[candles.length - 1];
      const direction     = directionOf(lastCompleted);

      this.logger.debug(
        `📊 [limitToLast] ${asset.symbol}/${timeframe} ` +
        `t=${lastCompleted.t} O:${lastCompleted.o} C:${lastCompleted.c} → ${direction.toUpperCase()}`,
      );

      return { direction, candle: lastCompleted };
    } catch (error) {
      this.logger.error(`❌ getCandleDirection error: ${error.message}`);
      return { direction: 'neutral', candle: null };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 9. GET OHLC DATA (for REST endpoint /assets/:id/ohlc)
  // ──────────────────────────────────────────────────────────────────────────

  async getOhlcData(
    assetId: string,
    timeframe: string,
    limit: number,
  ): Promise<{
    assetId: string;
    timeframe: string;
    candles: OhlcCandle[];
    lastCompleted: OhlcCandle | null;
    direction: CandleDirection;
  }> {
    const VALID_TF = ['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    if (!VALID_TF.includes(timeframe)) {
      throw new BadRequestException(`Timeframe tidak valid: ${timeframe}. Pilihan: ${VALID_TF.join(', ')}`);
    }

    const assetDoc = await this.db.collection(COL_ASSETS).doc(assetId).get();
    if (!assetDoc.exists) throw new NotFoundException(`Aset ${assetId} tidak ditemukan`);

    const asset   = assetDoc.data() as any;
    const rtpRaw  = asset.realtimeDbPath as string;
    const rtPath  = rtpRaw.startsWith('/') ? rtpRaw : `/${rtpRaw}`;
    const safeLimit = Math.min(Math.max(Number(limit) || 5, 2), 50);
    const ohlcPath  = `${rtPath}/ohlc_${timeframe}`;

    const snapshot = await this.rtdb
      .ref(ohlcPath)
      .orderByKey()
      .limitToLast(safeLimit + 1)
      .once('value');

    const candles: OhlcCandle[] = [];
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const v = child.val();
        if (v && typeof v.o === 'number') {
          candles.push({
            t: parseInt(child.key!, 10),
            o: v.o,
            h: v.h,
            l: v.l,
            c: v.c,
            v: v.v || 0,
          });
        }
      });
    }

    candles.sort((a, b) => a.t - b.t);
    const trimmed = candles.slice(-safeLimit);

    let lastCompleted: OhlcCandle | null = null;
    let direction: CandleDirection = 'neutral';

    if (trimmed.length >= 2) {
      lastCompleted = trimmed[trimmed.length - 2];
      direction     = lastCompleted.c > lastCompleted.o ? 'bullish'
                    : lastCompleted.c < lastCompleted.o ? 'bearish'
                    : 'neutral';
    }

    return { assetId, timeframe, candles: trimmed, lastCompleted, direction };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 10. UPDATE SESSION AFTER ORDER RESULT  (called by executor)
  // ──────────────────────────────────────────────────────────────────────────

  async applyOrderResult(
    sessionId: string,
    result: 'won' | 'lost',
    settledAmount: number,   // final profit or loss amount (always positive)
    candleTimestamp: number,
    tfSeconds: number,
  ): Promise<{ session: FastTradeSession; shouldStop: boolean; stopReason?: string; isMartingaleRetry: boolean; retryDirection?: 'CALL' | 'PUT' }> {
    const session = await this.getSessionById(sessionId);

    let {
      currentStep,
      currentAmount,
      consecutiveLosses,
      totalPnL,
      totalProfit,
      totalLoss,
      wins,
      losses,
      totalOrders,
      baseAmount,
      martingaleEnabled,
      martingaleMaxStep,
      martingaleMultiplier,
      stopProfit,
      stopLoss,
      lastDirection,
    } = session;

    totalOrders++;

    // Track whether this loss triggers an immediate martingale retry
    let isMartingaleRetry = false;
    let retryDirection: 'CALL' | 'PUT' | undefined;

    if (result === 'won') {
      wins++;
      totalProfit       += settledAmount;
      totalPnL          += settledAmount;
      // Reset martingale — next cycle reads fresh candle
      currentStep        = 0;
      consecutiveLosses  = 0;
      currentAmount      = baseAmount;
    } else {
      // lost
      losses++;
      totalLoss         += currentAmount;
      totalPnL          -= currentAmount;
      consecutiveLosses++;

      if (martingaleEnabled) {
        if (currentStep < martingaleMaxStep) {
          currentStep++;
          currentAmount = Math.round(baseAmount * Math.pow(martingaleMultiplier, currentStep));
          this.logger.log(
            `📈 [${sessionId.slice(-8)}] Martingale step up: ${currentStep - 1} → ${currentStep} | ` +
            `Amount: ${(Math.round(baseAmount * Math.pow(martingaleMultiplier, currentStep - 1))).toLocaleString('id-ID')} → ` +
            `${currentAmount.toLocaleString('id-ID')}`,
          );
          // Flag: executor must immediately retry with SAME direction — no candle read
          isMartingaleRetry = true;
          retryDirection    = lastDirection;  // same direction as the losing order
        } else {
          // Max step reached — reset and wait for next fresh candle
          this.logger.warn(
            `⚠️ [${sessionId.slice(-8)}] Martingale MAX step ${martingaleMaxStep} reached — resetting to normal`,
          );
          currentStep        = 0;
          consecutiveLosses  = 0;
          currentAmount      = baseAmount;
        }
      }
    }

    // Calc next candle (used when NOT doing martingale retry)
    const nextCandleAt = this.calcNextCandleBoundary(tfSeconds);

    // Check stop conditions
    let shouldStop  = false;
    let stopReason: string | undefined;
    let newStatus: FastTradeSessionStatus = 'waiting';
    let isActive = true;
    let stoppedAt: string | undefined;

    if (stopProfit && totalPnL >= stopProfit) {
      shouldStop  = true;
      stopReason  = `Stop profit tercapai: +Rp ${totalPnL.toLocaleString('id-ID')}`;
      newStatus   = 'completed';
      isActive    = false;
      stoppedAt   = this.now();
      this.logger.log(`🎯 [${sessionId.slice(-8)}] Stop profit triggered at ${totalPnL}`);
    } else if (stopLoss && totalPnL <= -(Math.abs(stopLoss))) {
      shouldStop  = true;
      stopReason  = `Stop loss tercapai: -Rp ${Math.abs(totalPnL).toLocaleString('id-ID')}`;
      newStatus   = 'completed';
      isActive    = false;
      stoppedAt   = this.now();
      this.logger.log(`🛑 [${sessionId.slice(-8)}] Stop loss triggered at ${totalPnL}`);
    }

    const ts = this.now();
    const updates: Partial<FastTradeSession> = {
      currentStep,
      currentAmount,
      consecutiveLosses,
      totalPnL,
      totalProfit,
      totalLoss,
      wins,
      losses,
      totalOrders,
      pendingOrderId:      undefined,
      pendingOrderPlacedAt: undefined,
      pendingExecutionId:  undefined,
      lastCandleTimestamp: candleTimestamp,
      nextCandleAt,
      status:     newStatus,
      isActive,
      stopReason,
      stoppedAt,
      updatedAt:  ts,
    };

    await this.db.collection(COL_SESSIONS).doc(sessionId).update(updates);
    const updated = { ...session, ...updates } as FastTradeSession;
    this.sessionCache.set(sessionId, updated);

    return { session: updated, shouldStop, stopReason, isMartingaleRetry, retryDirection };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 11. STATUS TRANSITIONS  (called by executor)
  // ──────────────────────────────────────────────────────────────────────────

  async markReadingCandle(sessionId: string): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({
      status: 'reading_candle',
      updatedAt: ts,
    });
    const c = this.sessionCache.get(sessionId);
    if (c) { c.status = 'reading_candle'; c.updatedAt = ts; }
  }

  async markPlacingOrder(sessionId: string): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({
      status: 'placing_order',
      updatedAt: ts,
    });
    const c = this.sessionCache.get(sessionId);
    if (c) { c.status = 'placing_order'; c.updatedAt = ts; }
  }

  async markWaitingResult(
    sessionId: string,
    orderId: string,
    executionId: string,
    direction?: 'CALL' | 'PUT',
  ): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({
      status:              'waiting_result',
      pendingOrderId:      orderId,
      pendingOrderPlacedAt: ts,
      pendingExecutionId:  executionId,
      ...(direction ? { lastDirection: direction } : {}),
      updatedAt:           ts,
    });
    const c = this.sessionCache.get(sessionId);
    if (c) {
      c.status              = 'waiting_result';
      c.pendingOrderId      = orderId;
      c.pendingOrderPlacedAt = ts;
      c.pendingExecutionId  = executionId;
      c.updatedAt           = ts;
    }
  }

  async markWaiting(sessionId: string, nextCandleAt: number): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({
      status: 'waiting',
      nextCandleAt,
      pendingOrderId:      undefined,
      pendingOrderPlacedAt: undefined,
      pendingExecutionId:  undefined,
      updatedAt: ts,
    });
    const c = this.sessionCache.get(sessionId);
    if (c) {
      c.status              = 'waiting';
      c.nextCandleAt        = nextCandleAt;
      c.pendingOrderId      = undefined;
      c.pendingOrderPlacedAt = undefined;
      c.pendingExecutionId  = undefined;
      c.updatedAt           = ts;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 12. EXECUTION LOG CRUD  (called by executor)
  // ──────────────────────────────────────────────────────────────────────────

  async saveExecution(
    data: Omit<FastTradeExecution, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<FastTradeExecution> {
    const id = uuidv4();
    const ts = this.now();
    const full: FastTradeExecution = { ...data, id, createdAt: ts, updatedAt: ts };
    await this.db.collection(COL_EXECUTIONS).doc(id).set(full);
    return full;
  }

  async updateExecution(execId: string, updates: Partial<FastTradeExecution>): Promise<void> {
    await this.db.collection(COL_EXECUTIONS).doc(execId).update({
      ...updates,
      updatedAt: this.now(),
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 13. PENDING EXECUTIONS  (for result polling by executor)
  // ──────────────────────────────────────────────────────────────────────────

  async getPendingExecutions(): Promise<FastTradeExecution[]> {
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

    const snap = await this.db
      .collection(COL_EXECUTIONS)
      .where('status', '==', 'placed')
      .where('createdAt', '>=', twoHoursAgo.toISOString())
      .limit(100)
      .get();

    return snap.docs.map(d => d.data() as FastTradeExecution);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  private async getAndVerifyOwner(userId: string, sessionId: string): Promise<FastTradeSession> {
    const session = await this.getSessionById(sessionId);
    if (session.userId !== userId) {
      throw new BadRequestException('Anda bukan pemilik sesi ini');
    }
    return session;
  }

  async getSessionById(sessionId: string): Promise<FastTradeSession> {
    let session = this.sessionCache.get(sessionId);
    if (!session) {
      const doc = await this.db.collection(COL_SESSIONS).doc(sessionId).get();
      if (!doc.exists) throw new NotFoundException(`Sesi ${sessionId} tidak ditemukan`);
      session = doc.data() as FastTradeSession;
      this.sessionCache.set(sessionId, session);
    }
    return session;
  }

  /**
   * Returns unix timestamp (seconds) of the NEXT candle boundary.
   * e.g. 1m at 12:22:45 → 12:23:00
   */
  calcNextCandleBoundary(tfSeconds: number): number {
    const nowSec    = TimezoneUtil.getCurrentTimestamp();
    const intoCandle = nowSec % tfSeconds;
    const remaining  = tfSeconds - intoCandle;
    return nowSec + remaining;
  }

  evictSessionCache(sessionId: string): void {
    this.sessionCache.delete(sessionId);
  }

  private cleanupCache(): void {
    for (const [id, s] of this.sessionCache.entries()) {
      if (!s.isActive) this.sessionCache.delete(id);
    }
    this.logger.debug(`🧹 Session cache cleaned. Remaining: ${this.sessionCache.size}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN — cleanup old data
  // ──────────────────────────────────────────────────────────────────────────

  async cleanupOldExecutions(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const snap = await this.db
      .collection(COL_EXECUTIONS)
      .where('createdAt', '<', thirtyDaysAgo.toISOString())
      .limit(500)
      .get();

    if (snap.empty) return 0;

    const batch = this.db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    this.logger.log(`🧹 Deleted ${snap.size} old FastTrade executions`);
    return snap.size;
  }
}