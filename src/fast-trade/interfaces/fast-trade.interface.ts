// src/fast-trade/interfaces/fast-trade.interface.ts

import { FastTradeTimeframe, FastTradeAccountType } from '../dto/create-fast-trade.dto';

// ── Candle direction ───────────────────────────────────────────────────────
export type CandleDirection = 'bullish' | 'bearish' | 'neutral';

// ── Session status ─────────────────────────────────────────────────────────
export type FastTradeSessionStatus =
  | 'waiting'         // menunggu candle berikutnya
  | 'reading_candle'  // sedang baca OHLC dari RTDB
  | 'placing_order'   // sedang pasang order
  | 'waiting_result'  // menunggu hasil order settle
  | 'stopped'         // dihentikan manual
  | 'completed';      // stop condition terpenuhi

// ── OHLC candle ────────────────────────────────────────────────────────────
export interface OhlcCandle {
  t: number;   // open timestamp (unix seconds)
  o: number;   // open price
  h: number;   // high price
  l: number;   // low price
  c: number;   // close price
  v: number;   // volume
}

// ── FastTrade Session (stored in Firestore) ────────────────────────────────
export interface FastTradeSession {
  id: string;
  userId: string;
  userEmail: string;

  // Config (immutable after create)
  assetId: string;
  assetSymbol: string;
  assetName: string;
  timeframe: FastTradeTimeframe;
  accountType: FastTradeAccountType;
  baseAmount: number;

  // Martingale config
  martingaleEnabled: boolean;
  martingaleMaxStep: number;
  martingaleMultiplier: number;

  // Stop conditions
  stopProfit?: number;
  stopLoss?: number;

  // Live state
  status: FastTradeSessionStatus;
  isActive: boolean;

  // Martingale runtime state
  currentStep: number;
  currentAmount: number;       // = baseAmount * multiplier^currentStep
  consecutiveLosses: number;

  // P&L tracking
  totalPnL: number;
  totalProfit: number;
  totalLoss: number;
  wins: number;
  losses: number;
  totalOrders: number;

  // Pending order tracking (for result polling)
  pendingOrderId?: string;
  pendingOrderPlacedAt?: string;
  pendingExecutionId?: string;

  // Martingale direction tracking
  lastDirection?: "CALL" | "PUT";

  // Stop reason
  stopReason?: string;

  // Timing
  lastCandleTimestamp?: number;  // unix seconds of last processed candle open
  nextCandleAt: number;          // unix seconds of next expected candle open

  // Metadata
  startedAt: string;
  stoppedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Execution log (stored in Firestore) ────────────────────────────────────
export interface FastTradeExecution {
  id: string;
  sessionId: string;
  userId: string;

  // Candle info
  candleTimestamp: number;       // unix seconds of candle open
  candleDirection: CandleDirection;
  timeframe: FastTradeTimeframe;

  // Order info
  orderId?: string;
  direction: 'CALL' | 'PUT';
  amount: number;
  martingaleStep: number;
  accountType: FastTradeAccountType;
  assetSymbol: string;
  assetId: string;
  duration: number;              // in minutes (matches binary order)

  // Result
  status: 'placed' | 'won' | 'lost' | 'error' | 'skipped';
  profit: number;                // final profit (+) or loss (-), 0 while pending
  entryPrice?: number;
  exitPrice?: number;
  errorMessage?: string;

  // Timestamps
  placedAt: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}