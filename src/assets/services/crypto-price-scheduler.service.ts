// src/assets/services/crypto-price-scheduler.service.ts
// ✅ UPDATED: Added OHLC generation for crypto assets - FIXED setRealtimeValue typo

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { FirebaseService } from '../../firebase/firebase.service';
import { CryptoCompareService } from './cryptocompare.service';
import { AssetsService } from '../assets.service';
import { CryptoTimeframeManager, CryptoBar } from './crypto-timeframe-manager';
import { ASSET_CATEGORY } from '../../common/constants';
import { Asset } from '../../common/interfaces';

@Injectable()
export class CryptoPriceSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CryptoPriceSchedulerService.name);
  
  private cryptoAssets: Asset[] = [];
  private isRunning = false;
  private updateCount = 0;
  private errorCount = 0;
  private lastUpdateTime = 0;
  
  // ✅ NEW: Timeframe managers for each asset
  private timeframeManagers: Map<string, CryptoTimeframeManager> = new Map();
  
  // ✅ Update every 1 second for real-time OHLC generation
  private readonly UPDATE_INTERVAL = 1000;
  
  // ✅ Refresh asset list every 10 minutes
  private readonly REFRESH_INTERVAL = 600000;
  
  // ✅ Cleanup old OHLC data every 2 hours
  private readonly CLEANUP_INTERVAL = 7200000;
  private lastCleanupTime = 0;

  constructor(
    private firebaseService: FirebaseService,
    private cryptoCompareService: CryptoCompareService,
    private assetsService: AssetsService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    // Wait for Firebase to be ready
    setTimeout(async () => {
      try {
        await this.firebaseService.waitForFirestore(10000);
        await this.loadCryptoAssets();
        await this.startScheduler();
      } catch (error) {
        this.logger.error(`❌ Scheduler initialization failed: ${error.message}`);
      }
    }, 3000);
  }

  /**
   * ✅ Load all active crypto assets
   */
  private async loadCryptoAssets(): Promise<void> {
    try {
      const { assets } = await this.assetsService.getAllAssets(true);
      
      this.cryptoAssets = assets.filter(
        asset => asset.category === ASSET_CATEGORY.CRYPTO
      );
      
      if (this.cryptoAssets.length === 0) {
        this.logger.warn('⚠️ No active crypto assets found');
        return;
      }
      
      // ✅ Initialize timeframe manager for each asset
      this.cryptoAssets.forEach(asset => {
        if (!this.timeframeManagers.has(asset.id)) {
          this.timeframeManagers.set(asset.id, new CryptoTimeframeManager());
          this.logger.debug(`📊 Initialized OHLC manager for ${asset.symbol}`);
        }
      });
      
      this.logger.log('');
      this.logger.log('💎 ================================================');
      this.logger.log('💎 CRYPTO PRICE SCHEDULER WITH OHLC GENERATION');
      this.logger.log('💎 ================================================');
      this.logger.log(`💎 Active Crypto Assets: ${this.cryptoAssets.length}`);
      this.cryptoAssets.forEach(asset => {
        const pair = `${asset.cryptoConfig?.baseCurrency}/${asset.cryptoConfig?.quoteCurrency}`;
        const path = asset.realtimeDbPath || 
          `/crypto/${asset.cryptoConfig?.baseCurrency.toLowerCase()}_${asset.cryptoConfig?.quoteCurrency.toLowerCase()}`;
        this.logger.log(`   • ${asset.symbol} (${pair}) → ${path}`);
      });
      this.logger.log(`⚡ Update Interval: ${this.UPDATE_INTERVAL}ms (${this.UPDATE_INTERVAL / 1000}s)`);
      this.logger.log(`📊 OHLC Timeframes: 1s, 1m, 5m, 15m, 30m, 1h, 4h, 1d`);
      this.logger.log(`🔄 Asset Refresh: ${this.REFRESH_INTERVAL}ms (${this.REFRESH_INTERVAL / 60000}m)`);
      this.logger.log(`🗑️ Cleanup: Every ${this.CLEANUP_INTERVAL / 3600000}h`);
      this.logger.log('💎 ================================================');
      this.logger.log('');
      
    } catch (error) {
      this.logger.error(`❌ Failed to load crypto assets: ${error.message}`);
    }
  }

  /**
   * ✅ Start the scheduler
   */
  private async startScheduler(): Promise<void> {
    if (this.cryptoAssets.length === 0) {
      this.logger.warn('⚠️ No crypto assets to schedule');
      return;
    }

    this.isRunning = true;
    
    // Start immediate update
    await this.updateAllPrices();
    
    // Schedule periodic updates
    const interval = setInterval(async () => {
      if (this.isRunning) {
        await this.updateAllPrices();
      }
    }, this.UPDATE_INTERVAL);
    
    // Store interval for cleanup
    this.schedulerRegistry.addInterval('crypto-price-ohlc-update', interval);
    
    this.logger.log('✅ Crypto price scheduler with OHLC started');
  }

  /**
   * ✅ Refresh crypto assets list (every 10 minutes via Cron)
   */
  @Cron('*/10 * * * *')
  async refreshCryptoAssets() {
    this.logger.debug('🔄 Refreshing crypto assets list...');
    await this.loadCryptoAssets();
  }

  /**
   * ✅ Update all crypto prices and generate OHLC bars
   */
  private async updateAllPrices(): Promise<void> {
    if (this.cryptoAssets.length === 0) return;

    const startTime = Date.now();
    
    try {
      // ✅ Fetch prices in batch (efficient)
      const priceMap = await this.cryptoCompareService.getMultiplePrices(this.cryptoAssets);
      
      let successCount = 0;
      let failCount = 0;
      
      // ✅ Process each asset and generate OHLC
      for (const asset of this.cryptoAssets) {
        const cryptoPrice = priceMap.get(asset.id);
        
        if (cryptoPrice) {
          successCount++;
          
          // ✅ Generate OHLC bars
          await this.generateOHLC(asset, cryptoPrice);
        } else {
          failCount++;
          this.logger.debug(`⚠️ No price for ${asset.symbol}`);
        }
      }
      
      this.updateCount++;
      this.lastUpdateTime = Date.now();
      
      const duration = Date.now() - startTime;
      
      // ✅ Log every 60 updates (every 1 minute if interval is 1s)
      if (this.updateCount % 60 === 0) {
        this.logger.log(
          `💎 Update #${this.updateCount}: ${successCount}/${this.cryptoAssets.length} prices + OHLC updated in ${duration}ms ` +
          `(Success: ${successCount}, Failed: ${failCount})`
        );
      }
      
      // ✅ Periodic cleanup
      const now = Date.now();
      if (now - this.lastCleanupTime > this.CLEANUP_INTERVAL) {
        await this.cleanupOldData();
        this.lastCleanupTime = now;
      }
      
    } catch (error) {
      this.errorCount++;
      this.logger.error(`❌ Batch update failed: ${error.message}`);
    }
  }

  /**
   * ✅ Generate OHLC bars for a crypto asset
   */
  private async generateOHLC(asset: Asset, cryptoPrice: any): Promise<void> {
    try {
      const manager = this.timeframeManagers.get(asset.id);
      if (!manager) {
        this.logger.error(`❌ No timeframe manager for ${asset.symbol}`);
        return;
      }
      
      const timestamp = cryptoPrice.timestamp;
      const price = cryptoPrice.price;
      const volume = cryptoPrice.volume24h || 0;
      
      // ✅ Update all timeframes and get completed/current bars
      const { completedBars, currentBars } = manager.updateBars(
        asset.id,
        timestamp,
        price,
        volume
      );
      
      const path = this.getAssetPath(asset);
      
      // ✅ Write completed bars (these are final, immutable)
      for (const [timeframe, bar] of completedBars.entries()) {
        const barPath = `${path}/ohlc_${timeframe}/${bar.timestamp}`;
        
        await this.firebaseService.setRealtimeDbValue(
          barPath,
          this.cleanBarData(bar),
          false // Not critical, use queue
        );
        
        this.logger.debug(
          `📊 Completed ${timeframe} bar: ${asset.symbol} @ ${bar.datetime}`
        );
      }
      
      // ✅ Write current bars (these update continuously)
      // We write current bars less frequently to reduce DB writes
      if (this.updateCount % 5 === 0) { // Every 5 updates (5 seconds)
        for (const [timeframe, bar] of currentBars.entries()) {
          const barPath = `${path}/ohlc_${timeframe}/${bar.timestamp}`;
          
          await this.firebaseService.setRealtimeDbValue(
            barPath,
            this.cleanBarData(bar),
            false
          );
        }
      }
      
    } catch (error) {
      this.logger.error(
        `❌ OHLC generation failed for ${asset.symbol}: ${error.message}`
      );
    }
  }

  /**
   * ✅ Clean bar data (remove undefined fields)
   */
  private cleanBarData(bar: CryptoBar): any {
    return {
      timestamp: bar.timestamp,
      datetime: bar.datetime,
      datetime_iso: bar.datetime_iso,
      timezone: bar.timezone,
      open: parseFloat(bar.open.toFixed(6)),
      high: parseFloat(bar.high.toFixed(6)),
      low: parseFloat(bar.low.toFixed(6)),
      close: parseFloat(bar.close.toFixed(6)),
      volume: Math.round(bar.volume),
      isCompleted: bar.isCompleted,
    };
  }

  /**
   * ✅ Get asset path in Realtime DB
   */
  private getAssetPath(asset: Asset): string {
    if (asset.realtimeDbPath) {
      return asset.realtimeDbPath.startsWith('/') 
        ? asset.realtimeDbPath 
        : `/${asset.realtimeDbPath}`;
    }
    
    if (!asset.cryptoConfig) {
      this.logger.warn(
        `Asset ${asset.symbol} missing cryptoConfig, using fallback path`
      );
      return `/crypto/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }
    
    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;
    return `/crypto/${baseCurrency.toLowerCase()}_${quoteCurrency.toLowerCase()}`;
  }

  /**
   * ✅ Cleanup old OHLC data
   */
  private async cleanupOldData(): Promise<void> {
    this.logger.log('🗑️ Starting OHLC cleanup...');
    
    const manager = new CryptoTimeframeManager();
    const retentionDays = manager.getRetentionDays();
    
    for (const asset of this.cryptoAssets) {
      try {
        const path = this.getAssetPath(asset);
        
        for (const [timeframe, days] of Object.entries(retentionDays)) {
          const cutoffTimestamp = Math.floor(Date.now() / 1000) - (days * 86400);
          const ohlcPath = `${path}/ohlc_${timeframe}`;
          
          try {
            // Get all bar timestamps
            const snapshot = await this.firebaseService.getRealtimeDbValue(ohlcPath);
            
            if (snapshot) {
              const oldKeys = Object.keys(snapshot).filter(timestamp => {
                return parseInt(timestamp) < cutoffTimestamp;
              });
              
              if (oldKeys.length > 0) {
                this.logger.log(
                  `  🗑️ Deleting ${oldKeys.length} old ${timeframe} bars for ${asset.symbol}`
                );
                
                // Delete in batches
                const updates: any = {};
                oldKeys.forEach(key => {
                  updates[`${ohlcPath}/${key}`] = null;
                });
                
                // Batch delete (more efficient)
                for (const [deletePath, value] of Object.entries(updates)) {
                  await this.firebaseService.setRealtimeDbValue(deletePath, value, false);
                }
              }
            }
          } catch (error) {
            this.logger.debug(`No ${timeframe} data to cleanup for ${asset.symbol}`);
          }
        }
      } catch (error) {
        this.logger.error(`❌ Cleanup error for ${asset.symbol}: ${error.message}`);
      }
    }
    
    this.logger.log('✅ Cleanup completed');
  }

  /**
   * ✅ Log stats (every 2 minutes via Cron)
   */
  @Cron('*/2 * * * *')
  async logStats() {
    const stats = this.cryptoCompareService.getStats();
    const uptime = Date.now() - this.lastUpdateTime;
    
    this.logger.log('');
    this.logger.log('📊 ================================================');
    this.logger.log('📊 CRYPTO PRICE + OHLC SCHEDULER STATS');
    this.logger.log('📊 ================================================');
    this.logger.log(`   Assets: ${this.cryptoAssets.length}`);
    this.logger.log(`   Running: ${this.isRunning ? '✅' : '❌'}`);
    this.logger.log(`   Updates: ${this.updateCount}`);
    this.logger.log(`   Errors: ${this.errorCount}`);
    this.logger.log(`   Last Update: ${Math.floor(uptime / 1000)}s ago`);
    this.logger.log('');
    
    // ✅ OHLC Stats per asset
    this.logger.log('   📊 OHLC Bars Created:');
    this.cryptoAssets.forEach(asset => {
      const manager = this.timeframeManagers.get(asset.id);
      if (manager) {
        const assetStats = manager.getStats(asset.id);
        this.logger.log(`     ${asset.symbol}:`);
        Object.entries(assetStats.timeframes).forEach(([tf, count]) => {
          this.logger.log(`       ${tf}: ${count} bars`);
        });
      }
    });
    this.logger.log('');
    
    this.logger.log('   CryptoCompare Stats:');
    this.logger.log(`     API Calls: ${stats.apiCalls}`);
    this.logger.log(`     Cache Hits: ${stats.cacheHits}`);
    this.logger.log(`     Hit Rate: ${stats.cacheHitRate}`);
    this.logger.log(`     Errors: ${stats.errors}`);
    this.logger.log(`     RT Writes: ${stats.realtimeWrites}`);
    this.logger.log('📊 ================================================');
    this.logger.log('');
  }

  /**
   * ✅ Manual trigger (for testing)
   */
  async triggerUpdate(): Promise<void> {
    this.logger.log('🔄 Manual update triggered');
    await this.updateAllPrices();
  }

  /**
   * ✅ Get scheduler status
   */
  getStatus() {
    const ohlcStats: any = {};
    
    this.cryptoAssets.forEach(asset => {
      const manager = this.timeframeManagers.get(asset.id);
      if (manager) {
        ohlcStats[asset.symbol] = manager.getStats(asset.id);
      }
    });
    
    return {
      isRunning: this.isRunning,
      assetCount: this.cryptoAssets.length,
      updateCount: this.updateCount,
      errorCount: this.errorCount,
      lastUpdate: this.lastUpdateTime > 0 
        ? `${Math.floor((Date.now() - this.lastUpdateTime) / 1000)}s ago`
        : 'Never',
      updateInterval: `${this.UPDATE_INTERVAL}ms`,
      assets: this.cryptoAssets.map(a => ({
        symbol: a.symbol,
        pair: `${a.cryptoConfig?.baseCurrency}/${a.cryptoConfig?.quoteCurrency}`,
        path: a.realtimeDbPath,
      })),
      ohlcStats,
    };
  }

  /**
   * ✅ Cleanup on shutdown
   */
  async onModuleDestroy() {
    this.logger.log('🛑 Stopping crypto price + OHLC scheduler...');
    this.isRunning = false;
    
    try {
      const interval = this.schedulerRegistry.getInterval('crypto-price-ohlc-update');
      if (interval) {
        clearInterval(interval);
        this.schedulerRegistry.deleteInterval('crypto-price-ohlc-update');
      }
    } catch (error) {
      // Interval might not exist
    }
    
    this.logger.log('✅ Crypto price + OHLC scheduler stopped');
  }
}