// src/assets/helpers/initialize-asset-candles.helper.ts

import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

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
      if (!admin.apps.length) throw new Error('Firebase not initialized');
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
    this.logger.log(`🚀 Initializing smooth trend candles for: ${symbol}`);
    
    const settings = {
      volatility: (simulatorSettings?.secondVolatilityMax ?? 0.00008) * 0.3, // Kurangi 70%
      minPrice: simulatorSettings?.minPrice ?? initialPrice * 0.8,
      maxPrice: simulatorSettings?.maxPrice ?? initialPrice * 1.2,
    };

    try {
      const now = Math.floor(Date.now() / 1000);

      for (const [timeframe, durationInSeconds] of Object.entries(this.TIMEFRAMES)) {
        this.logger.log(`📈 Generating ${timeframe} trend candles...`);
        
        // Generate dengan trend cycle yang smooth menggunakan sine wave
        await this.generateTrendCandles(
          realtimeDbPath,
          timeframe,
          durationInSeconds,
          now,
          initialPrice,
          settings.volatility,
          settings.minPrice,
          settings.maxPrice,
        );
      }

      await this.setLastPrice(realtimeDbPath, initialPrice);
      this.logger.log(`✅ Trend candles created for ${symbol}`);
    } catch (error) {
      this.logger.error(`❌ Failed: ${error.message}`);
      throw error;
    }
  }

  private async generateTrendCandles(
    realtimeDbPath: string,
    timeframe: string,
    durationInSeconds: number,
    currentTimestamp: number,
    basePrice: number,
    baseVolatility: number,
    minPrice: number,
    maxPrice: number,
  ): Promise<void> {
    const candles: Record<string, any> = {};
    
    // ✅ KUNCI SMOOTHNESS: Gunakan trend cycle (sine wave + noise kecil)
    // Ini membuat harga bergerak naik turun secara gradual, bukan acak
    let currentPrice = basePrice;
    let trendPhase = Math.random() * Math.PI * 2; // Phase random awal
    
    for (let i = this.CANDLES_TO_CREATE - 1; i >= 0; i--) {
      const candleTimestamp = currentTimestamp - (i * durationInSeconds);
      
      // ✅ SMOOTH TREND: Kombinasi trend sine wave + micro noise
      // Sine wave memberikan arah (trend) yang berubah perlahan
      trendPhase += 0.05; // Increment kecil untuk perubahan gradual
      
      const trendForce = Math.sin(trendPhase) * baseVolatility * basePrice * 0.5; // Dampening trend
      const noise = (Math.random() - 0.5) * baseVolatility * basePrice * 0.2; // Noise sangat kecil (20%)
      
      const priceChange = trendForce + noise;
      let closePrice = currentPrice + priceChange;
      
      // Soft boundaries - bounce pelan
      if (closePrice > maxPrice) {
        closePrice = maxPrice - (Math.random() * basePrice * 0.0001);
        trendPhase += Math.PI; // Reverse trend
      } else if (closePrice < minPrice) {
        closePrice = minPrice + (Math.random() * basePrice * 0.0001);
        trendPhase += Math.PI; // Reverse trend
      }
      
      // Open = close sebelumnya (continuous!)
      const openPrice = currentPrice;
      
      // ✅ WICK MINIMAL: Hanya 0.05% (sangat kecil) dan proporsional dengan body
      const bodySize = Math.abs(closePrice - openPrice);
      const maxWick = Math.max(
        basePrice * 0.0005, // 0.05% dari harga base (minimal)
        bodySize * 0.2      // Atau 20% dari body (jika body besar)
      );
      
      const upperWick = Math.random() * maxWick;
      const lowerWick = Math.random() * maxWick;
      
      let high = Math.max(openPrice, closePrice) + upperWick;
      let low = Math.min(openPrice, closePrice) - lowerWick;
      
      // Absolute limits
      high = Math.min(high, maxPrice);
      low = Math.max(low, minPrice);
      
      // Simpan candle
      candles[candleTimestamp.toString()] = {
        o: this.round6(openPrice),
        h: this.round6(high),
        l: this.round6(low),
        c: this.round6(closePrice),
        t: candleTimestamp,
        v: Math.floor(1000 + Math.random() * 5000),
      };
      
      // ✅ SMOOTH TRANSITION: Close candle ini = Open candle berikutnya
      currentPrice = closePrice;
    }

    await this.getRealtimeDb()
      .ref(`${realtimeDbPath}/ohlc_${timeframe}`)
      .set(candles);
  }

  private round6(n: number): number {
    return Math.round(n * 1000000) / 1000000;
  }

  private async setLastPrice(realtimeDbPath: string, price: number): Promise<void> {
    await this.getRealtimeDb().ref(`${realtimeDbPath}/current_price`).set({
      current: this.round6(price),
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
}