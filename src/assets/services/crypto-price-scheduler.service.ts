import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { FirebaseService } from '../../firebase/firebase.service';
import { BinanceService } from './binance.service';  // ✅ CHANGED
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
  
  private timeframeManagers: Map<string, CryptoTimeframeManager> = new Map();
  
  private readonly UPDATE_INTERVAL = 1000;
  private readonly REFRESH_INTERVAL = 600000;
  private readonly CLEANUP_INTERVAL = 7200000;
  private lastCleanupTime = 0;
  
  // ✅ NEW: Track if scheduler should be active
  private schedulerActive = false;
  private updateIntervalHandle: any = null;

  constructor(
    private firebaseService: FirebaseService,
    private binanceService: BinanceService,  // ✅ CHANGED
    private assetsService: AssetsService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    setTimeout(async () => {
      try {
        await this.firebaseService.waitForFirestore(10000);
        await this.loadCryptoAssets();
        
        // ✅ Only start if there are crypto assets
        if (this.cryptoAssets.length > 0) {
          await this.startScheduler();
        } else {
          this.logger.warn('⚠️ No crypto assets found - scheduler NOT started');
          this.logger.warn('💡 Crypto assets will be handled by backend when added');
        }
      } catch (error) {
        this.logger.error(`❌ Scheduler initialization failed: ${error.message}`);
      }
    }, 3000);
  }

  private async loadCryptoAssets(): Promise<void> {
    try {
      const { assets } = await this.assetsService.getAllAssets(true);
      
      this.cryptoAssets = assets.filter(
        asset => asset.category === ASSET_CATEGORY.CRYPTO
      );
      
      if (this.cryptoAssets.length === 0) {
        this.logger.warn('⚠️ No active crypto assets found');
        this.logger.warn('💡 If you add crypto assets, restart the backend');
        return;
      }
      
      // Initialize managers for each crypto asset
      this.cryptoAssets.forEach(asset => {
        if (!this.timeframeManagers.has(asset.id)) {
          this.timeframeManagers.set(asset.id, new CryptoTimeframeManager());
          this.logger.debug(`📊 Initialized OHLC manager for ${asset.symbol}`);
        }
      });
      
      this.logger.log('');
      this.logger.log('💎 ================================================');
      this.logger.log('💎 CRYPTO PRICE SCHEDULER WITH OHLC - BINANCE');  // ✅ CHANGED
      this.logger.log('💎 ================================================');
      this.logger.log(`💎 Active Crypto Assets: ${this.cryptoAssets.length}`);
      this.cryptoAssets.forEach(asset => {
        const pair = `${asset.cryptoConfig?.baseCurrency}/${asset.cryptoConfig?.quoteCurrency}`;
        const path = asset.realtimeDbPath || 
          `/crypto/${asset.cryptoConfig?.baseCurrency.toLowerCase()}_${asset.cryptoConfig?.quoteCurrency.toLowerCase().replace('usd', 'usdt')}`;
        this.logger.log(`   • ${asset.symbol} (${pair}) → ${path}`);
      });
      this.logger.log(`⚡ Update Interval: ${this.UPDATE_INTERVAL}ms (${this.UPDATE_INTERVAL / 1000}s)`);
      this.logger.log(`📊 OHLC Timeframes: 1s, 1m, 5m, 15m, 30m, 1h, 4h, 1d`);
      this.logger.log(`🔄 Asset Refresh: ${this.REFRESH_INTERVAL}ms (${this.REFRESH_INTERVAL / 60000}m)`);
      this.logger.log(`🗑️ Cleanup: Every ${this.CLEANUP_INTERVAL / 3600000}h`);
      this.logger.log('💎 API: Binance FREE (No API key needed)');  // ✅ CHANGED
      this.logger.log('💎 ================================================');
      this.logger.log('');
      
    } catch (error) {
      this.logger.error(`❌ Failed to load crypto assets: ${error.message}`);
    }
  }

  private async startScheduler(): Promise<void> {
    // ✅ Safety check
    if (this.cryptoAssets.length === 0) {
      this.logger.warn('⚠️ Cannot start scheduler: no crypto assets');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('⚠️ Scheduler already running');
      return;
    }

    this.isRunning = true;
    this.schedulerActive = true;
    
    // Initial update
    await this.updateAllPrices();
    
    // Start interval
    this.updateIntervalHandle = setInterval(async () => {
      if (this.isRunning && this.schedulerActive) {
        await this.updateAllPrices();
      }
    }, this.UPDATE_INTERVAL);
    
    this.logger.log('✅ Crypto price scheduler with OHLC started (Binance)');  // ✅ CHANGED
  }

  @Cron('*/10 * * * *')
  async refreshCryptoAssets() {
    this.logger.debug('🔄 Refreshing crypto assets list...');
    
    const previousCount = this.cryptoAssets.length;
    await this.loadCryptoAssets();
    const currentCount = this.cryptoAssets.length;
    
    // ✅ Handle state changes
    if (previousCount === 0 && currentCount > 0) {
      this.logger.log('✅ Crypto assets detected! Starting scheduler...');
      await this.startScheduler();
    } else if (previousCount > 0 && currentCount === 0) {
      this.logger.warn('⚠️ No more crypto assets! Stopping scheduler...');
      await this.stopScheduler();
    }
  }

  private async updateAllPrices(): Promise<void> {
    // ✅ Safety check
    if (this.cryptoAssets.length === 0) {
      this.logger.debug('⏭️ No crypto assets to update, skipping');
      return;
    }

    const startTime = Date.now();
    
    try {
      const priceMap = await this.binanceService.getMultiplePrices(this.cryptoAssets);  // ✅ CHANGED
      
      let successCount = 0;
      let failCount = 0;
      
      for (const asset of this.cryptoAssets) {
        const cryptoPrice = priceMap.get(asset.id);
        
        if (cryptoPrice) {
          successCount++;
          await this.generateOHLC(asset, cryptoPrice);
        } else {
          failCount++;
          this.logger.debug(`⚠️ No price for ${asset.symbol}`);
        }
      }
      
      this.updateCount++;
      this.lastUpdateTime = Date.now();
      
      const duration = Date.now() - startTime;
      
      if (this.updateCount % 60 === 0) {
        this.logger.log(
          `💎 Update #${this.updateCount}: ${successCount}/${this.cryptoAssets.length} prices + OHLC updated in ${duration}ms ` +
          `(Success: ${successCount}, Failed: ${failCount})`
        );
      }
      
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
      
      const { completedBars, currentBars } = manager.updateBars(
        asset.id,
        timestamp,
        price,
        volume
      );
      
      const path = this.getAssetPath(asset);
      
      for (const [timeframe, bar] of completedBars.entries()) {
        const barPath = `${path}/ohlc_${timeframe}/${bar.timestamp}`;
        
        await this.firebaseService.setRealtimeDbValue(
          barPath,
          this.cleanBarData(bar),
          false
        );
        
        this.logger.debug(
          `📊 Completed ${timeframe} bar: ${asset.symbol} @ ${bar.datetime}`
        );
      }
      
      if (this.updateCount % 5 === 0) {
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
    // ✅ FIXED: Map USD to USDT for Binance
    const quote = quoteCurrency.toLowerCase().replace('usd', 'usdt');
    return `/crypto/${baseCurrency.toLowerCase()}_${quote}`;
  }

  private async cleanupOldData(): Promise<void> {
    if (this.cryptoAssets.length === 0) {
      this.logger.debug('⏭️ No crypto assets, skipping cleanup');
      return;
    }
    
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
            const snapshot = await this.firebaseService.getRealtimeDbValue(ohlcPath);
            
            if (snapshot) {
              const oldKeys = Object.keys(snapshot).filter(timestamp => {
                return parseInt(timestamp) < cutoffTimestamp;
              });
              
              if (oldKeys.length > 0) {
                this.logger.log(
                  `  🗑️ Deleting ${oldKeys.length} old ${timeframe} bars for ${asset.symbol}`
                );
                
                const updates: any = {};
                oldKeys.forEach(key => {
                  updates[`${ohlcPath}/${key}`] = null;
                });
                
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

  @Cron('*/2 * * * *')
  async logStats() {
    // ✅ Only log if scheduler is active
    if (!this.schedulerActive || this.cryptoAssets.length === 0) {
      this.logger.debug('⏭️ Crypto scheduler inactive, skipping stats');
      return;
    }
    
    const stats = this.binanceService.getStats();  // ✅ CHANGED
    const uptime = Date.now() - this.lastUpdateTime;
    
    this.logger.log('');
    this.logger.log('📊 ================================================');
    this.logger.log('📊 CRYPTO PRICE + OHLC SCHEDULER STATS (BINANCE)');  // ✅ CHANGED
    this.logger.log('📊 ================================================');
    this.logger.log(`   Assets: ${this.cryptoAssets.length}`);
    this.logger.log(`   Running: ${this.isRunning ? '✅' : '❌'}`);
    this.logger.log(`   Updates: ${this.updateCount}`);
    this.logger.log(`   Errors: ${this.errorCount}`);
    this.logger.log(`   Last Update: ${Math.floor(uptime / 1000)}s ago`);
    this.logger.log('');
    
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
    
    this.logger.log('   Binance Stats:');  // ✅ CHANGED
    this.logger.log(`     API Calls: ${stats.apiCalls}`);
    this.logger.log(`     Cache Hits: ${stats.cacheHits}`);
    this.logger.log(`     Hit Rate: ${stats.cacheHitRate}`);
    this.logger.log(`     Errors: ${stats.errors}`);
    this.logger.log(`     RT Writes: ${stats.realtimeWrites}`);
    this.logger.log('📊 ================================================');
    this.logger.log('');
  }

  async triggerUpdate(): Promise<void> {
    if (this.cryptoAssets.length === 0) {
      this.logger.warn('⚠️ Cannot trigger update: no crypto assets');
      return;
    }
    
    this.logger.log('🔄 Manual update triggered');
    await this.updateAllPrices();
  }

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
      schedulerActive: this.schedulerActive,
      assetCount: this.cryptoAssets.length,
      updateCount: this.updateCount,
      errorCount: this.errorCount,
      lastUpdate: this.lastUpdateTime > 0 
        ? `${Math.floor((Date.now() - this.lastUpdateTime) / 1000)}s ago`
        : 'Never',
      updateInterval: `${this.UPDATE_INTERVAL}ms`,
      api: 'Binance FREE',  // ✅ CHANGED
      assets: this.cryptoAssets.map(a => ({
        symbol: a.symbol,
        pair: `${a.cryptoConfig?.baseCurrency}/${a.cryptoConfig?.quoteCurrency}`,
        path: a.realtimeDbPath,
      })),
      ohlcStats,
    };
  }

  // ✅ NEW: Stop scheduler gracefully
  private async stopScheduler(): Promise<void> {
    this.logger.log('🛑 Stopping crypto price scheduler...');
    
    this.isRunning = false;
    this.schedulerActive = false;
    
    if (this.updateIntervalHandle) {
      clearInterval(this.updateIntervalHandle);
      this.updateIntervalHandle = null;
    }
    
    this.logger.log('✅ Crypto price scheduler stopped');
  }

  async onModuleDestroy() {
    await this.stopScheduler();
  }
}