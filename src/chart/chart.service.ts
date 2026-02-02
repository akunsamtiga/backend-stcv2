// src/chart/chart.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { AssetsService } from '../assets/assets.service';
import { CandleData, OHLCResponse, ChartUpdate } from './interfaces/candle.interface';
import { TimezoneUtil } from '../common/utils/timezone.util';

@Injectable()
export class ChartService {
  private readonly logger = new Logger(ChartService.name);
  
  // Cache untuk mengurangi beban Firebase
  private chartCache: Map<string, { data: CandleData[]; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 detik

  constructor(
    private firebaseService: FirebaseService,
    private assetsService: AssetsService,
  ) {}

  /**
   * Mengambil data OHLC historis dari Firebase Realtime DB
   * Format siap pakai untuk TradingView Lightweight Charts
   */
  async getOHLC(
    assetId: string, 
    timeframe: string, 
    limit: number = 240,
    from?: number,
    to?: number
  ): Promise<OHLCResponse> {
    const startTime = Date.now();
    
    // Get asset info
    const asset = await this.assetsService.getAssetById(assetId);
    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }

    const cacheKey = `${assetId}_${timeframe}_${limit}_${from}_${to}`;
    const cached = this.chartCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.debug(`Serving ${asset.symbol} ${timeframe} from cache`);
      return {
        assetId,
        symbol: asset.symbol,
        timeframe,
        data: cached.data,
        lastUpdate: Date.now(),
        timezone: 'Asia/Jakarta',
      };
    }

    try {
      const path = this.getAssetOHLCPath(asset, timeframe);
      
      // Fetch dari Firebase Realtime DB
      const snapshot = await this.firebaseService.getRealtimeDbValue(path);
      
      if (!snapshot) {
        return {
          assetId,
          symbol: asset.symbol,
          timeframe,
          data: [],
          lastUpdate: Date.now(),
          timezone: 'Asia/Jakarta',
        };
      }

      // Transform data ke format Lightweight Charts
      let candles = this.transformToCandleData(snapshot);
      
      // Filter by time range jika ada
      if (from) {
        candles = candles.filter(c => c.time >= from);
      }
      if (to) {
        candles = candles.filter(c => c.time <= to);
      }
      
      // Sort by time ascending (penting untuk chart)
      candles.sort((a, b) => a.time - b.time);
      
      // Limit jumlah candle (ambil yang paling baru)
      if (candles.length > limit) {
        candles = candles.slice(-limit);
      }

      // Cache hasil
      this.chartCache.set(cacheKey, { data: candles, timestamp: Date.now() });
      
      const duration = Date.now() - startTime;
      this.logger.debug(`Fetched ${candles.length} candles for ${asset.symbol} ${timeframe} in ${duration}ms`);

      return {
        assetId,
        symbol: asset.symbol,
        timeframe,
        data: candles,
        lastUpdate: Date.now(),
        timezone: 'Asia/Jakarta',
      };

    } catch (error) {
      this.logger.error(`Failed to fetch OHLC: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get current forming candle (real-time)
   */
  async getCurrentCandle(assetId: string, timeframe: string): Promise<CandleData | null> {
    try {
      const asset = await this.assetsService.getAssetById(assetId);
      const path = `${this.getAssetOHLCPath(asset, timeframe)}/current`;
      
      const data = await this.firebaseService.getRealtimeDbValue(path);
      if (!data) return null;
      
      return this.transformSingleCandle(data);
    } catch (error) {
      this.logger.error(`Failed to get current candle: ${error.message}`);
      return null;
    }
  }

  /**
   * Mendapatkan path Firebase untuk OHLC berdasarkan asset
   */
  private getAssetOHLCPath(asset: any, timeframe: string): string {
    let basePath: string;
    
    if (asset.category === 'crypto' && asset.cryptoConfig) {
      const quote = asset.cryptoConfig.quoteCurrency.toLowerCase().replace('usd', 'usdt');
      basePath = `/crypto/${asset.cryptoConfig.baseCurrency.toLowerCase()}_${quote}`;
    } else if (asset.dataSource === 'mock') {
      basePath = `/mock/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    } else if (asset.realtimeDbPath) {
      basePath = asset.realtimeDbPath.startsWith('/') ? asset.realtimeDbPath : `/${asset.realtimeDbPath}`;
    } else {
      basePath = `/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }
    
    return `${basePath}/ohlc_${timeframe}`;
  }

  /**
   * Transform data Firebase ke format CandleData
   */
  private transformToCandleData(snapshot: any): CandleData[] {
    const candles: CandleData[] = [];
    
    Object.entries(snapshot).forEach(([timestamp, data]: [string, any]) => {
      if (data && typeof data === 'object' && data.open !== undefined) {
        candles.push({
          time: parseInt(timestamp),
          open: parseFloat(data.open),
          high: parseFloat(data.high),
          low: parseFloat(data.low),
          close: parseFloat(data.close),
          volume: parseInt(data.volume) || 0,
        });
      }
    });
    
    return candles;
  }

  private transformSingleCandle(data: any): CandleData {
    return {
      time: data.timestamp,
      open: parseFloat(data.open),
      high: parseFloat(data.high),
      low: parseFloat(data.low),
      close: parseFloat(data.close),
      volume: parseInt(data.volume) || 0,
    };
  }

  /**
   * Format untuk Lightweight Charts series
   * @see https://tradingview.github.io/lightweight-charts/docs/api/interfaces/CandlestickData
   */
  formatForLightweightCharts(data: CandleData[]) {
    return data.map(candle => ({
      time: candle.time, // Unix timestamp in seconds
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
  }

  clearCache(): void {
    this.chartCache.clear();
    this.logger.log('Chart cache cleared');
  }
}