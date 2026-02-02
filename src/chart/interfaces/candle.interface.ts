// src/chart/interfaces/candle.interface.ts
export interface CandleData {
  time: number;          // Unix timestamp in seconds (Lightweight Charts format)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OHLCResponse {
  assetId: string;
  symbol: string;
  timeframe: string;
  data: CandleData[];
  lastUpdate: number;
  timezone: string;
}

export interface ChartUpdate {
  assetId: string;
  symbol: string;
  timeframe: string;
  candle: CandleData;
  isNewCandle: boolean;  // true jika candle baru, false jika update candle saat ini
}