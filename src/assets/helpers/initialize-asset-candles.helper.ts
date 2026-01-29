// src/assets/helpers/initialize-asset-candles.helper.ts

import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

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
    volatility: number = 0.001,
  ): Promise<void> {
    this.logger.log(`Initializing 240 candles for asset: ${symbol} (${assetId})`);

    try {
      const now = Math.floor(Date.now() / 1000);

      // Generate candles untuk setiap timeframe
      for (const [timeframe, durationInSeconds] of Object.entries(this.TIMEFRAMES)) {
        this.logger.log(`Generating ${this.CANDLES_TO_CREATE} candles for ${symbol} - ${timeframe}`);
        
        await this.generateCandlesForTimeframe(
          realtimeDbPath,
          timeframe,
          durationInSeconds,
          now,
          initialPrice,
          volatility,
        );
      }

      // Set last price di Realtime Database
      await this.setLastPrice(realtimeDbPath, initialPrice);

      this.logger.log(`Successfully initialized all candles for ${symbol}`);
    } catch (error) {
      this.logger.error(`Failed to initialize candles for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  private async generateCandlesForTimeframe(
    realtimeDbPath: string,
    timeframe: string,
    durationInSeconds: number,
    currentTimestamp: number,
    basePrice: number,
    volatility: number,
  ): Promise<void> {
    const candles: Record<string, any> = {};
    let price = basePrice;

    // ✅ RANDOM NATURAL SETTINGS - Tidak terkekang oleh volatility asset
    // Volatility dinamis antara 0.2% - 2% per candle (natural market movement)
    const minVolatility = 0.002;  // 0.2%
    const maxVolatility = 0.02;   // 2%
    
    // Probabilitas trend: 40% bullish, 40% bearish, 20% sideways
    const trendProbability = Math.random();
    let trendDirection = 0;
    if (trendProbability < 0.4) {
      trendDirection = 1;  // Bullish trend
    } else if (trendProbability < 0.8) {
      trendDirection = -1; // Bearish trend
    }
    // else sideways (0)

    // Generate 240 candles mundur dari waktu sekarang
    for (let i = this.CANDLES_TO_CREATE - 1; i >= 0; i--) {
      const candleTimestamp = currentTimestamp - (i * durationInSeconds);
      
      // ✅ RANDOM NATURAL PRICE MOVEMENT
      // Volatility random untuk setiap candle
      const candleVolatility = minVolatility + Math.random() * (maxVolatility - minVolatility);
      
      // Generate price change dengan trend bias
      const randomWalk = this.generateNaturalPriceMovement(price, candleVolatility);
      const trendBias = price * candleVolatility * trendDirection * 0.3; // 30% trend influence
      const priceChange = randomWalk + trendBias;
      
      const open = price;
      const close = open + priceChange;
      
      // ✅ Generate natural OHLC dengan variasi yang lebih besar
      // High dan Low HARUS mempertimbangkan open DAN close
      const maxPrice = Math.max(open, close);
      const minPrice = Math.min(open, close);
      
      // Wick multiplier: 0.3x - 1.5x dari range (open-close)
      const wickMultiplier = 0.3 + Math.random() * 1.2;
      const bodySize = Math.abs(close - open);
      
      // High = harga tertinggi + random wick ke atas
      const upperWick = bodySize * wickMultiplier * Math.random();
      const high = maxPrice + upperWick;
      
      // Low = harga terendah - random wick ke bawah
      const lowerWick = bodySize * wickMultiplier * Math.random();
      const low = minPrice - lowerWick;

      // Update price untuk candle berikutnya
      price = close;

      // Kadang-kadang reverse trend (20% chance setiap 40 candles)
      if (i % 40 === 0 && Math.random() < 0.2) {
        trendDirection = -trendDirection;
      }

      // Format candle data
      const candleData = {
        o: this.roundPrice(open),
        h: this.roundPrice(Math.max(open, close, high)),
        l: this.roundPrice(Math.min(open, close, low)),
        c: this.roundPrice(close),
        t: candleTimestamp,
        v: this.generateNaturalVolume(basePrice, Math.abs(priceChange / open)),
      };

      candles[candleTimestamp.toString()] = candleData;
    }

    // ✅ FIX: Gunakan flat path ohlc_{timeframe}, bukan nested ohlc/{timeframe}
    const path = `${realtimeDbPath}/ohlc_${timeframe}`;
    
    try {
      await this.getRealtimeDb().ref(path).set(candles);
      this.logger.debug(`Written ${this.CANDLES_TO_CREATE} candles to ${path}`);
    } catch (error) {
      this.logger.error(`Failed to write candles to ${path}: ${error.message}`);
      throw error;
    }
  }

  // ✅ NATURAL PRICE MOVEMENT menggunakan Box-Muller Transform
  private generateNaturalPriceMovement(currentPrice: number, volatility: number): number {
    // Box-Muller transform untuk distribusi normal
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    return currentPrice * volatility * z;
  }

  // ✅ NATURAL VOLUME - Korelasi dengan price movement
  private generateNaturalVolume(basePrice: number, priceChangePercent: number): number {
    // Base volume: 1000 - 10000
    const baseVolume = 1000 + Math.random() * 9000;
    
    // Volume lebih tinggi saat price movement besar
    // Volume multiplier: 1x - 5x tergantung price movement
    const volumeMultiplier = 1 + (priceChangePercent * 100) * (Math.random() * 4);
    
    return Math.floor(baseVolume * Math.min(volumeMultiplier, 5));
  }

  private roundPrice(price: number): number {
    return Math.round(price * 1000000) / 1000000;
  }

  private async setLastPrice(realtimeDbPath: string, price: number): Promise<void> {
    try {
      // ✅ FIX: Gunakan current_price, bukan price
      await this.getRealtimeDb().ref(`${realtimeDbPath}/current_price`).set({
        current: this.roundPrice(price),
        timestamp: Math.floor(Date.now() / 1000),
      });
      this.logger.debug(`Set current_price for ${realtimeDbPath}: ${price}`);
    } catch (error) {
      this.logger.error(`Failed to set current_price: ${error.message}`);
      throw error;
    }
  }

  async initializeMultipleAssets(
    assets: Array<{
      assetId: string;
      symbol: string;
      realtimeDbPath: string;
      initialPrice: number;
      volatility?: number;
    }>,
  ): Promise<void> {
    this.logger.log(`Initializing candles for ${assets.length} assets`);

    const promises = assets.map((asset) =>
      this.initializeAssetCandles(
        asset.assetId,
        asset.symbol,
        asset.realtimeDbPath,
        asset.initialPrice,
        asset.volatility,
      ),
    );

    try {
      await Promise.all(promises);
      this.logger.log(`Successfully initialized all ${assets.length} assets`);
    } catch (error) {
      this.logger.error(`Failed to initialize some assets: ${error.message}`);
      throw error;
    }
  }
}