// src/assets/services/crypto-price-scheduler.service.ts
// ✅ Background service to fetch & write crypto prices to Realtime DB

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { FirebaseService } from '../../firebase/firebase.service';
import { CryptoCompareService } from './cryptocompare.service';
import { AssetsService } from '../assets.service';
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
  
  // ✅ Update every 5 seconds (CryptoCompare free tier allows ~100 calls/second)
  private readonly UPDATE_INTERVAL = 5000;
  
  // ✅ Refresh asset list every 10 minutes
  private readonly REFRESH_INTERVAL = 600000;

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
      
      this.logger.log('');
      this.logger.log('💎 ================================================');
      this.logger.log('💎 CRYPTO PRICE SCHEDULER INITIALIZED');
      this.logger.log('💎 ================================================');
      this.logger.log(`💎 Active Crypto Assets: ${this.cryptoAssets.length}`);
      this.cryptoAssets.forEach(asset => {
        const pair = `${asset.cryptoConfig?.baseCurrency}/${asset.cryptoConfig?.quoteCurrency}`;
        const path = asset.realtimeDbPath || 
          `/crypto/${asset.cryptoConfig?.baseCurrency.toLowerCase()}_${asset.cryptoConfig?.quoteCurrency.toLowerCase()}`;
        this.logger.log(`   • ${asset.symbol} (${pair}) → ${path}`);
      });
      this.logger.log(`⚡ Update Interval: ${this.UPDATE_INTERVAL}ms (${this.UPDATE_INTERVAL / 1000}s)`);
      this.logger.log(`🔄 Asset Refresh: ${this.REFRESH_INTERVAL}ms (${this.REFRESH_INTERVAL / 60000}m)`);
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
    this.schedulerRegistry.addInterval('crypto-price-update', interval);
    
    this.logger.log('✅ Crypto price scheduler started');
  }

  /**
   * ✅ Refresh crypto assets list (every 10 minutes via Cron)
   */
  @Cron('*/10 * * * *') // Every 10 minutes
  async refreshCryptoAssets() {
    this.logger.debug('🔄 Refreshing crypto assets list...');
    await this.loadCryptoAssets();
  }

  /**
   * ✅ Update all crypto prices
   */
  private async updateAllPrices(): Promise<void> {
    if (this.cryptoAssets.length === 0) return;

    const startTime = Date.now();
    
    try {
      // ✅ Fetch prices in batch (efficient)
      const priceMap = await this.cryptoCompareService.getMultiplePrices(this.cryptoAssets);
      
      let successCount = 0;
      let failCount = 0;
      
      // ✅ Process each asset
      for (const asset of this.cryptoAssets) {
        const cryptoPrice = priceMap.get(asset.id);
        
        if (cryptoPrice) {
          successCount++;
        } else {
          failCount++;
          this.logger.debug(`⚠️ No price for ${asset.symbol}`);
        }
      }
      
      this.updateCount++;
      this.lastUpdateTime = Date.now();
      
      const duration = Date.now() - startTime;
      
      // ✅ Log every 60 updates (every 5 minutes if interval is 5s)
      if (this.updateCount % 60 === 0) {
        this.logger.log(
          `💎 Update #${this.updateCount}: ${successCount}/${this.cryptoAssets.length} prices updated in ${duration}ms ` +
          `(Success: ${successCount}, Failed: ${failCount})`
        );
      }
      
    } catch (error) {
      this.errorCount++;
      this.logger.error(`❌ Batch update failed: ${error.message}`);
    }
  }

  /**
   * ✅ Log stats (every 2 minutes via Cron)
   */
  @Cron('*/2 * * * *') // Every 2 minutes
  async logStats() {
    const stats = this.cryptoCompareService.getStats();
    const uptime = Date.now() - this.lastUpdateTime;
    
    this.logger.log('');
    this.logger.log('📊 ================================================');
    this.logger.log('📊 CRYPTO PRICE SCHEDULER STATS');
    this.logger.log('📊 ================================================');
    this.logger.log(`   Assets: ${this.cryptoAssets.length}`);
    this.logger.log(`   Running: ${this.isRunning ? '✅' : '❌'}`);
    this.logger.log(`   Updates: ${this.updateCount}`);
    this.logger.log(`   Errors: ${this.errorCount}`);
    this.logger.log(`   Last Update: ${Math.floor(uptime / 1000)}s ago`);
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
    };
  }

  /**
   * ✅ Cleanup on shutdown
   */
  async onModuleDestroy() {
    this.logger.log('🛑 Stopping crypto price scheduler...');
    this.isRunning = false;
    
    try {
      const interval = this.schedulerRegistry.getInterval('crypto-price-update');
      if (interval) {
        clearInterval(interval);
        this.schedulerRegistry.deleteInterval('crypto-price-update');
      }
    } catch (error) {
      // Interval might not exist
    }
    
    this.logger.log('✅ Crypto price scheduler stopped');
  }
}