// src/assets/helpers/initialize-asset-candles.helper.ts

import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

/**
 * ✅ IMPROVED VERSION: Smoother candle generation with realistic wicks
 * 
 * Changes:
 * 1. Momentum-based price movement (tidak random murni)
 * 2. Realistic wick calculation (dibatasi maksimal 0.3%)
 * 3. Mean reversion untuk menjaga harga tetap realistic
 */

@Injectable()
export class InitializeAssetCandlesHelper {
  private readonly logger = new Logger(InitializeAssetCandlesHelper.name);
  private realtimeDb: admin.database.Database | null = null;

  private readonly TIMEFRAMES = {
    '1s': 1,
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
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
    simulatorSettings?: {
      dailyVolatilityMin?: number;
      dailyVolatilityMax?: number;
      secondVolatilityMin?: number;
      secondVolatilityMax?: number;
      minPrice?: number;
      maxPrice?: number;
    },
  ): Promise<void> {
    this.logger.log(`🚀 Initializing 240 smooth candles for asset: ${symbol}`);
    
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
        this.logger.log(`📈 Generating ${timeframe} candles...`);
        
        const volatility = this.getVolatilityForTimeframe(timeframe, settings);
        
        await this.generateSmoothCandlesForTimeframe(
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
      this.logger.log(`✅ Successfully initialized smooth candles for ${symbol}`);
    } catch (error) {
      this.logger.error(`❌ Failed: ${error.message}`);
      throw error;
    }
  }

  private getVolatilityForTimeframe(
    timeframe: string,
    settings: any,
  ): number {
    if (timeframe === '1s' || timeframe === '1m') {
      return settings.secondVolatilityMax;
    } else if (['5m', '15m', '30m'].includes(timeframe)) {
      return (settings.secondVolatilityMax + settings.dailyVolatilityMin) / 2;
    } else {
      return settings.dailyVolatilityMax;
    }
  }

  private async generateSmoothCandlesForTimeframe(
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
      
      // ✅ IMPROVED: Smoothed price dengan momentum
      const change = this.calculateSmoothChange(price, volatility, momentum);
      momentum = (momentum * 0.7) + (change * 0.3); // 70% momentum lama + 30% baru
      
      let close = open + momentum;
      
      // ✅ Boundary check dengan soft bounce
      if (close < minPrice * 1.05) {
        close += Math.abs(momentum) * 2; // Bounce up
        momentum = Math.abs(momentum);
      } else if (close > maxPrice * 0.95) {
        close -= Math.abs(momentum) * 2; // Bounce down
        momentum = -Math.abs(momentum);
      }
      
      close = Math.max(minPrice, Math.min(maxPrice, close));
      
      // ✅ IMPROVED: Realistic wicks (maksimal 0.3% dari harga atau 1.5x body)
      const bodySize = Math.abs(close - open);
      const midPrice = (open + close) / 2;
      
      // Batasi wick agar tidak seperti jarum
      const maxWickPercent = 0.003; // 0.3% max
      const maxWickFromBody = bodySize * 1.5;
      const maxWickFromPrice = midPrice * maxWickPercent;
      const maxWick = Math.max(maxWickFromBody, maxWickFromPrice * 0.3); // Gunakan yang lebih kecil
      
      const upperWick = Math.random() * maxWick * 0.6; // 60% dari max
      const lowerWick = Math.random() * maxWick * 0.6;
      
      let high = Math.max(open, close) + upperWick;
      let low = Math.min(open, close) - lowerWick;
      
      // Enforce min/max
      high = Math.min(high, maxPrice);
      low = Math.max(low, minPrice);
      
      // ✅ Mean reversion ke initial price (jangan terlalu jauh)
      price = close + ((basePrice - close) * 0.02); // 2% pull to center
      
      candles[candleTimestamp.toString()] = {
        o: this.roundPrice(open),
        h: this.roundPrice(high),
        l: this.roundPrice(low),
        c: this.roundPrice(close),
        t: candleTimestamp,
        v: this.generateVolume(timeframe),
      };
    }

    await this.getRealtimeDb().ref(`${realtimeDbPath}/ohlc_${timeframe}`).set(candles);
  }

  private calculateSmoothChange(price: number, volatility: number, momentum: number): number {
    // Box-Muller untuk distribusi normal
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Scale dengan volatility tapi kurangi ekstrim (0.3 factor)
    const baseChange = price * volatility * z * 0.3;
    
    // Tambahkan mean reversion kecil
    const meanReversion = -momentum * 0.1; // 10% mean reversion
    
    return baseChange + meanReversion;
  }

  private generateVolume(timeframe: string): number {
    const base = 1000 + Math.random() * 9000;
    const multiplier = {
      '1s': 0.3, '1m': 1, '5m': 1.2, '15m': 1.5, 
      '30m': 1.8, '1h': 2.2, '4h': 3, '1d': 4
    }[timeframe] || 1;
    return Math.floor(base * multiplier);
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

  async initializeMultipleAssets(
    assets: Array<any>,
  ): Promise<void> {
    this.logger.log(`🚀 Initializing candles for ${assets.length} assets`);
    await Promise.all(
      assets.map((asset) => this.initializeAssetCandles(
        asset.assetId,
        asset.symbol,
        asset.realtimeDbPath,
        asset.initialPrice,
        asset.simulatorSettings,
      ))
    );
  }
}