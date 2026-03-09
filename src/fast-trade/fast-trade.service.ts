// src/fast-trade/fast-trade.service.ts
// ✅ OPTIMIZED: activeSessionRegistry menggantikan query Firestore tiap tick
//   - onModuleInit: hydrate registry sekali dari Firestore
//   - createSession: register ke memory
//   - forceStopSession: unregister dari memory
//   - getAllActiveSessions: return dari memory — ZERO Firestore read
//   - getPendingExecutions: direct doc get per pendingExecutionId — bukan full collection scan

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
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
export class FastTradeService implements OnModuleInit {
  private readonly logger = new Logger(FastTradeService.name);

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ IN-MEMORY ACTIVE SESSION REGISTRY
  //
  // Lifecycle:
  //   onModuleInit    → hydrate dari Firestore (sekali saja)
  //   createSession   → tambah ke registry
  //   forceStopSession→ hapus dari registry
  //   getAllActiveSessions → return dari registry (ZERO Firestore read)
  //   getPendingExecutions→ iterasi registry, direct doc get per executionId
  // ─────────────────────────────────────────────────────────────────────────
  private activeSessionRegistry: Map<string, FastTradeSession> = new Map();

  // sessionCache tetap ada untuk getSessionById
  private sessionCache: Map<string, FastTradeSession> = new Map();

  constructor(private readonly firebaseService: FirebaseService) {
    this.logger.log('✅ FastTradeService initialized');
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Getters
  // ──────────────────────────────────────────────────────────────────────────

  private get db() { return this.firebaseService.getFirestore(); }
  private get rtdb(): admin.database.Database { return admin.database(); }
  private now(): string { return TimezoneUtil.toISOString(); }

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ MODULE INIT — hydrate registry dari Firestore (sekali saja)
  // ─────────────────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.hydrateRegistry();
  }

  private async hydrateRegistry(): Promise<void> {
    try {
      this.logger.log('🔄 Hydrating FastTrade activeSessionRegistry from Firestore...');

      const snap = await this.db
        .collection(COL_SESSIONS)
        .where('isActive', '==', true)
        .get();

      this.activeSessionRegistry.clear();

      snap.docs.forEach(doc => {
        const session = doc.data() as FastTradeSession;
        this.activeSessionRegistry.set(session.id, session);
        this.sessionCache.set(session.id, session);
      });

      this.logger.log(
        `✅ FastTrade registry hydrated: ${this.activeSessionRegistry.size} active sessions`,
      );
    } catch (error) {
      this.logger.error(`❌ Failed to hydrate FastTrade registry: ${error.message}`);
    }
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
    if (!assetDoc.exists) throw new NotFoundException(`Aset ${dto.assetId} tidak ditemukan`);

    const asset = assetDoc.data() as any;
    if (!asset.isActive) throw new BadRequestException(`Aset ${asset.symbol} tidak aktif`);

    if (!asset.realtimeDbPath) {
      throw new BadRequestException(
        `Aset ${asset.symbol} tidak memiliki realtimeDbPath. ` +
        `Data OHLC tidak tersedia untuk FastTrade.`,
      );
    }

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

    // ✅ Register ke kedua cache
    this.activeSessionRegistry.set(sessionId, session);
    this.sessionCache.set(sessionId, session);

    this.logger.log(
      `✅ FastTrade session created: ${sessionId.slice(-8)} | ` +
      `User: ${userEmail} | Asset: ${asset.symbol} | TF: ${dto.timeframe} | ` +
      `Amount: ${dto.amount.toLocaleString('id-ID')} | ` +
      `Martingale: ${dto.martingale.enabled
        ? `ON (max ${dto.martingale.maxStep} steps ×${dto.martingale.multiplier})`
        : 'OFF'} | ` +
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
    if (!session.isActive) throw new BadRequestException('Sesi sudah dalam keadaan berhenti');
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

    // ✅ Hapus dari activeSessionRegistry — executor tidak akan proses lagi
    this.activeSessionRegistry.delete(sessionId);
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

    if (activeOnly) q = q.where('isActive', '==', true);

    const snap = await q.get();
    return snap.docs.map(d => d.data() as FastTradeSession);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. GET ACTIVE SESSION (single)
  // ──────────────────────────────────────────────────────────────────────────

  async getUserActiveSession(userId: string): Promise<FastTradeSession | null> {
    // ✅ Cek registry dulu sebelum ke Firestore
    for (const session of this.activeSessionRegistry.values()) {
      if (session.userId === userId) return session;
    }

    // Fallback ke Firestore (edge case: race condition saat startup)
    const snap = await this.db
      .collection(COL_SESSIONS)
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (snap.empty) return null;

    const session = snap.docs[0].data() as FastTradeSession;
    // Sync ke registry jika ditemukan di Firestore tapi tidak ada di memory
    this.activeSessionRegistry.set(session.id, session);
    this.sessionCache.set(session.id, session);
    return session;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ✅ 6. GET ALL ACTIVE SESSIONS — ZERO Firestore read
  // ──────────────────────────────────────────────────────────────────────────

  getAllActiveSessions(): FastTradeSession[] {
    return Array.from(this.activeSessionRegistry.values());
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
    expectedCandleTs?: number,
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

      // ── Strategy 1: query exact timestamp ─────────────────────────────────
      if (expectedCandleTs) {
        const MAX_ATTEMPTS = 4;
        const RETRY_MS     = 300;

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

      // ── Strategy 2: fallback — limitToLast(2) ─────────────────────────────
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
  // 9. GET OHLC DATA (for REST endpoint)
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
      throw new BadRequestException(
        `Timeframe tidak valid: ${timeframe}. Pilihan: ${VALID_TF.join(', ')}`,
      );
    }

    const assetDoc = await this.db.collection(COL_ASSETS).doc(assetId).get();
    if (!assetDoc.exists) throw new NotFoundException(`Aset ${assetId} tidak ditemukan`);

    const asset     = assetDoc.data() as any;
    const rtpRaw    = asset.realtimeDbPath as string;
    const rtPath    = rtpRaw.startsWith('/') ? rtpRaw : `/${rtpRaw}`;
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
          candles.push({ t: parseInt(child.key!, 10), o: v.o, h: v.h, l: v.l, c: v.c, v: v.v || 0 });
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
  // 10. UPDATE SESSION AFTER ORDER RESULT
  // ──────────────────────────────────────────────────────────────────────────

  async applyOrderResult(
    sessionId: string,
    result: 'won' | 'lost',
    settledAmount: number,
    candleTimestamp: number,
    tfSeconds: number,
  ): Promise<{
    session: FastTradeSession;
    shouldStop: boolean;
    stopReason?: string;
    isMartingaleRetry: boolean;
    retryDirection?: 'CALL' | 'PUT';
  }> {
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

    let isMartingaleRetry = false;
    let retryDirection: 'CALL' | 'PUT' | undefined;

    if (result === 'won') {
      wins++;
      totalProfit       += settledAmount;
      totalPnL          += settledAmount;
      currentStep        = 0;
      consecutiveLosses  = 0;
      currentAmount      = baseAmount;
    } else {
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
          isMartingaleRetry = true;
          retryDirection    = lastDirection;
        } else {
          this.logger.warn(
            `⚠️ [${sessionId.slice(-8)}] Martingale MAX step ${martingaleMaxStep} reached — resetting to normal`,
          );
          currentStep        = 0;
          consecutiveLosses  = 0;
          currentAmount      = baseAmount;
        }
      }
    }

    const nextCandleAt = this.calcNextCandleBoundary(tfSeconds);

    let shouldStop  = false;
    let stopReason: string | undefined;
    let newStatus: FastTradeSessionStatus = 'waiting';
    let isActive  = true;
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
      pendingOrderId:       undefined,
      pendingOrderPlacedAt: undefined,
      pendingExecutionId:   undefined,
      lastCandleTimestamp:  candleTimestamp,
      nextCandleAt,
      status:    newStatus,
      isActive,
      stopReason,
      stoppedAt,
      updatedAt: ts,
    };

    await this.db.collection(COL_SESSIONS).doc(sessionId).update(updates);
    const updated = { ...session, ...updates } as FastTradeSession;

    // ✅ Sync ke kedua cache
    this.sessionCache.set(sessionId, updated);
    if (isActive) {
      this.activeSessionRegistry.set(sessionId, updated);
    } else {
      this.activeSessionRegistry.delete(sessionId);
    }

    return { session: updated, shouldStop, stopReason, isMartingaleRetry, retryDirection };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 11. STATUS TRANSITIONS
  // ──────────────────────────────────────────────────────────────────────────

  async markReadingCandle(sessionId: string): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({ status: 'reading_candle', updatedAt: ts });
    this._syncStatusToCache(sessionId, { status: 'reading_candle', updatedAt: ts });
  }

  async markPlacingOrder(sessionId: string): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({ status: 'placing_order', updatedAt: ts });
    this._syncStatusToCache(sessionId, { status: 'placing_order', updatedAt: ts });
  }

  async markWaitingResult(
    sessionId: string,
    orderId: string,
    executionId: string,
    direction?: 'CALL' | 'PUT',
  ): Promise<void> {
    const ts = this.now();
    const patch = {
      status:               'waiting_result',
      pendingOrderId:       orderId,
      pendingOrderPlacedAt: ts,
      pendingExecutionId:   executionId,
      ...(direction ? { lastDirection: direction } : {}),
      updatedAt:            ts,
    };
    await this.db.collection(COL_SESSIONS).doc(sessionId).update(patch);
    this._syncStatusToCache(sessionId, patch as Partial<FastTradeSession>);
  }

  async markWaiting(sessionId: string, nextCandleAt: number): Promise<void> {
    const ts = this.now();
    const patch = {
      status:               'waiting',
      nextCandleAt,
      pendingOrderId:       undefined,
      pendingOrderPlacedAt: undefined,
      pendingExecutionId:   undefined,
      updatedAt:            ts,
    };
    await this.db.collection(COL_SESSIONS).doc(sessionId).update(patch);
    this._syncStatusToCache(sessionId, patch as Partial<FastTradeSession>);
  }

  /** Sync patch ke sessionCache dan activeSessionRegistry */
  private _syncStatusToCache(sessionId: string, patch: Partial<FastTradeSession>): void {
    const c = this.sessionCache.get(sessionId);
    if (c) {
      Object.assign(c, patch);
      this.sessionCache.set(sessionId, c);
      if (this.activeSessionRegistry.has(sessionId)) {
        this.activeSessionRegistry.set(sessionId, c);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 12. EXECUTION LOG CRUD
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

  // ✅ OPTIMIZED: Tidak lagi scan seluruh fast_trade_executions collection
  //   Sebelum: WHERE status='placed' AND createdAt>=2hAgo → scan ratusan ribu doc
  //   Sekarang: iterasi activeSessionRegistry → ambil hanya sesi yg waiting_result
  //             → direct doc.get() per pendingExecutionId (1 read per sesi)
  async getPendingExecutions(): Promise<FastTradeExecution[]> {
    const sessions = Array.from(this.activeSessionRegistry.values()).filter(
      s => s.status === 'waiting_result' && s.pendingExecutionId,
    );

    if (sessions.length === 0) return [];

    const results = await Promise.allSettled(
      sessions.map(s =>
        this.db.collection(COL_EXECUTIONS).doc(s.pendingExecutionId!).get(),
      ),
    );

    const executions: FastTradeExecution[] = [];
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value.exists) {
        executions.push(r.value.data() as FastTradeExecution);
      } else if (r.status === 'rejected') {
        this.logger.warn(
          `⚠️ Failed to get execution for session ${sessions[idx].id.slice(-8)}: ${r.reason?.message}`,
        );
      }
    });

    return executions;
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

  calcNextCandleBoundary(tfSeconds: number): number {
    const nowSec     = TimezoneUtil.getCurrentTimestamp();
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
    this.logger.debug(
      `🧹 FastTrade cache cleaned. sessionCache: ${this.sessionCache.size}, ` +
      `activeRegistry: ${this.activeSessionRegistry.size}`,
    );
  }

  // ── Debug / monitoring ────────────────────────────────────────────────────

  getRegistryStats() {
    const sessions = Array.from(this.activeSessionRegistry.values());
    return {
      totalActive:   sessions.length,
      waitingResult: sessions.filter(s => s.status === 'waiting_result').length,
      waiting:       sessions.filter(s => s.status === 'waiting').length,
      placingOrder:  sessions.filter(s => s.status === 'placing_order').length,
      readingCandle: sessions.filter(s => s.status === 'reading_candle').length,
    };
  }

  async cleanupOldExecutions(retentionDays = 7): Promise<number> {
  try {
    const cutoffMs  = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const cutoffISO = new Date(cutoffMs).toISOString();

    const snapshot = await this.db
      .collection(COL_EXECUTIONS)
      .where('createdAt', '<', cutoffISO)
      .where('status', 'in', ['won', 'lost', 'error', 'skipped'])
      .limit(500)
      .get();

    if (snapshot.empty) return 0;

    const batch = this.db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    this.logger.log(`🧹 cleanupOldExecutions: deleted ${snapshot.size} records older than ${retentionDays} days`);
    return snapshot.size;

  } catch (error) {
    this.logger.error(`❌ cleanupOldExecutions error: ${error.message}`);
    return 0;
  }
}
}