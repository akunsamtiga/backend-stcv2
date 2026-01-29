// src/assets/helpers/initialize-asset-candles.helper.ts

import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

/**
 * ✅ UPDATED VERSION: Candle initialization dengan volatilitas 50x
 * 
 * Perubahan utama:
 * 1. Volatilitas untuk generate 240 candle = 50x dari settingan aset
 * 2. Price terakhir dari candle disimpan ke current_price (tidak loncat ke initial)
 * 3. Setelah initialization, simulator melanjutkan dari price terakhir candle
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
  
  // ✅ Multiplier untuk initialization volatility (50x)
  private readonly VOLATILITY_MULTIPLIER = 50;

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

  /**
   * ✅ UPDATED: Initialize candles dengan volatilitas 50x dan price continuity
   */
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
    this.logger.log(`🚀 Initializing 240 candles for asset: ${symbol} (${assetId})`);
    
    // ✅ ENHANCED: Gunakan volatilitas 50x untuk generate candle历史
    const originalSettings = {
      dailyVolatilityMin: simulatorSettings?.dailyVolatilityMin ?? 0.001,
      dailyVolatilityMax: simulatorSettings?.dailyVolatilityMax ?? 0.005,
      secondVolatilityMin: simulatorSettings?.secondVolatilityMin ?? 0.00001,
      secondVolatilityMax: simulatorSettings?.secondVolatilityMax ?? 0.00008,
    };

    // Kalikan dengan 50 untuk initialization
    const settings = {
      dailyVolatilityMin: originalSettings.dailyVolatilityMin * this.VOLATILITY_MULTIPLIER,
      dailyVolatilityMax: originalSettings.dailyVolatilityMax * this.VOLATILITY_MULTIPLIER,
      secondVolatilityMin: originalSettings.secondVolatilityMin * this.VOLATILITY_MULTIPLIER,
      secondVolatilityMax: originalSettings.secondVolatilityMax * this.VOLATILITY_MULTIPLIER,
      minPrice: simulatorSettings?.minPrice ?? initialPrice * 0.5,
      maxPrice: simulatorSettings?.maxPrice ?? initialPrice * 2.0,
    };

    this.logger.log(`📊 Initialization Settings (${this.VOLATILITY_MULTIPLIER}x Volatility):`);
    this.logger.log(`   Original Daily: ${originalSettings.dailyVolatilityMin} - ${originalSettings.dailyVolatilityMax}`);
    this.logger.log(`   Used Daily: ${settings.dailyVolatilityMin} - ${settings.dailyVolatilityMax} (${this.VOLATILITY_MULTIPLIER}x)`);
    this.logger.log(`   Original Second: ${originalSettings.secondVolatilityMin} - ${originalSettings.secondVolatilityMax}`);
    this.logger.log(`   Used Second: ${settings.secondVolatilityMin} - ${settings.secondVolatilityMax} (${this.VOLATILITY_MULTIPLIER}x)`);
    this.logger.log(`   Price Range: ${settings.minPrice} - ${settings.maxPrice}`);
    this.logger.log(`   Initial Price: ${initialPrice}`);

    try {
      const now = Math.floor(Date.now() / 1000);
      let finalPrice = initialPrice; // ✅ Track price terakhir

      // Generate candles untuk setiap timeframe
      for (const [timeframe, durationInSeconds] of Object.entries(this.TIMEFRAMES)) {
        this.logger.log(`📈 Generating ${this.CANDLES_TO_CREATE} candles for ${symbol} - ${timeframe}`);
        
        // Pilih volatility yang sesuai dengan timeframe
        const volatility = this.getVolatilityForTimeframe(timeframe, settings);
        
        // ✅ Simpan price terakhir dari generate
        const timeframeFinalPrice = await this.generateCandlesForTimeframe(
          realtimeDbPath,
          timeframe,
          durationInSeconds,
          now,
          initialPrice, // Gunakan initialPrice untuk tiap timeframe agar konsisten
          volatility,
          settings.minPrice,
          settings.maxPrice,
        );
        
        // Untuk 1s timeframe, simpan sebagai final price untuk current_price
        if (timeframe === '1s') {
          finalPrice = timeframeFinalPrice;
        }
      }

      // ✅ SET CURRENT_PRICE ke price terakhir dari candle 1s, bukan initialPrice!
      await this.setLastPrice(realtimeDbPath, finalPrice);
      this.logger.log(`✅ Set current_price to final candle price: ${finalPrice} (was ${initialPrice})`);

      this.logger.log(`✅ Successfully initialized all candles for ${symbol} (${this.VOLATILITY_MULTIPLIER}x volatility mode)`);
    } catch (error) {
      this.logger.error(`❌ Failed to initialize candles for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Pilih volatility yang sesuai dengan timeframe
   */
  private getVolatilityForTimeframe(
    timeframe: string,
    settings: {
      dailyVolatilityMin: number;
      dailyVolatilityMax: number;
      secondVolatilityMin: number;
      secondVolatilityMax: number;
    },
  ): number {
    let volatilityMin: number;
    let volatilityMax: number;

    // Timeframe kecil menggunakan secondVolatility
    if (timeframe === '1s' || timeframe === '1m') {
      volatilityMin = settings.secondVolatilityMin;
      volatilityMax = settings.secondVolatilityMax;
    }
    // Timeframe menengah menggunakan blend
    else if (timeframe === '5m' || timeframe === '15m' || timeframe === '30m') {
      volatilityMin = (settings.secondVolatilityMin + settings.dailyVolatilityMin) / 2;
      volatilityMax = (settings.secondVolatilityMax + settings.dailyVolatilityMax) / 2;
    }
    // Timeframe besar menggunakan dailyVolatility
    else {
      volatilityMin = settings.dailyVolatilityMin;
      volatilityMax = settings.dailyVolatilityMax;
    }

    // Return random value between min and max
    return volatilityMin + Math.random() * (volatilityMax - volatilityMin);
  }

  /**
   * ✅ UPDATED: Generate candles dengan boundaries dan return final price
   */
  private async generateCandlesForTimeframe(
    realtimeDbPath: string,
    timeframe: string,
    durationInSeconds: number,
    currentTimestamp: number,
    basePrice: number,
    volatility: number,
    minPrice: number,
    maxPrice: number,
  ): Promise<number> { // ✅ Return type number (final price)
    
    const candles: Record<string, any> = {};
    let price = basePrice;

    // Generate 240 candles mundur dari waktu sekarang
    for (let i = this.CANDLES_TO_CREATE - 1; i >= 0; i--) {
      const candleTimestamp = currentTimestamp - (i * durationInSeconds);
      
      // Generate OHLC data dengan simulasi random walk
      const open = price;
      const priceChange = this.generatePriceMovement(price, volatility);
      
      // Calculate potential close price
      let close = open + priceChange;
      
      // ENFORCE BOUNDARIES: Pastikan close tidak keluar dari range
      close = Math.max(minPrice, Math.min(maxPrice, close));
      
      // Generate high and low dengan variasi
      const variationFactor = Math.abs(priceChange) * Math.random() * 1.5;
      let high = Math.max(open, close) + variationFactor;
      let low = Math.min(open, close) - variationFactor;
      
      // ENFORCE BOUNDARIES: Pastikan high dan low juga dalam range
      high = Math.max(minPrice, Math.min(maxPrice, high));
      low = Math.max(minPrice, Math.min(maxPrice, low));
      
      // Update price untuk candle berikutnya
      price = close;
      
      // PULL BACK: Jika price mendekati boundaries, tarik kembali ke center
      const priceRange = maxPrice - minPrice;
      const distanceToMin = price - minPrice;
      const distanceToMax = maxPrice - price;
      
      if (distanceToMin < priceRange * 0.1) {
        // Terlalu dekat dengan minPrice, tarik ke atas
        price = price + priceRange * 0.05;
      } else if (distanceToMax < priceRange * 0.1) {
        // Terlalu dekat dengan maxPrice, tarik ke bawah
        price = price - priceRange * 0.05;
      }

      // Format candle data
      const candleData = {
        o: this.roundPrice(open),
        h: this.roundPrice(high),
        l: this.roundPrice(low),
        c: this.roundPrice(close),
        t: candleTimestamp,
        v: this.generateVolume(),
      };

      candles[candleTimestamp.toString()] = candleData;
    }

    // Write to Realtime Database
    const path = `${realtimeDbPath}/ohlc_${timeframe}`;
    
    try {
      await this.getRealtimeDb().ref(path).set(candles);
      this.logger.debug(`✅ Written ${this.CANDLES_TO_CREATE} candles to ${path}`);
      this.logger.debug(`   Final price: ${price.toFixed(6)}, Initial was: ${basePrice.toFixed(6)}`);
    } catch (error) {
      this.logger.error(`❌ Failed to write candles to ${path}: ${error.message}`);
      throw error;
    }

    return price; // ✅ Return final price (close price of last candle)
  }

  /**
   * Generate price movement menggunakan Box-Muller transform untuk distribusi normal
   */
  private generatePriceMovement(currentPrice: number, volatility: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    
    // Box-Muller transform untuk distribusi normal
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    return currentPrice * volatility * z;
  }

  /**
   * Generate volume dengan variasi random
   */
  private generateVolume(): number {
    return Math.floor(1000 + Math.random() * 9000);
  }

  /**
   * Round price ke 6 desimal
   */
  private roundPrice(price: number): number {
    return Math.round(price * 1000000) / 1000006;
  }

  /**
   * Set current price di Realtime Database dengan struktur lengkap
   */
  private async setLastPrice(realtimeDbPath: string, price: number): Promise<void> {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      
      // ✅ Struktur lengkap seperti simulator
      const priceData = {
        price: this.roundPrice(price),
        current: this.roundPrice(price), // Untuk kompatibilitas
        timestamp: timestamp,
        datetime: this.formatDateTime(new Date(timestamp * 1000)),
        datetime_iso: new Date(timestamp * 1000).toISOString(),
        timezone: 'Asia/Jakarta',
        change: 0,
      };
      
      await this.getRealtimeDb().ref(`${realtimeDbPath}/current_price`).set(priceData);
      this.logger.debug(`✅ Set current_price for ${realtimeDbPath}: ${price}`);
    } catch (error) {
      this.logger.error(`❌ Failed to set current_price: ${error.message}`);
      throw error;
    }
  }

  /**
   * Format datetime untuk Asia/Jakarta
   */
  private formatDateTime(date: Date): string {
    const jakartaDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const year = jakartaDate.getFullYear();
    const month = String(jakartaDate.getMonth() + 1).padStart(2, '0');
    const day = String(jakartaDate.getDate()).padStart(2, '0');
    const hours = String(jakartaDate.getHours()).padStart(2, '0');
    const minutes = String(jakartaDate.getMinutes()).padStart(2, '0');
    const seconds = String(jakartaDate.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * BATCH PROCESSING: Initialize multiple assets sekaligus
   */
  async initializeMultipleAssets(
    assets: Array<{
      assetId: string;
      symbol: string;
      realtimeDbPath: string;
      initialPrice: number;
      simulatorSettings?: {
        dailyVolatilityMin?: number;
        dailyVolatilityMax?: number;
        secondVolatilityMin?: number;
        secondVolatilityMax?: number;
        minPrice?: number;
        maxPrice?: number;
      };
    }>,
  ): Promise<void> {
    this.logger.log(`🚀 Initializing candles for ${assets.length} assets with ${this.VOLATILITY_MULTIPLIER}x volatility`);

    const promises = assets.map((asset) =>
      this.initializeAssetCandles(
        asset.assetId,
        asset.symbol,
        asset.realtimeDbPath,
        asset.initialPrice,
        asset.simulatorSettings,
      ),
    );

    try {
      await Promise.all(promises);
      this.logger.log(`✅ Successfully initialized all ${assets.length} assets`);
    } catch (error) {
      this.logger.error(`❌ Failed to initialize some assets: ${error.message}`);
      throw error;
    }
  }
}