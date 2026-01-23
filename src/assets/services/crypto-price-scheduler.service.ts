import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { FirebaseService } from '../../firebase/firebase.service';
import { BinanceService } from './binance.service';
import { AssetsService } from '../assets.service';
import { CryptoTimeframeManager, CryptoBar } from './crypto-timeframe-manager';
import { TradingGateway } from '../../websocket/trading.gateway';
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
  private readonly AGGRESSIVE_CLEANUP_INTERVAL = 60000;
  private readonly CLEANUP_INTERVAL = 1800000;
  
  private lastCleanupTime = 0;
  private lastAggressiveCleanupTime = 0;
  
  private cleanupStats = {
    totalRuns: 0,
    totalDeleted: 0,
    lastRun: 0,
    errors: 0,
    byTimeframe: {} as Record<string, number>,
  };
  
  private schedulerActive = false;
  private updateIntervalHandle: any = null;
  
  private initAttempts = 0;
  private readonly MAX_INIT_ATTEMPTS = 10;

  private readonly MAX_1S_BARS_PER_ASSET = 60;

  constructor(
    private firebaseService: FirebaseService,
    private binanceService: BinanceService,
    private assetsService: AssetsService,
    private schedulerRegistry: SchedulerRegistry,
    @Inject(forwardRef(() => TradingGateway))
    private readonly tradingGateway: TradingGateway,
  ) {}

  async onModuleInit() {
    setTimeout(async () => {
      await this.initializeScheduler();
    }, 3000);
    
    const retryInterval = setInterval(async () => {
      if (!this.schedulerActive && this.initAttempts < this.MAX_INIT_ATTEMPTS) {
        this.initAttempts++;
        this.logger.log(`Retry attempt ${this.initAttempts}/${this.MAX_INIT_ATTEMPTS}...`);
        await this.initializeScheduler();
      } else if (this.initAttempts >= this.MAX_INIT_ATTEMPTS) {
        clearInterval(retryInterval);
        this.logger.warn(`Stopped retry attempts after ${this.MAX_INIT_ATTEMPTS} tries`);
      } else if (this.schedulerActive) {
        clearInterval(retryInterval);
        this.logger.log('Scheduler active, stopping retry interval');
      }
    }, 30000);
  }

  private async initializeScheduler() {
    try {
      this.initAttempts++;
      
      await this.firebaseService.waitForFirestore(10000);
      await this.loadCryptoAssets();
      
      if (this.cryptoAssets.length > 0) {
        await this.startScheduler();
        this.startCleanupSchedulers();
      } else {
        this.logger.warn('No crypto assets found - scheduler NOT started');
        this.logger.warn(`Will retry in 30s (attempt ${this.initAttempts}/${this.MAX_INIT_ATTEMPTS})`);
      }
    } catch (error) {
      this.logger.error(`Scheduler initialization failed: ${error.message}`);
    }
  }

  private async loadCryptoAssets(): Promise<void> {
    try {
      const { assets } = await this.assetsService.getAllAssets(true);
      
      this.cryptoAssets = assets.filter(
        asset => asset.category === ASSET_CATEGORY.CRYPTO
      );
      
      if (this.cryptoAssets.length === 0) {
        this.logger.debug('No active crypto assets found in Firestore');
        return;
      }
      
      this.cryptoAssets.forEach(asset => {
        if (!this.timeframeManagers.has(asset.id)) {
          this.timeframeManagers.set(asset.id, new CryptoTimeframeManager());
          this.logger.debug(`Initialized OHLC manager for ${asset.symbol}`);
        }
      });
      
      this.logger.log('');
      this.logger.log('================================================');
      this.logger.log(`Active Crypto Assets: ${this.cryptoAssets.length}`);
      this.cryptoAssets.forEach(asset => {
        const pair = `${asset.cryptoConfig?.baseCurrency}/${asset.cryptoConfig?.quoteCurrency}`;
        const path = asset.realtimeDbPath || 
          `/crypto/${asset.cryptoConfig?.baseCurrency.toLowerCase()}_${asset.cryptoConfig?.quoteCurrency.toLowerCase().replace('usd', 'usdt')}`;
        this.logger.log(`   • ${asset.symbol} (${pair}) → ${path}`);
      });
      this.logger.log('================================================');
      
    } catch (error) {
      this.logger.error(`Failed to load crypto assets: ${error.message}`);
    }
  }

  private async startScheduler(): Promise<void> {
    if (this.cryptoAssets.length === 0) {
      this.logger.warn('Cannot start scheduler: no crypto assets');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Scheduler already running');
      return;
    }

    this.isRunning = true;
    this.schedulerActive = true;
    
    this.logger.log('Starting initial crypto price fetch...');
    await this.updateAllPrices();
    
    this.updateIntervalHandle = setInterval(async () => {
      if (this.isRunning && this.schedulerActive) {
        await this.updateAllPrices();
      }
    }, this.UPDATE_INTERVAL);
    
    this.logger.log('Crypto price scheduler started (WEBSOCKET MODE)');
  }

  private startCleanupSchedulers(): void {
    setInterval(async () => {
      await this.aggressiveCleanup1sBars();
    }, this.AGGRESSIVE_CLEANUP_INTERVAL);
    
    setInterval(async () => {
      await this.regularCleanup();
    }, this.CLEANUP_INTERVAL);
    
    this.logger.log('Cleanup schedulers started');
  }

  // ✅ FIX 1: Aggressive Cleanup untuk 1s bars
  private async aggressiveCleanup1sBars(): Promise<void> {
    if (this.cryptoAssets.length === 0) return;

    const startTime = Date.now();
    this.logger.log('🗑️ HARDCORE 1S CLEANUP STARTED (1-min retention, 60 bars max)...');

    try {
      let totalDeleted = 0;
      const PARALLEL_ASSETS = 3; // Kurangi dari 5 ke 3 untuk stabilitas

      for (let i = 0; i < this.cryptoAssets.length; i += PARALLEL_ASSETS) {
        const batch = this.cryptoAssets.slice(i, i + PARALLEL_ASSETS);
        
        const results = await Promise.allSettled(
          batch.map(asset => this.cleanupAsset1sHardcore(asset))
        );
        
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            totalDeleted += result.value.deleted;
            this.logger.log(
              `${batch[index].symbol}: ${result.value.deleted} deleted, ` +
              `${result.value.remaining} remaining (max 60 bars, oldest: ${result.value.oldestAge}s)`
            );
          } else {
            this.logger.error(`Cleanup failed for ${batch[index].symbol}: ${result.reason}`);
          }
        });

        // Tambah delay antar batch
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const duration = Date.now() - startTime;
      this.lastAggressiveCleanupTime = Date.now();
      this.cleanupStats.totalRuns++;
      this.cleanupStats.totalDeleted += totalDeleted;
      this.cleanupStats.lastRun = Date.now();
      this.cleanupStats.byTimeframe['1s'] = (this.cleanupStats.byTimeframe['1s'] || 0) + totalDeleted;

      this.logger.log(`✅ HARDCORE 1S DONE: ${totalDeleted} bars deleted in ${duration}ms (60-bar limit enforced)`);

    } catch (error) {
      this.logger.error(`❌ Aggressive 1s cleanup failed: ${error.message}`);
      this.cleanupStats.errors++;
    }
  }

  // ✅ FIX 2: Cleanup per asset dengan path yang benar
  private async cleanupAsset1sHardcore(asset: Asset) {
    const path = this.getAssetPath(asset);
    const ohlcPath = `${path}/ohlc_1s`;
    const now = Math.floor(Date.now() / 1000);
    const SIXTY_SECONDS_AGO = now - 60;

    try {
      // ✅ GUNAKAN REST API (lebih reliable)
      const allKeysResponse = await this.firebaseService.getRealtimeDbValue(
        `${ohlcPath}.json?shallow=true`,
        false
      );

      if (!allKeysResponse) {
        return { deleted: 0, remaining: 0, oldestAge: 0 };
      }

      const allKeys = Object.keys(allKeysResponse);

      if (allKeys.length <= this.MAX_1S_BARS_PER_ASSET) {
        const oldestAge = allKeys.length > 0 ? now - parseInt(allKeys[0]) : 0;
        return {
          deleted: 0,
          remaining: allKeys.length,
          oldestAge
        };
      }

      // Filter keys yang perlu dihapus
      const keysToDelete = allKeys.filter(key => parseInt(key) < SIXTY_SECONDS_AGO);
      
      // Jika masih melebihi limit, hapus yang paling lama
      if (keysToDelete.length === 0 && allKeys.length > this.MAX_1S_BARS_PER_ASSET) {
        const excessCount = allKeys.length - this.MAX_1S_BARS_PER_ASSET;
        keysToDelete.push(...allKeys.slice(0, excessCount));
      }

      const oldestAge = keysToDelete.length > 0 ? now - parseInt(keysToDelete[0]) : 0;

      // ✅ FIX CRITICAL: Hapus menggunakan batch update dengan path yang benar
      const BATCH_SIZE = 50;
      let deleted = 0;

      for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
        const batch = keysToDelete.slice(i, i + BATCH_SIZE);
        
        // ✅ PERBAIKAN: Buat updates object dengan path RELATIF dari ohlcPath
        const updates: any = {};
        batch.forEach(key => {
          updates[key] = null; // Path relatif: "1234567890" bukan "/crypto/.../1234567890"
        });

        try {
          // ✅ Gunakan setRealtimeDbValue dengan batch updates
          await this.firebaseService.getRealtimeDatabase()
            .ref(ohlcPath)
            .update(updates);
          
          deleted += batch.length;
          
          this.logger.debug(`🗑️ Deleted batch of ${batch.length} bars from ${asset.symbol}`);
        } catch (error) {
          this.logger.error(`❌ Batch delete failed for ${asset.symbol}: ${error.message}`);
          throw error;
        }

        // Rate limit protection
        if (i + BATCH_SIZE < keysToDelete.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      const remaining = Math.min(allKeys.length - deleted, this.MAX_1S_BARS_PER_ASSET);

      return {
        deleted,
        remaining,
        oldestAge
      };

    } catch (error) {
      this.logger.error(`❌ 1s cleanup failed for ${asset.symbol}: ${error.message}`);
      return { deleted: 0, remaining: 0, oldestAge: 0 };
    }
  }

  // ✅ FIX 3: Regular cleanup dengan path yang benar
  private async regularCleanup(): Promise<void> {
    if (this.cryptoAssets.length === 0) return;

    const startTime = Date.now();
    this.logger.log('🧹 REGULAR cleanup (all timeframes)...');

    try {
      const manager = new CryptoTimeframeManager();
      const retentionDays = manager.getRetentionDays();
      
      let totalDeleted = 0;

      for (const asset of this.cryptoAssets) {
        try {
          for (const [timeframe, days] of Object.entries(retentionDays)) {
            if (timeframe === '1s') continue; // Skip 1s (handled by aggressive cleanup)
            
            const deleted = await this.cleanupAssetTimeframe(asset, timeframe, days);
            totalDeleted += deleted;
            
            if (!this.cleanupStats.byTimeframe[timeframe]) {
              this.cleanupStats.byTimeframe[timeframe] = 0;
            }
            this.cleanupStats.byTimeframe[timeframe] += deleted;
          }
        } catch (error) {
          this.logger.error(`❌ Cleanup error for ${asset.symbol}: ${error.message}`);
          this.cleanupStats.errors++;
        }
      }

      const duration = Date.now() - startTime;
      this.lastCleanupTime = Date.now();

      this.logger.log(`✅ REGULAR cleanup: ${totalDeleted} bars deleted in ${duration}ms`);

    } catch (error) {
      this.logger.error(`❌ Regular cleanup failed: ${error.message}`);
      this.cleanupStats.errors++;
    }
  }

  // ✅ FIX 4: Cleanup per timeframe dengan path yang benar
  private async cleanupAssetTimeframe(
    asset: Asset,
    timeframe: string,
    retentionDays: number
  ): Promise<number> {
    const startTime = Date.now();
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - (retentionDays * 86400);
    const path = this.getAssetPath(asset);
    const ohlcPath = `${path}/ohlc_${timeframe}`;

    this.logger.debug(`Starting cleanup for ${asset.symbol} ${timeframe} (cutoff: ${cutoffTimestamp})`);

    let totalDeleted = 0;
    const BATCH_DELETE_SIZE = 50; // Kurangi dari 100 ke 50

    try {
      // ✅ GUNAKAN REST API untuk mendapatkan keys
      const allKeysResponse = await this.firebaseService.getRealtimeDbValue(
        `${ohlcPath}.json?shallow=true`,
        false
      );
      
      if (!allKeysResponse) return 0;

      const allKeys = Object.keys(allKeysResponse);
      const oldKeys = allKeys.filter(key => parseInt(key) < cutoffTimestamp);
      
      if (oldKeys.length === 0) return 0;

      this.logger.log(`🗑️ Deleting ${oldKeys.length} old ${timeframe} bars for ${asset.symbol}`);

      // ✅ PERBAIKAN: Delete dengan batch update yang benar
      for (let i = 0; i < oldKeys.length; i += BATCH_DELETE_SIZE) {
        const batch = oldKeys.slice(i, i + BATCH_DELETE_SIZE);
        
        // ✅ Buat updates object dengan path RELATIF
        const updates: any = {};
        batch.forEach(key => {
          updates[key] = null; // Path relatif, bukan absolute
        });
        
        try {
          // ✅ Gunakan ref().update() dengan path yang benar
          await this.firebaseService.getRealtimeDatabase()
            .ref(ohlcPath)
            .update(updates);
          
          totalDeleted += batch.length;
          
          this.logger.debug(`🗑️ Deleted ${batch.length} ${timeframe} bars from ${asset.symbol}`);
        } catch (error) {
          this.logger.error(`❌ Batch delete failed: ${error.message}`);
          throw error;
        }

        // Rate limit protection
        if (i + BATCH_DELETE_SIZE < oldKeys.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const duration = Date.now() - startTime;
      this.logger.debug(`✅ Cleanup ${asset.symbol} ${timeframe}: ${totalDeleted} bars in ${duration}ms`);

      return totalDeleted;

    } catch (error) {
      this.logger.error(`❌ Cleanup error for ${asset.symbol} ${timeframe}: ${error.message}`);
      return 0;
    }
  }

  @Cron('*/10 * * * *')
  async refreshCryptoAssets() {
    this.logger.debug('Refreshing crypto assets list...');
    
    const previousCount = this.cryptoAssets.length;
    await this.loadCryptoAssets();
    const currentCount = this.cryptoAssets.length;
    
    if (previousCount === 0 && currentCount > 0) {
      this.logger.log('Crypto assets detected! Starting scheduler...');
      await this.startScheduler();
      this.startCleanupSchedulers();
    } else if (previousCount > 0 && currentCount === 0) {
      this.logger.warn('No more crypto assets! Stopping scheduler...');
      await this.stopScheduler();
    } else if (currentCount > 0) {
      this.logger.log(`Refreshed: ${currentCount} crypto assets active`);
    }
  }

  private async updateAllPrices(): Promise<void> {
    if (this.cryptoAssets.length === 0) {
      return;
    }

    const startTime = Date.now();
    
    try {
      const priceMap = await this.binanceService.getMultiplePrices(
        this.cryptoAssets,
        true
      );
      
      let successCount = 0;
      let failCount = 0;
      
      for (const asset of this.cryptoAssets) {
        const cryptoPrice = priceMap.get(asset.id);
        
        if (cryptoPrice) {
          successCount++;
          await this.generateOHLC(asset, cryptoPrice);
          
          try {
            this.tradingGateway.emitPriceUpdate(asset.id, {
              price: cryptoPrice.price,
              timestamp: cryptoPrice.timestamp,
              datetime: cryptoPrice.datetime,
              volume24h: cryptoPrice.volume24h,
              changePercent24h: cryptoPrice.changePercent24h,
              high24h: cryptoPrice.high24h,
              low24h: cryptoPrice.low24h,
            });
          } catch (wsError) {
            this.logger.debug(`WebSocket emit skipped: ${wsError.message}`);
          }
          
        } else {
          failCount++;
        }
      }
      
      this.updateCount++;
      this.lastUpdateTime = Date.now();
      
      const duration = Date.now() - startTime;
      
      if (this.updateCount % 30 === 0) {
        this.logger.log(
          `Update #${this.updateCount}: ${successCount}/${this.cryptoAssets.length} ` +
          `prices + OHLC + WS in ${duration}ms`
        );
      }
      
    } catch (error) {
      this.errorCount++;
      this.logger.error(`Batch update failed: ${error.message}`);
    }
  }

  private async generateOHLC(asset: Asset, cryptoPrice: any): Promise<void> {
    try {
      const manager = this.timeframeManagers.get(asset.id);
      if (!manager) {
        this.logger.error(`No timeframe manager for ${asset.symbol}`);
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
      
      for (const [timeframe, bar] of currentBars.entries()) {
        const barPath = `${path}/ohlc_${timeframe}/${bar.timestamp}`;
        
        await this.firebaseService.setRealtimeDbValue(
          barPath,
          this.cleanBarData(bar),
          false
        );
      }
      
      for (const [timeframe, bar] of completedBars.entries()) {
        const barPath = `${path}/ohlc_${timeframe}/${bar.timestamp}`;
        
        await this.firebaseService.setRealtimeDbValue(
          barPath,
          this.cleanBarData(bar),
          true
        );
      }
      
    } catch (error) {
      this.logger.error(`OHLC generation failed for ${asset.symbol}: ${error.message}`);
    }
  }

  private cleanBarData(bar: any): any {
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
      this.logger.warn(`Asset ${asset.symbol} missing cryptoConfig, using fallback path`);
      return `/crypto/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }
    
    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;
    const quote = quoteCurrency.toLowerCase().replace('usd', 'usdt');
    return `/crypto/${baseCurrency.toLowerCase()}_${quote}`;
  }

  @Cron('*/2 * * * *')
  async logStats() {
    if (!this.schedulerActive || this.cryptoAssets.length === 0) {
      return;
    }
    
    const stats = this.binanceService.getStats();
    
    this.logger.log('');
    this.logger.log('================================================');
    this.logger.log('CRYPTO SCHEDULER STATS');
    this.logger.log('================================================');
    this.logger.log(`Assets: ${this.cryptoAssets.length}`);
    this.logger.log(`Updates: ${this.updateCount}`);
    this.logger.log(`Errors: ${this.errorCount}`);
    this.logger.log(`WebSocket: ENABLED`);
    this.logger.log('================================================');
    this.logger.log('CLEANUP STATS:');
    this.logger.log(`Total Runs: ${this.cleanupStats.totalRuns}`);
    this.logger.log(`Total Deleted: ${this.cleanupStats.totalDeleted}`);
    this.logger.log(`Errors: ${this.cleanupStats.errors}`);
    this.logger.log('By Timeframe:');
    Object.entries(this.cleanupStats.byTimeframe).forEach(([tf, count]) => {
      this.logger.log(`  ${tf}: ${count} bars`);
    });
    this.logger.log('================================================');
    this.logger.log('');
  }

  async triggerUpdate(): Promise<void> {
    if (this.cryptoAssets.length === 0) {
      this.logger.warn('Cannot trigger update: no crypto assets');
      return;
    }
    
    this.logger.log('Manual update triggered');
    await this.updateAllPrices();
  }

  async triggerCleanup(): Promise<void> {
    this.logger.log('🗑️ Manual cleanup triggered');
    await this.aggressiveCleanup1sBars();
    await this.regularCleanup();
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
      websocket: {
        enabled: true,
        broadcasting: 'price:update events every 1s',
      },
      cleanup: {
        aggressive1s: {
          interval: `${this.AGGRESSIVE_CLEANUP_INTERVAL / 60000} minutes`,
          lastRun: this.lastAggressiveCleanupTime > 0
            ? `${Math.floor((Date.now() - this.lastAggressiveCleanupTime) / 60000)}m ago`
            : 'Never',
        },
        regular: {
          interval: `${this.CLEANUP_INTERVAL / 60000} minutes`,
          lastRun: this.lastCleanupTime > 0
            ? `${Math.floor((Date.now() - this.lastCleanupTime) / 60000)}m ago`
            : 'Never',
        },
        stats: this.cleanupStats,
      },
      assets: this.cryptoAssets.map(a => ({
        symbol: a.symbol,
        pair: `${a.cryptoConfig?.baseCurrency}/${a.cryptoConfig?.quoteCurrency}`,
        path: a.realtimeDbPath,
      })),
      ohlcStats,
      binanceStats: this.binanceService.getStats(),
    };
  }

  private async stopScheduler(): Promise<void> {
    this.logger.log('Stopping crypto price scheduler...');
    
    this.isRunning = false;
    this.schedulerActive = false;
    
    if (this.updateIntervalHandle) {
      clearInterval(this.updateIntervalHandle);
      this.updateIntervalHandle = null;
    }
    
    this.logger.log('Crypto price scheduler stopped');
  }

  async onModuleDestroy() {
    await this.stopScheduler();
  }
}