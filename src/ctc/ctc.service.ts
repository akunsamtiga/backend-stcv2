// src/ctc/ctc.service.ts

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseService } from '../firebase/firebase.service';
import { TimezoneUtil } from '../common/utils';
import { CreateCtcDto, CTC_TIMEFRAME, CTC_TIMEFRAME_SECONDS } from './dto/create-ctc.dto';
import {
  CtcSession,
  CtcExecution,
  CtcOhlcCandle,
  CtcCandleDirection,
  CtcSessionStatus,
} from './interfaces/ctc.interface';

// ── Firestore collection names ─────────────────────────────────────────────
const COL_SESSIONS   = 'ctc_sessions';
const COL_EXECUTIONS = 'ctc_executions';
const COL_ASSETS     = 'assets';

@Injectable()
export class CtcService {
  private readonly logger = new Logger(CtcService.name);

  // In-memory cache — mengurangi Firestore read pada setiap cron tick
  private sessionCache: Map<string, CtcSession> = new Map();

  constructor(private readonly firebaseService: FirebaseService) {
    this.logger.log('✅ CtcService initialized');
    // Cleanup cache setiap 5 menit
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
  }

  // ── Shorthand accessors ────────────────────────────────────────────────────
  private get db() { return this.firebaseService.getFirestore(); }
  private get rtdb(): admin.database.Database { return admin.database(); }
  private now(): string { return TimezoneUtil.toISOString(); }

  // ════════════════════════════════════════════════════════════════════════════
  // 1. CREATE SESSION
  // ════════════════════════════════════════════════════════════════════════════

  async createSession(
    userId: string,
    userEmail: string,
    dto: CreateCtcDto,
  ): Promise<CtcSession> {
    // Satu sesi aktif per user
    const existing = await this.getUserActiveSession(userId);
    if (existing) {
      throw new ConflictException(
        `Sudah ada sesi CTC aktif (${existing.id}). ` +
        `Stop dulu sebelum membuat sesi baru.`,
      );
    }

    // Validasi aset
    const assetDoc = await this.db.collection(COL_ASSETS).doc(dto.assetId).get();
    if (!assetDoc.exists) throw new NotFoundException(`Aset ${dto.assetId} tidak ditemukan`);

    const asset = assetDoc.data() as any;
    if (!asset.isActive) throw new BadRequestException(`Aset ${asset.symbol} tidak aktif`);
    if (!asset.realtimeDbPath) {
      throw new BadRequestException(
        `Aset ${asset.symbol} tidak memiliki realtimeDbPath. ` +
        `Data OHLC 1m tidak tersedia untuk CTC.`,
      );
    }

    const sessionId  = uuidv4();
    const ts         = this.now();
    const nextCandle = this.calcNextCandleBoundary();

    const session: CtcSession = {
      id: sessionId,
      userId,
      userEmail,

      assetId:     dto.assetId,
      assetSymbol: asset.symbol,
      assetName:   asset.name,
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
      nextDirection:     null,   // akan dibaca dari candle pertama

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
      `✅ CTC session created: ${sessionId.slice(-8)} | ` +
      `User: ${userEmail} | Asset: ${asset.symbol} | ` +
      `Amount: Rp ${dto.amount.toLocaleString('id-ID')} | ` +
      `Martingale: ${dto.martingale.enabled
        ? `ON (max ${dto.martingale.maxStep} steps ×${dto.martingale.multiplier})`
        : 'OFF'} | ` +
      `NextCandle: ${new Date(nextCandle * 1000).toISOString()}`,
    );

    return session;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 2. STOP SESSION
  // ════════════════════════════════════════════════════════════════════════════

  async stopSession(
    userId: string,
    sessionId: string,
    reason = 'Dihentikan manual oleh user',
  ): Promise<CtcSession> {
    const session = await this.getAndVerifyOwner(userId, sessionId);
    if (!session.isActive) throw new BadRequestException('Sesi CTC sudah berhenti');
    return this.forceStopSession(sessionId, reason, session);
  }

  async forceStopSession(
    sessionId: string,
    reason: string,
    cachedSession?: CtcSession,
  ): Promise<CtcSession> {
    const ts = this.now();
    const updates: Partial<CtcSession> = {
      isActive:   false,
      status:     'stopped',
      stopReason: reason,
      stoppedAt:  ts,
      updatedAt:  ts,
    };
    await this.db.collection(COL_SESSIONS).doc(sessionId).update(updates);
    const session = cachedSession ?? this.sessionCache.get(sessionId);
    const updated = session ? { ...session, ...updates } : updates as CtcSession;
    this.sessionCache.set(sessionId, updated as CtcSession);
    this.logger.log(`🛑 CTC session stopped: ${sessionId.slice(-8)} | Reason: ${reason}`);
    return updated as CtcSession;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 3. QUERIES
  // ════════════════════════════════════════════════════════════════════════════

  async getSession(userId: string, sessionId: string): Promise<CtcSession> {
    return this.getAndVerifyOwner(userId, sessionId);
  }

  async getUserSessions(userId: string, activeOnly = false): Promise<CtcSession[]> {
    let q = this.db
      .collection(COL_SESSIONS)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(50) as FirebaseFirestore.Query;

    if (activeOnly) q = q.where('isActive', '==', true);

    const snap = await q.get();
    return snap.docs.map(d => d.data() as CtcSession);
  }

  async getUserActiveSession(userId: string): Promise<CtcSession | null> {
    const snap = await this.db
      .collection(COL_SESSIONS)
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();
    return snap.empty ? null : (snap.docs[0].data() as CtcSession);
  }

  /** Dipanggil oleh executor setiap cron tick */
  async getAllActiveSessions(): Promise<CtcSession[]> {
    const snap = await this.db
      .collection(COL_SESSIONS)
      .where('isActive', '==', true)
      .get();

    return snap.docs.map(d => {
      const s = d.data() as CtcSession;
      this.sessionCache.set(s.id, s);
      return s;
    });
  }

  async getExecutions(
    userId: string,
    sessionId: string,
    limit = 50,
  ): Promise<CtcExecution[]> {
    await this.getAndVerifyOwner(userId, sessionId);
    const snap = await this.db
      .collection(COL_EXECUTIONS)
      .where('sessionId', '==', sessionId)
      .orderBy('createdAt', 'desc')
      .limit(Math.min(limit, 200))
      .get();
    return snap.docs.map(d => d.data() as CtcExecution);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 4. READ OHLC — Baca candle 1m terakhir yang sudah selesai
  // ════════════════════════════════════════════════════════════════════════════

  async getCandleDirection(
    assetId: string,
    expectedCandleTs?: number,
  ): Promise<{ direction: CtcCandleDirection; candle: CtcOhlcCandle | null }> {
    try {
      const assetDoc = await this.db.collection(COL_ASSETS).doc(assetId).get();
      if (!assetDoc.exists) throw new Error(`Asset ${assetId} not found`);

      const asset   = assetDoc.data() as any;
      const rtPath  = (asset.realtimeDbPath as string).startsWith('/')
        ? asset.realtimeDbPath
        : `/${asset.realtimeDbPath}`;
      const ohlcPath = `${rtPath}/ohlc_${CTC_TIMEFRAME}`;

      const parseCandle = (key: string, v: any): CtcOhlcCandle | null => {
        const o = v?.o ?? v?.open;
        const c = v?.c ?? v?.close;
        if (typeof o !== 'number' || typeof c !== 'number') return null;
        return {
          t: parseInt(key, 10),
          o,
          h: v?.h ?? v?.high ?? o,
          l: v?.l ?? v?.low  ?? o,
          c,
          v: v?.v ?? v?.volume ?? 0,
        };
      };

      const dirOf = (candle: CtcOhlcCandle): CtcCandleDirection => {
        const diff      = candle.c - candle.o;
        const threshold = candle.o * 0.000001;
        return diff > threshold ? 'bullish' : diff < -threshold ? 'bearish' : 'neutral';
      };

      // ── Strategi 1: query key exact (cepat) ──────────────────────────────
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
              const direction = dirOf(candle);
              this.logger.debug(
                `📊 [exact] ${asset.symbol}/1m t=${candle.t} ` +
                `O=${candle.o} C=${candle.c} → ${direction.toUpperCase()} (attempt ${attempt + 1})`,
              );
              return { direction, candle };
            }
          }

          if (attempt < MAX_ATTEMPTS - 1) {
            this.logger.debug(`⏳ Candle t=${expectedCandleTs} belum ada, retry ${attempt + 1}/${MAX_ATTEMPTS - 1}`);
            await new Promise(r => setTimeout(r, RETRY_MS));
          }
        }

        this.logger.warn(
          `⚠️ Exact candle t=${expectedCandleTs} tidak ditemukan setelah ${MAX_ATTEMPTS}x — fallback limitToLast`,
        );
      }

      // ── Strategi 2: fallback limitToLast(2) ─────────────────────────────
      const snapshot = await this.rtdb
        .ref(ohlcPath)
        .orderByKey()
        .limitToLast(2)
        .once('value');

      if (!snapshot.exists()) {
        this.logger.warn(`⚠️ Tidak ada data OHLC di ${ohlcPath}`);
        return { direction: 'neutral', candle: null };
      }

      const candles: CtcOhlcCandle[] = [];
      snapshot.forEach(child => {
        const c = parseCandle(child.key!, child.val());
        if (c) candles.push(c);
      });

      candles.sort((a, b) => a.t - b.t);
      if (!candles.length) return { direction: 'neutral', candle: null };

      const last      = candles[candles.length - 1];
      const direction = dirOf(last);
      this.logger.debug(
        `📊 [limitToLast] ${asset.symbol}/1m t=${last.t} O=${last.o} C=${last.c} → ${direction.toUpperCase()}`,
      );
      return { direction, candle: last };

    } catch (error) {
      this.logger.error(`❌ getCandleDirection error: ${error.message}`);
      return { direction: 'neutral', candle: null };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 5. APPLY ORDER RESULT — Update session setelah order settle
  //
  //  CTC Direction Logic (BERBEDA dari FastTrade):
  //  ┌─────────────────────────────────────────────────────────────────────┐
  //  │  WIN  → nextDirection = arah yang baru menang (lanjut, tanpa baca  │
  //  │         candle baru — "teruskan tanpa menunggu 1 menit")           │
  //  │                                                                     │
  //  │  LOSE → nextDirection = opposite(losingOrderDirection)             │
  //  │         = arah candle yang menyebabkan kekalahan                   │
  //  │         ("ikuti candle yang kalah")                                 │
  //  │                                                                     │
  //  │  LOSE di maxStep → reset, nextDirection = null (baca candle baru)  │
  //  └─────────────────────────────────────────────────────────────────────┘
  // ════════════════════════════════════════════════════════════════════════════

  async applyOrderResult(
    sessionId: string,
    result: 'won' | 'lost',
    settledAmount: number,       // selalu positif
    candleTimestamp: number,
    lastOrderDirection: 'CALL' | 'PUT',
  ): Promise<{
    session: CtcSession;
    shouldStop: boolean;
    stopReason?: string;
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
    } = session;

    totalOrders++;

    let nextDirection: 'CALL' | 'PUT' | null = null;

    if (result === 'won') {
      wins++;
      totalProfit       += settledAmount;
      totalPnL          += settledAmount;
      currentStep        = 0;
      consecutiveLosses  = 0;
      currentAmount      = baseAmount;

      // WIN → lanjutkan arah yang sama ("teruskan tanpa menunggu 1 menit")
      nextDirection = lastOrderDirection;

    } else {
      // LOSE
      losses++;
      totalLoss         += currentAmount;
      totalPnL          -= currentAmount;
      consecutiveLosses++;

      // Arah martingale = opposite dari bet yang kalah = candle yang kalah
      const loseFollowDir: 'CALL' | 'PUT' =
        lastOrderDirection === 'CALL' ? 'PUT' : 'CALL';

      if (martingaleEnabled && currentStep < martingaleMaxStep) {
        currentStep++;
        currentAmount = Math.round(baseAmount * Math.pow(martingaleMultiplier, currentStep));
        nextDirection = loseFollowDir;   // ikuti candle yang kalah

        this.logger.log(
          `📈 [${sessionId.slice(-8)}] Martingale step ↑ ${currentStep - 1}→${currentStep} | ` +
          `Direction switch: ${lastOrderDirection} → ${loseFollowDir} (candle yg kalah) | ` +
          `Amount: ${currentAmount.toLocaleString('id-ID')}`,
        );
      } else if (martingaleEnabled && currentStep >= martingaleMaxStep) {
        // Max step tercapai → reset, baca candle baru (null)
        this.logger.warn(
          `⚠️ [${sessionId.slice(-8)}] Martingale MAX step ${martingaleMaxStep} tercapai — reset`,
        );
        currentStep        = 0;
        consecutiveLosses  = 0;
        currentAmount      = baseAmount;
        nextDirection      = null;       // baca candle baru
      } else {
        // Martingale disabled → tetap follow candle (null = baca candle baru)
        nextDirection = null;
      }
    }

    // Check stop conditions
    let shouldStop  = false;
    let stopReason: string | undefined;
    let newStatus: CtcSessionStatus = 'waiting';
    let isActive = true;
    let stoppedAt: string | undefined;
    const ts = this.now();

    if (stopProfit && totalPnL >= stopProfit) {
      shouldStop = true;
      stopReason = `Stop profit tercapai: +Rp ${totalPnL.toLocaleString('id-ID')}`;
      newStatus  = 'completed';
      isActive   = false;
      stoppedAt  = ts;
      this.logger.log(`🎯 [${sessionId.slice(-8)}] Stop profit triggered at Rp ${totalPnL}`);
    } else if (stopLoss && totalPnL <= -(Math.abs(stopLoss))) {
      shouldStop = true;
      stopReason = `Stop loss tercapai: -Rp ${Math.abs(totalPnL).toLocaleString('id-ID')}`;
      newStatus  = 'completed';
      isActive   = false;
      stoppedAt  = ts;
      this.logger.log(`🛑 [${sessionId.slice(-8)}] Stop loss triggered at Rp ${totalPnL}`);
    }

    const nextCandleAt = this.calcNextCandleBoundary();

    const updates: Partial<CtcSession> = {
      currentStep,
      currentAmount,
      consecutiveLosses,
      nextDirection,
      totalPnL,
      totalProfit,
      totalLoss,
      wins,
      losses,
      totalOrders,
      lastOrderDirection,
      lastCandleTimestamp: candleTimestamp,
      pendingOrderId:       undefined,
      pendingOrderPlacedAt: undefined,
      pendingExecutionId:   undefined,
      nextCandleAt,
      status:    newStatus,
      isActive,
      stopReason,
      stoppedAt,
      updatedAt: ts,
    };

    await this.db.collection(COL_SESSIONS).doc(sessionId).update(updates);
    const updated = { ...session, ...updates } as CtcSession;
    this.sessionCache.set(sessionId, updated);

    return { session: updated, shouldStop, stopReason };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 6. STATUS TRANSITIONS (dipanggil oleh executor)
  // ════════════════════════════════════════════════════════════════════════════

  async markReadingCandle(sessionId: string): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({ status: 'reading_candle', updatedAt: ts });
    const c = this.sessionCache.get(sessionId);
    if (c) { c.status = 'reading_candle'; c.updatedAt = ts; }
  }

  async markPlacingOrder(sessionId: string): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({ status: 'placing_order', updatedAt: ts });
    const c = this.sessionCache.get(sessionId);
    if (c) { c.status = 'placing_order'; c.updatedAt = ts; }
  }

  async markWaitingResult(
    sessionId: string,
    orderId: string,
    executionId: string,
    direction: 'CALL' | 'PUT',
  ): Promise<void> {
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({
      status:               'waiting_result',
      pendingOrderId:       orderId,
      pendingOrderPlacedAt: ts,
      pendingExecutionId:   executionId,
      lastOrderDirection:   direction,
      updatedAt:            ts,
    });
    const c = this.sessionCache.get(sessionId);
    if (c) {
      c.status               = 'waiting_result';
      c.pendingOrderId       = orderId;
      c.pendingOrderPlacedAt = ts;
      c.pendingExecutionId   = executionId;
      c.lastOrderDirection   = direction;
      c.updatedAt            = ts;
    }
  }

  async markWaiting(sessionId: string): Promise<void> {
    const nextCandleAt = this.calcNextCandleBoundary();
    const ts = this.now();
    await this.db.collection(COL_SESSIONS).doc(sessionId).update({
      status:               'waiting',
      nextCandleAt,
      pendingOrderId:       undefined,
      pendingOrderPlacedAt: undefined,
      pendingExecutionId:   undefined,
      updatedAt:            ts,
    });
    const c = this.sessionCache.get(sessionId);
    if (c) {
      c.status               = 'waiting';
      c.nextCandleAt         = nextCandleAt;
      c.pendingOrderId       = undefined;
      c.pendingOrderPlacedAt = undefined;
      c.pendingExecutionId   = undefined;
      c.updatedAt            = ts;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 7. EXECUTION LOG CRUD
  // ════════════════════════════════════════════════════════════════════════════

  async saveExecution(
    data: Omit<CtcExecution, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CtcExecution> {
    const id = uuidv4();
    const ts = this.now();
    const full: CtcExecution = { ...data, id, createdAt: ts, updatedAt: ts };
    await this.db.collection(COL_EXECUTIONS).doc(id).set(full);
    return full;
  }

  async updateExecution(execId: string, updates: Partial<CtcExecution>): Promise<void> {
    await this.db.collection(COL_EXECUTIONS).doc(execId).update({
      ...updates,
      updatedAt: this.now(),
    });
  }

  async getPendingExecutions(): Promise<CtcExecution[]> {
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

    const snap = await this.db
      .collection(COL_EXECUTIONS)
      .where('status', '==', 'placed')
      .where('createdAt', '>=', twoHoursAgo.toISOString())
      .limit(100)
      .get();
    return snap.docs.map(d => d.data() as CtcExecution);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 8. OHLC DATA endpoint
  // ════════════════════════════════════════════════════════════════════════════

  async getOhlcData(
    assetId: string,
    limit: number,
  ): Promise<{
    assetId: string;
    timeframe: string;
    candles: CtcOhlcCandle[];
    lastCompleted: CtcOhlcCandle | null;
    direction: CtcCandleDirection;
  }> {
    const assetDoc = await this.db.collection(COL_ASSETS).doc(assetId).get();
    if (!assetDoc.exists) throw new NotFoundException(`Aset ${assetId} tidak ditemukan`);

    const asset    = assetDoc.data() as any;
    const rtPath   = (asset.realtimeDbPath as string).startsWith('/')
      ? asset.realtimeDbPath
      : `/${asset.realtimeDbPath}`;
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 2), 100);
    const ohlcPath  = `${rtPath}/ohlc_${CTC_TIMEFRAME}`;

    const snapshot = await this.rtdb
      .ref(ohlcPath)
      .orderByKey()
      .limitToLast(safeLimit + 1)
      .once('value');

    const candles: CtcOhlcCandle[] = [];
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

    let lastCompleted: CtcOhlcCandle | null = null;
    let direction: CtcCandleDirection = 'neutral';

    if (trimmed.length >= 2) {
      lastCompleted = trimmed[trimmed.length - 2];
      const diff = lastCompleted.c - lastCompleted.o;
      direction = diff > 0 ? 'bullish' : diff < 0 ? 'bearish' : 'neutral';
    }

    return { assetId, timeframe: CTC_TIMEFRAME, candles: trimmed, lastCompleted, direction };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 9. CLEANUP
  // ════════════════════════════════════════════════════════════════════════════

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
    this.logger.log(`🧹 Deleted ${snap.size} old CTC executions`);
    return snap.size;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  async getSessionById(sessionId: string): Promise<CtcSession> {
    let session = this.sessionCache.get(sessionId);
    if (!session) {
      const doc = await this.db.collection(COL_SESSIONS).doc(sessionId).get();
      if (!doc.exists) throw new NotFoundException(`Sesi CTC ${sessionId} tidak ditemukan`);
      session = doc.data() as CtcSession;
      this.sessionCache.set(sessionId, session);
    }
    return session;
  }

  private async getAndVerifyOwner(userId: string, sessionId: string): Promise<CtcSession> {
    const session = await this.getSessionById(sessionId);
    if (session.userId !== userId) throw new BadRequestException('Anda bukan pemilik sesi ini');
    return session;
  }

  /**
   * Hitung unix timestamp (seconds) dari batas candle 1m berikutnya.
   * Contoh: sekarang 12:22:45 → nextCandleAt = 12:23:00
   */
  calcNextCandleBoundary(): number {
    const nowSec     = TimezoneUtil.getCurrentTimestamp();
    const intoCandle = nowSec % CTC_TIMEFRAME_SECONDS;
    return nowSec + (CTC_TIMEFRAME_SECONDS - intoCandle);
  }

  evictSessionCache(sessionId: string): void {
    this.sessionCache.delete(sessionId);
  }

  private cleanupCache(): void {
    for (const [id, s] of this.sessionCache.entries()) {
      if (!s.isActive) this.sessionCache.delete(id);
    }
    this.logger.debug(`🧹 CTC session cache cleaned. Remaining: ${this.sessionCache.size}`);
  }
}