// ============================================
// FILE: src/assets/helpers/initialize-asset-candles.helper.ts
// ============================================
// ✅ FIXED VERSION - Natural OHLC Generation
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';

@Injectable()
export class InitializeAssetCandlesHelper {
  private readonly logger = new Logger(InitializeAssetCandlesHelper.name);
  
  // Timeframes dengan durasi dalam detik
  private readonly TIMEFRAMES = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '1d': 86400,
  };
  
  private readonly CANDLES_TO_CREATE = 240;

  constructor(private firebaseService: FirebaseService) {}

  private getRealtimeDb() {
    return this.firebaseService.getRealtimeDatabase();
  }

  async initializeAssetCandles(
    assetId: string,
    symbol: string,
    realtimeDbPath: string,
    initialPrice: number,
    volatility: number = 0.001,
  ): Promise<void> {
    this.logger.log(`🕐 Initializing 240 candles for asset: ${symbol} (${assetId})`);

    try {
      const now = Math.floor(Date.now() / 1000);

      // Generate candles untuk setiap timeframe
      for (const [timeframe, durationInSeconds] of Object.entries(this.TIMEFRAMES)) {
        this.logger.log(`📊 Generating ${this.CANDLES_TO_CREATE} candles for ${symbol} - ${timeframe}`);
        
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

      this.logger.log(`✅ Successfully initialized all candles for ${symbol}`);
    } catch (error) {
      this.logger.error(`❌ Failed to initialize candles for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // ✅ PERBAIKAN UTAMA: Natural OHLC Generation
  // ============================================
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

    // Generate 240 candles mundur dari waktu sekarang
    for (let i = this.CANDLES_TO_CREATE - 1; i >= 0; i--) {
      const candleTimestamp = currentTimestamp - (i * durationInSeconds);
      
      // ============================================
      // ✅ NATURAL OHLC GENERATION
      // Generate multiple price movements within the candle
      // untuk mendapatkan high/low yang natural
      // ============================================
      const open = price;
      
      // Jumlah pergerakan harga dalam 1 candle (random 5-12)
      // Semakin banyak pergerakan, semakin smooth chart-nya
      const numMovements = Math.floor(Math.random() * 8) + 5;
      
      // Array untuk menyimpan semua pergerakan harga
      const prices: number[] = [open];
      
      // Generate random walk movements
      for (let j = 0; j < numMovements; j++) {
        const movement = this.generatePriceMovement(open, volatility);
        const nextPrice = prices[prices.length - 1] + movement;
        prices.push(nextPrice);
      }
      
      // Close adalah harga terakhir dari movements
      const close = prices[prices.length - 1];
      
      // High dan Low adalah max/min dari semua movements
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      
      // Update price untuk candle berikutnya
      // Ini membuat chart continuous/connected
      price = close;

      // ✅ Format candle data dengan validasi
      // Pastikan H >= O,C dan L <= O,C (standar OHLC)
      const candleData = {
        o: this.roundPrice(open),
        h: this.roundPrice(Math.max(open, close, high)), // Pastikan high >= open dan close
        l: this.roundPrice(Math.min(open, close, low)),   // Pastikan low <= open dan close
        c: this.roundPrice(close),
        t: candleTimestamp,
        v: this.generateVolume(),
      };

      candles[candleTimestamp.toString()] = candleData;
    }

    // Path yang benar: ohlc_{timeframe} bukan ohlc/{timeframe}
    const path = `${realtimeDbPath}/ohlc_${timeframe}`;
    
    try {
      await this.getRealtimeDb().ref(path).set(candles);
      this.logger.debug(`✅ Written ${this.CANDLES_TO_CREATE} candles to ${path}`);
    } catch (error) {
      this.logger.error(`❌ Failed to write candles to ${path}: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // ✅ PERBAIKAN: Price Movement yang Lebih Smooth
  // ============================================
  private generatePriceMovement(currentPrice: number, volatility: number): number {
    // ✅ Menggunakan Box-Muller transform untuk distribusi normal
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // ✅ PENTING: Scale down volatility karena sekarang ada multiple movements per candle
    // Volatility dibagi 10 karena 1 candle punya 5-12 movements
    // Tanpa ini, pergerakan akan terlalu besar
    return currentPrice * (volatility / 10) * z;
  }

  // ============================================
  // ✅ PERBAIKAN: Volume Generation yang Lebih Realistis
  // ============================================
  private generateVolume(): number {
    // ✅ Menggunakan distribusi log-normal untuk volume
    // Ini lebih realistis karena volume trading biasanya mengikuti pola ini
    const mean = 5000;
    const stdDev = 2000;
    
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Pastikan volume minimal 1000
    const volume = Math.max(1000, mean + stdDev * z);
    return Math.floor(volume);
  }

  // Round price ke 6 decimal places
  private roundPrice(price: number): number {
    return Math.round(price * 1000000) / 1000000;
  }

  private async setLastPrice(realtimeDbPath: string, price: number): Promise<void> {
    try {
      // Set current_price untuk simulator
      await this.getRealtimeDb().ref(`${realtimeDbPath}/current_price`).set({
        current: this.roundPrice(price),
        timestamp: Math.floor(Date.now() / 1000),
      });
      this.logger.debug(`✅ Set current_price for ${realtimeDbPath}: ${price}`);
    } catch (error) {
      this.logger.error(`❌ Failed to set current_price: ${error.message}`);
      throw error;
    }
  }

  // Bulk initialization untuk multiple assets
  async initializeMultipleAssets(
    assets: Array<{
      assetId: string;
      symbol: string;
      realtimeDbPath: string;
      initialPrice: number;
      volatility?: number;
    }>,
  ): Promise<void> {
    this.logger.log(`🚀 Initializing candles for ${assets.length} assets`);

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
      this.logger.log(`✅ Successfully initialized all ${assets.length} assets`);
    } catch (error) {
      this.logger.error(`❌ Failed to initialize some assets: ${error.message}`);
      throw error;
    }
  }
}
