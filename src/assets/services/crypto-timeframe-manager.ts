import { Logger } from '@nestjs/common';

export interface CryptoBar {
  timestamp: number;
  datetime: string;
  datetime_iso: string;
  timezone: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isCompleted: boolean;
}

export interface TimeframeConfig {
  timeframe: string;
  seconds: number;
}

export class CryptoTimeframeManager {
  private readonly logger = new Logger(CryptoTimeframeManager.name);
  
  private readonly timeframes: TimeframeConfig[] = [
    { timeframe: '1s', seconds: 1 },  
    { timeframe: '1m', seconds: 60 },
    { timeframe: '5m', seconds: 300 },
    { timeframe: '15m', seconds: 900 },
    { timeframe: '30m', seconds: 1800 },
    { timeframe: '1h', seconds: 3600 },
    { timeframe: '4h', seconds: 14400 },
    { timeframe: '1d', seconds: 86400 },
  ];
  
  private currentBars: Map<string, Map<string, CryptoBar>> = new Map();
  private barsCreated: Map<string, number> = new Map();
  
  constructor() {
    this.timeframes.forEach(({ timeframe }) => {
      this.currentBars.set(timeframe, new Map());
      this.barsCreated.set(timeframe, 0);
    });
  }
  
  private getBarTimestamp(timestamp: number, seconds: number): number {
    return Math.floor(timestamp / seconds) * seconds;
  }
  
  private formatDateTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  
  updateBars(
    assetId: string,
    timestamp: number,
    price: number,
    volume: number
  ): {
    completedBars: Map<string, CryptoBar>;
    currentBars: Map<string, CryptoBar>;
  } {
    const completedBars = new Map<string, CryptoBar>();
    const currentBars = new Map<string, CryptoBar>();
    
    for (const { timeframe, seconds } of this.timeframes) {
      const barTimestamp = this.getBarTimestamp(timestamp, seconds);
      const barKey = `${assetId}_${timeframe}`;
      
      const tfBars = this.currentBars.get(timeframe)!;
      const existingBar = tfBars.get(barKey);
      
      if (existingBar && existingBar.timestamp !== barTimestamp) {
        const completedBar: CryptoBar = {
          ...existingBar,
          isCompleted: true,
        };
        completedBars.set(timeframe, completedBar);
        
        const count = this.barsCreated.get(timeframe) || 0;
        this.barsCreated.set(timeframe, count + 1);
        
        this.logger.debug(
          `✅ Completed ${timeframe} bar for ${assetId} @ ${this.formatDateTime(existingBar.timestamp)}`
        );
      }
      
      let currentBar: CryptoBar;
      
      if (!existingBar || existingBar.timestamp !== barTimestamp) {
        currentBar = {
          timestamp: barTimestamp,
          datetime: this.formatDateTime(barTimestamp),
          datetime_iso: new Date(barTimestamp * 1000).toISOString(),
          timezone: 'Asia/Jakarta',
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volume,
          isCompleted: false,
        };
        
        this.logger.debug(
          `🆕 New ${timeframe} bar for ${assetId} @ ${currentBar.datetime}`
        );
      } else {
        currentBar = {
          ...existingBar,
          high: Math.max(existingBar.high, price),
          low: Math.min(existingBar.low, price),
          close: price,
          volume: volume,
          isCompleted: false,
        };
      }
      
      tfBars.set(barKey, currentBar);
      currentBars.set(timeframe, currentBar);
    }
    
    return { completedBars, currentBars };
  }
  
  getStats(assetId: string): any {
    const stats: any = {
      assetId,
      timeframes: {},
      totalBarsCreated: 0,
    };
    
    for (const { timeframe } of this.timeframes) {
      const count = this.barsCreated.get(timeframe) || 0;
      stats.timeframes[timeframe] = count;
      stats.totalBarsCreated += count;
    }
    
    return stats;
  }
  
  reset(assetId: string): void {
    for (const { timeframe } of this.timeframes) {
      const tfBars = this.currentBars.get(timeframe)!;
      const barKey = `${assetId}_${timeframe}`;
      tfBars.delete(barKey);
    }
    
    this.logger.log(`🔄 Reset OHLC bars for ${assetId}`);
  }
  
  // ✅ FIXED: Retention 1s diubah dari 0.002778 (4 menit) menjadi 0.00694 (10 menit)
  // Agar 240 candles historical (4 menit) aman dari cleanup
  getRetentionDays(): Record<string, number> {
    return {
      '1s': 0.00694,   // ✅ 10 menit = 600 detik (buffer aman untuk 240 candles = 4 menit)
      '1m': 0.1667,    // 4 jam (240 candles)
      '5m': 0.8333,    // 20 jam (240 candles)
      '15m': 2.5,      // 2.5 hari (240 candles)
      '30m': 5,        // 5 hari (240 candles)
      '1h': 10,        // 10 hari (240 candles)
      '4h': 40,        // 40 hari (240 candles)
      '1d': 240,       // 240 hari (240 candles)
    };
  }
}