// backendv2/src/assets/helpers/initialize-asset-candles.helper.ts
// ✅ FIXED VERSION - Menggunakan field names lengkap, bukan singkatan

import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { TimezoneUtil } from '../../common/utils';

@Injectable()
export class InitializeAssetCandlesHelper {
  private readonly logger = new Logger(InitializeAssetCandlesHelper.name);

  // 240 candles untuk setiap timeframe
  private readonly CANDLES_TO_CREATE = 240;

  // Timeframe dalam detik
  private readonly TIMEFRAMES: Record<string, number> = {
    '1s': 1,
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  };

  constructor(
    private readonly firebase: FirebaseService,
  ) {}

  private getRealtimeDb() {
    return this.firebase.getRealtimeDatabase();
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

    // Generate 240 candles mundur dari waktu sekarang
    for (let i = this.CANDLES_TO_CREATE - 1; i >= 0; i--) {
      const candleTimestamp = currentTimestamp - (i * durationInSeconds);
      
      // Generate OHLC data dengan simulasi random walk
      const open = price;
      const priceChange = this.generatePriceMovement(price, volatility);
      
      const high = open + Math.abs(priceChange) * Math.random() * 1.5;
      const low = open - Math.abs(priceChange) * Math.random() * 1.5;
      const close = open + priceChange;

      price = close;

      // ✅ FIX: Gunakan field names LENGKAP seperti yang diharapkan
      const dateInfo = TimezoneUtil.getDateTimeInfo(new Date(candleTimestamp * 1000));
      
      const candleData = {
        open: this.roundPrice(open),
        high: this.roundPrice(Math.max(open, close, high)),
        low: this.roundPrice(Math.min(open, close, low)),
        close: this.roundPrice(close),
        timestamp: candleTimestamp,
        datetime: dateInfo.datetime,
        datetime_iso: dateInfo.datetime_iso,
        timezone: 'Asia/Jakarta',
        volume: this.generateVolume(),
        isCompleted: true,  // Historical candles are always completed
      };

      candles[candleTimestamp.toString()] = candleData;
    }

    // ✅ Gunakan flat path ohlc_{timeframe}, bukan nested ohlc/{timeframe}
    const path = `${realtimeDbPath}/ohlc_${timeframe}`;
    
    try {
      await this.getRealtimeDb().ref(path).set(candles);
      this.logger.debug(`Written ${this.CANDLES_TO_CREATE} candles to ${path}`);
    } catch (error) {
      this.logger.error(`Failed to write candles to ${path}: ${error.message}`);
      throw error;
    }
  }

  private generatePriceMovement(currentPrice: number, volatility: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return currentPrice * volatility * z;
  }

  private generateVolume(): number {
    return Math.floor(1000 + Math.random() * 9000);
  }

  private roundPrice(price: number): number {
    return Math.round(price * 1000000) / 1000000;
  }

  private async setLastPrice(realtimeDbPath: string, price: number): Promise<void> {
    try {
      // ✅ Gunakan current_price, bukan price
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