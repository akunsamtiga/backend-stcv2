// src/assets/helpers/initialize-asset-candles.helper.ts

import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

/**
 * ✅ ULTRA-SMOOTH VERSION: Minimal wick length
 */

@Injectable()
export class InitializeAssetCandlesHelper {
  private readonly logger = new Logger(InitializeAssetCandlesHelper.name);
  private realtimeDb: admin.database.Database | null = null;

  private readonly TIMEFRAMES = {
    '1s': 1, '1m': 60, '5m': 300, '15m': 900, 
    '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400,
  };

  private readonly CANDLES_TO_CREATE = 240;

  constructor() {}

  private getRealtimeDb(): admin.database.Database {
    if (!this.realtimeDb) {
      if (!admin.apps.length) {
        throw new Error('Firebase Admin SDK not initialized.');
      }
      this.realtimeDb = admin.database();
    }
    return this.realtimeDb;
  }

  async initializeAssetCandles(
    assetId: string,
    symbol: string,
    realtimeDbPath: string,
    initialPrice: number,
    simulatorSettings?: any,
  ): Promise<void> {
    this.logger.log(`🚀 Initializing 240 ultra-smooth candles for: ${symbol}`);
    
    const settings = {
      dailyVolatilityMin: simulatorSettings?.dailyVolatilityMin ?? 0.001,
      dailyVolatilityMax: simulatorSettings?.dailyVolatilityMax ?? 0.005,
      secondVolatilityMin: simulatorSettings?.secondVolatilityMin ?? 0.00001,
      secondVolatilityMax: simulatorSettings?.secondVolatilityMax ?? 0.00008,
      minPrice: simulatorSettings?.minPrice ?? initialPrice * 0.5,
      maxPrice: simulatorSettings?.maxPrice ?? initialPrice * 2.0,
    };

    try {
      const now = Math.floor(Date.now() / 1000);

      for (const [timeframe, durationInSeconds] of Object.entries(this.TIMEFRAMES)) {
        this.logger.log(`📈 Generating ${timeframe}...`);
        
        const volatility = this.getVolatilityForTimeframe(timeframe, settings);
        
        await this.generateUltraSmoothCandles(
          realtimeDbPath,
          timeframe,
          durationInSeconds,
          now,
          initialPrice,
          volatility,
          settings.minPrice,
          settings.maxPrice,
        );
      }

      await this.setLastPrice(realtimeDbPath, initialPrice);
      this.logger.log(`✅ Smooth candles initialized for ${symbol}`);
    } catch (error) {
      this.logger.error(`❌ Failed: ${error.message}`);
      throw error;
    }
  }

  private getVolatilityForTimeframe(timeframe: string, settings: any): number {
    if (timeframe === '1s' || timeframe === '1m') {
      return settings.secondVolatilityMax;
    } else if (['5m', '15m', '30m'].includes(timeframe)) {
      return (settings.secondVolatilityMax + settings.dailyVolatilityMin) / 2;
    } else {
      return settings.dailyVolatilityMax;
    }
  }

  private async generateUltraSmoothCandles(
    realtimeDbPath: string,
    timeframe: string,
    durationInSeconds: number,
    currentTimestamp: number,
    basePrice: number,
    volatility: number,
    minPrice: number,
    maxPrice: number,
  ): Promise<void> {
    const candles: Record<string, any> = {};
    let price = basePrice;
    let momentum = 0;
    
    for (let i = this.CANDLES_TO_CREATE - 1; i >= 0; i--) {
      const candleTimestamp = currentTimestamp - (i * durationInSeconds);
      const open = price;
      
      // Smooth price movement dengan momentum
      const change = this.calculateSmoothChange(price, volatility);
      momentum = (momentum * 0.8) + (change * 0.2); // 80% momentum lama
      
      let close = open + momentum;
      
      // Boundary check
      if (close < minPrice) {
        close = minPrice + (Math.random() * minPrice * 0.001);
        momentum = Math.abs(momentum) * 0.5; // Reverse dengan damping
      } else if (close > maxPrice) {
        close = maxPrice - (Math.random() * maxPrice * 0.001);
        momentum = -Math.abs(momentum) * 0.5;
      }
      
      close = Math.max(minPrice, Math.min(maxPrice, close));
      
      // ✅ ULTRA-KETAT: Wick hanya 0.1% atau lebih kecil
      const bodySize = Math.abs(close - open);
      const maxWickPercent = 0.001; // 0.1% saja! (Sebelumnya 0.3%)
      const maxWick = price * maxWickPercent; 
      
      // Wick bahkan lebih pendek: hanya 20-50% dari max allowable
      const wickMultiplier = 0.2 + (Math.random() * 0.3); // 20-50%
      const upperWick = maxWick * wickMultiplier * 0.5; // Setengah untuk atas
      const lowerWick = maxWick * wickMultiplier * 0.5; // Setengah untuk bawah
      
      let high = Math.max(open, close) + upperWick;
      let low = Math.min(open, close) - lowerWick;
      
      // Pastikan wick tidak lebih panjang dari body untuk candle kecil
      if (bodySize > 0) {
        const maxWickFromBody = bodySize * 0.3; // Wick max 30% dari body
        high = Math.min(high, Math.max(open, close) + maxWickFromBody);
        low = Math.max(low, Math.min(open, close) - maxWickFromBody);
      }
      
      // Enforce absolute boundaries
      high = Math.min(high, maxPrice);
      low = Math.max(low, minPrice);
      
      price = close;
      
      candles[candleTimestamp.toString()] = {
        o: this.roundPrice(open),
        h: this.roundPrice(high),
        l: this.roundPrice(low),
        c: this.roundPrice(close),
        t: candleTimestamp,
        v: Math.floor(1000 + Math.random() * 9000),
      };
    }

    await this.getRealtimeDb().ref(`${realtimeDbPath}/ohlc_${timeframe}`).set(candles);
  }

  private calculateSmoothChange(price: number, volatility: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Volatility dikurangi lagi biar gak spiky (factor 0.2)
    return price * volatility * z * 0.2;
  }

  private roundPrice(price: number): number {
    return Math.round(price * 1000000) / 1000000;
  }

  private async setLastPrice(realtimeDbPath: string, price: number): Promise<void> {
    await this.getRealtimeDb().ref(`${realtimeDbPath}/current_price`).set({
      current: this.roundPrice(price),
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  async initializeMultipleAssets(assets: Array<any>): Promise<void> {
    await Promise.all(
      assets.map((asset) => this.initializeAssetCandles(
        asset.assetId, asset.symbol, asset.realtimeDbPath, 
        asset.initialPrice, asset.simulatorSettings,
      ))
    );
  }
}