// src/ctc/interfaces/ctc.interface.ts

import { CtcAccountType } from '../dto/create-ctc.dto';

// ── Candle direction ───────────────────────────────────────────────────────
export type CtcCandleDirection = 'bullish' | 'bearish' | 'neutral';

// ── Session status ─────────────────────────────────────────────────────────
export type CtcSessionStatus =
  | 'waiting'         // menunggu candle berikutnya
  | 'reading_candle'  // sedang baca OHLC dari RTDB
  | 'placing_order'   // sedang pasang order
  | 'waiting_result'  // menunggu hasil order settle
  | 'stopped'         // dihentikan manual
  | 'completed';      // stop condition terpenuhi

// ── OHLC candle ────────────────────────────────────────────────────────────
export interface CtcOhlcCandle {
  t: number;  // open timestamp (unix seconds)
  o: number;  // open price
  h: number;  // high price
  l: number;  // low price
  c: number;  // close price
  v: number;  // volume
}

// ── CTC Session (stored in Firestore: ctc_sessions) ───────────────────────
export interface CtcSession {
  id: string;
  userId: string;
  userEmail: string;

  // Config — immutable setelah create
  assetId: string;
  assetSymbol: string;
  assetName: string;
  accountType: CtcAccountType;
  baseAmount: number;

  // Martingale config
  martingaleEnabled: boolean;
  martingaleMaxStep: number;
  martingaleMultiplier: number;

  // Stop conditions
  stopProfit?: number;
  stopLoss?: number;

  // Live state
  status: CtcSessionStatus;
  isActive: boolean;

  // Martingale runtime state
  currentStep: number;
  currentAmount: number;      // = baseAmount × multiplier^currentStep
  consecutiveLosses: number;

  /**
   * nextDirection — arah untuk order berikutnya:
   *   - Diisi setelah WIN  : arah yang sama (lanjutkan tanpa baca candle)
   *   - Diisi setelah LOSE : arah candle yang kalah = opposite dari bet yang kalah
   *   - null               : baca candle baru dari RTDB (fresh start / setelah maxStep)
   *
   * Inilah perbedaan utama CTC vs FastTrade:
   *   FastTrade martingale retry = SAME arah dengan yang kalah
   *   CTC martingale retry       = OPPOSITE (ikuti candle yang kalah)
   */
  nextDirection: 'CALL' | 'PUT' | null;

  // P&L tracking
  totalPnL: number;
  totalProfit: number;
  totalLoss: number;
  wins: number;
  losses: number;
  totalOrders: number;

  // Pending order tracking
  pendingOrderId?: string;
  pendingOrderPlacedAt?: string;
  pendingExecutionId?: string;

  // Last order info (untuk menentukan nextDirection)
  lastOrderDirection?: 'CALL' | 'PUT';
  lastCandleTimestamp?: number;   // unix seconds of last processed candle
  lastCandleDirection?: CtcCandleDirection;

  // Next candle boundary
  nextCandleAt: number;           // unix seconds

  // Stop info
  stopReason?: string;

  // Timing
  startedAt: string;
  stoppedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Execution log (stored in Firestore: ctc_executions) ───────────────────
export interface CtcExecution {
  id: string;
  sessionId: string;
  userId: string;

  // Candle info
  candleTimestamp: number;          // unix seconds of candle open
  candleDirection: CtcCandleDirection;

  // Order info
  orderId?: string;
  direction: 'CALL' | 'PUT';
  amount: number;
  martingaleStep: number;
  accountType: CtcAccountType;
  assetSymbol: string;
  assetId: string;
  duration: number;                 // selalu 1 menit

  /**
   * isMartingaleRetry — apakah order ini adalah martingale step (bukan fresh candle read)
   * Jika true, arah = "candle yang kalah" bukan candle terbaru
   */
  isMartingaleRetry: boolean;

  /**
   * isWinContinue — apakah order ini lanjutan dari WIN sebelumnya
   * Jika true, arah = sama dengan order sebelumnya yang WIN (tanpa menunggu candle)
   */
  isWinContinue: boolean;

  // Result
  status: 'placed' | 'won' | 'lost' | 'error' | 'skipped';
  profit: number;                   // final +/- amount (0 saat pending)
  entryPrice?: number;
  exitPrice?: number;
  errorMessage?: string;

  // Timestamps
  placedAt: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}