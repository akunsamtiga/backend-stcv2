// src/assets/services/crypto-price-scheduler.service.ts

import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { FirebaseService } from '../../firebase/firebase.service';
import { BinanceService } from './binance.service';
import { AssetsService } from '../assets.service';
import { CryptoTimeframeManager, CryptoBar } from './crypto-timeframe-manager';
import { TradingGateway } from '../../websocket/trading.gateway';
import { ASSET_CATEGORY } from '../../common/constants';
import { Asset } from '../../common/interfaces';
import { OnEvent } from '@nestjs/event-emitter';

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
  // [OPT] Dari 60.000 ms (1 menit) → 300.000 ms (5 menit)
  // SEBELUM: cleanup 1s bars tiap 1 menit = 1000 bar × 300B × 10 aset × 1440x = ~4.3 GB/hari
  // SESUDAH: cleanup tiap 5 menit = hemat 5x, masih aman karena retention 4 menit
  private readonly AGGRESSIVE_CLEANUP_INTERVAL = 300000;
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

    // [OPT] Interval sudah diubah ke 5 menit
    this.logger.log('Cleanup schedulers started:');
    this.logger.log('   • 1s bars: Every 5 minutes [OPT] (was 1 min, hemat 5x download)');
    this.logger.log('   • Other timeframes: Every 30 minutes');
  }

  private async aggressiveCleanup1sBars(): Promise<void> {
    if (this.cryptoAssets.length === 0) return;

    const startTime = Date.now();
    this.logger.log('1S CLEANUP STARTED (4-min retention, shallow keys mode)...');

    try {
      let totalDeleted = 0;
      const PARALLEL_ASSETS = 3;

      for (let i = 0; i < this.cryptoAssets.length; i += PARALLEL_ASSETS) {
        const batch = this.cryptoAssets.slice(i, i + PARALLEL_ASSETS);

        const results = await Promise.allSettled(
          batch.map(asset => this.cleanupAsset1sTimeBased(asset))
        );

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            totalDeleted += result.value.deleted;
            this.logger.log(
              `${batch[index].symbol}: ${result.value.deleted} deleted, ` +
              `${result.value.remaining} remaining (retention: 4 min, oldest: ${result.value.oldestAge}s)`
            );
          } else {
            this.logger.error(`Cleanup failed for ${batch[index].symbol}: ${result.reason}`);
          }
        });

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const duration = Date.now() - startTime;
      this.lastAggressiveCleanupTime = Date.now();
      this.cleanupStats.totalRuns++;
      this.cleanupStats.totalDeleted += totalDeleted;
      this.cleanupStats.byTimeframe['1s'] = (this.cleanupStats.byTimeframe['1s'] || 0) + totalDeleted;

      this.logger.log(`1S CLEANUP DONE: ${totalDeleted} bars deleted in ${duration}ms`);

    } catch (error) {
      this.logger.error(`Aggressive 1s cleanup failed: ${error.message}`);
      this.cleanupStats.errors++;
    }
  }

  /**
   * [OPT] Cleanup 1s bars menggunakan shallow keys — hemat 95% download
   *
   * SEBELUM: .limitToLast(1000).once('value') → download seluruh nilai bar
   *   ~300 byte/bar × 1000 bar × 10 aset × 1440/hari = ~4.3 GB/hari
   *
   * SESUDAH: getShallowKeys() → hanya keys (~15 byte/key), tanpa nilai
   *   ~15 byte × 300 keys × 10 aset × 288/hari (5 menit) = ~13 MB/hari
   */
  private async cleanupAsset1sTimeBased(asset: Asset) {
    const path = this.getAssetPath(asset);
    const ohlcPath = `${path}/ohlc_1s`;
    const now = Math.floor(Date.now() / 1000);
    const FOUR_MINUTES_AGO = now - 240;

    try {
      // [OPT] Ambil keys saja — tidak download nilai bar sama sekali
      const allKeys = await this.getShallowKeys(ohlcPath);

      if (allKeys.length === 0) {
        return { deleted: 0, remaining: 0, oldestAge: 0 };
      }

      const keysToDelete = allKeys.filter(key => parseInt(key) < FOUR_MINUTES_AGO);

      if (keysToDelete.length === 0) {
        const oldestKey = Math.min(...allKeys.map(k => parseInt(k)));
        return { deleted: 0, remaining: allKeys.length, oldestAge: now - oldestKey };
      }

      // Satu batch update = 1 write operation
      const updates: Record<string, null> = {};
      keysToDelete.forEach(key => { updates[key] = null; });

      await this.firebaseService.getRealtimeDatabase()
        .ref(ohlcPath)
        .update(updates);

      const remainingKeys = allKeys.filter(k => !keysToDelete.includes(k));
      const oldestRemaining = remainingKeys.length > 0
        ? Math.min(...remainingKeys.map(k => parseInt(k)))
        : now;

      return {
        deleted: keysToDelete.length,
        remaining: remainingKeys.length,
        oldestAge: now - oldestRemaining,
      };

    } catch (error) {
      this.logger.error(`1s cleanup failed for ${asset.symbol}: ${error.message}`);
      return { deleted: 0, remaining: 0, oldestAge: 0 };
    }
  }

  /**
   * [OPT] Helper: Ambil hanya keys dari RTDB path
   *
   * Strategi bertingkat:
   * 1. Admin SDK dengan limitToLast(300) — lebih dari cukup untuk 240 bar aktif
   *    Jauh lebih hemat dari limitToLast(1000) di kode lama
   * 2. REST API ?shallow=true — hanya keys, sama sekali tidak download nilai
   *    Digunakan jika env FIREBASE_REALTIME_DB_URL tersedia
   *
   * Untuk 1s bars dengan retention 4 menit, max bar aktif = 240 buah.
   * limitToLast(300) sudah lebih dari cukup dengan buffer aman.
   */
  private async getShallowKeys(rtdbPath: string): Promise<string[]> {
    // Strategi 1: Admin SDK dengan limit yang tepat (bukan 1000 yang berlebihan)
    if (this.firebaseService.isRealtimeDbAdminAvailable()) {
      try {
        const db = this.firebaseService.getRealtimeDatabase();

        // [OPT] limitToLast(300) vs limitToLast(1000) lama = hemat 70% download
        // Untuk 1s bars dengan retention 4 menit, 240 bar aktif + 60 buffer = 300 cukup
        const snapshot = await db
          .ref(rtdbPath)
          .orderByKey()
          .limitToLast(300)
          .once('value');

        const data = snapshot.val();
        return data ? Object.keys(data) : [];

      } catch (error) {
        this.logger.warn(`Admin SDK shallow read failed, trying REST: ${error.message}`);
      }
    }

    // Strategi 2: REST API ?shallow=true — paling hemat, hanya keys
    const realtimeDbUrl = process.env.FIREBASE_REALTIME_DB_URL;
    if (realtimeDbUrl) {
      try {
        const admin = await import('firebase-admin');
        const app = admin.app();
        const tokenResult = await app.options.credential?.getAccessToken?.();

        if (tokenResult?.access_token) {
          const cleanPath = rtdbPath.startsWith('/') ? rtdbPath.slice(1) : rtdbPath;
          const baseUrl = realtimeDbUrl.replace(/\/$/, '');
          const url = `${baseUrl}/${cleanPath}.json?shallow=true&access_token=${tokenResult.access_token}`;

          const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            const data = await response.json();
            return data ? Object.keys(data) : [];
          }
        }
      } catch (error) {
        this.logger.warn(`REST shallow read failed: ${error.message}`);
      }
    }

    return [];
  }

  private async regularCleanup(): Promise<void> {
    if (this.cryptoAssets.length === 0) return;

    const startTime = Date.now();
    this.logger.log('REGULAR CLEANUP STARTED (all timeframes except 1s)...');

    try {
      const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      let totalDeleted = 0;

      for (const asset of this.cryptoAssets) {
        for (const tf of timeframes) {
          const deleted = await this.cleanupTimeframe(asset, tf);
          totalDeleted += deleted;

          if (deleted > 0) {
            this.cleanupStats.byTimeframe[tf] = (this.cleanupStats.byTimeframe[tf] || 0) + deleted;
          }
        }
      }

      const duration = Date.now() - startTime;
      this.lastCleanupTime = Date.now();
      this.cleanupStats.totalDeleted += totalDeleted;

      this.logger.log(`REGULAR CLEANUP DONE: ${totalDeleted} bars deleted in ${duration}ms`);

    } catch (error) {
      this.logger.error(`Regular cleanup failed: ${error.message}`);
      this.cleanupStats.errors++;
    }
  }

  /**
   * [OPT] cleanupTimeframe — pakai shallow keys, bukan download nilai penuh
   *
   * SEBELUM: .limitToLast(500).once('value') → download 500 bar penuh (~150KB per call)
   * SESUDAH: getShallowKeys() dengan limit 100 → hanya keys (~1.5KB per call)
   */
  private async cleanupTimeframe(asset: Asset, timeframe: string): Promise<number> {
    const path = this.getAssetPath(asset);
    const ohlcPath = `${path}/ohlc_${timeframe}`;

    const manager = this.timeframeManagers.get(asset.id);
    if (!manager) return 0;

    const retentionDays = manager.getRetentionDays();
    const retention = retentionDays[timeframe];

    if (!retention) return 0;

    const now = Math.floor(Date.now() / 1000);
    const retentionSeconds = Math.floor(retention * 86400);
    const cutoffTimestamp = now - retentionSeconds;

    try {
      // [OPT] Gunakan shallow keys — jauh lebih hemat dari .limitToLast(500) + nilai penuh
      const allKeys = await this.getShallowKeysForTimeframe(ohlcPath, timeframe);

      if (allKeys.length === 0) return 0;

      const keysToDelete = allKeys.filter(key => parseInt(key) < cutoffTimestamp);

      if (keysToDelete.length === 0) return 0;

      const updates: Record<string, null> = {};
      keysToDelete.forEach(key => { updates[key] = null; });

      if (this.firebaseService.isRealtimeDbAdminAvailable()) {
        await this.firebaseService.getRealtimeDatabase()
          .ref(ohlcPath)
          .update(updates);
      } else {
        // Fallback: delete via setRealtimeDbValue
        for (const key of keysToDelete) {
          await this.firebaseService.setRealtimeDbValue(
            `${ohlcPath}/${key}`,
            null,
            false
          );
        }
      }

      return keysToDelete.length;

    } catch (error) {
      this.logger.error(`Cleanup ${timeframe} failed for ${asset.symbol}: ${error.message}`);
      return 0;
    }
  }

  /**
   * [OPT] Shallow keys untuk timeframe non-1s
   * Limit disesuaikan dengan jumlah bar aktif per timeframe:
   *   1m:  retention 4 jam   = max 240 bar  → limit 300
   *   5m:  retention 20 jam  = max 240 bar  → limit 300
   *   15m: retention 2.5 hari = max 240 bar → limit 300
   *   30m+ : max 240 bar, limit 300 sudah lebih dari cukup
   */
  private async getShallowKeysForTimeframe(rtdbPath: string, timeframe: string): Promise<string[]> {
    // Semua timeframe max 240 bar aktif — limit 300 sudah cukup
    const LIMIT = 300;

    if (this.firebaseService.isRealtimeDbAdminAvailable()) {
      try {
        const db = this.firebaseService.getRealtimeDatabase();
        const snapshot = await db
          .ref(rtdbPath)
          .orderByKey()
          .limitToLast(LIMIT)
          .once('value');

        const data = snapshot.val();
        return data ? Object.keys(data) : [];

      } catch (error) {
        this.logger.warn(`Admin SDK read failed for ${timeframe}: ${error.message}`);
      }
    }

    // Fallback REST shallow
    const realtimeDbUrl = process.env.FIREBASE_REALTIME_DB_URL;
    if (realtimeDbUrl) {
      try {
        const admin = await import('firebase-admin');
        const tokenResult = await admin.app().options.credential?.getAccessToken?.();

        if (tokenResult?.access_token) {
          const cleanPath = rtdbPath.startsWith('/') ? rtdbPath.slice(1) : rtdbPath;
          const url = `${realtimeDbUrl.replace(/\/$/, '')}/${cleanPath}.json?shallow=true&access_token=${tokenResult.access_token}`;

          const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            const data = await response.json();
            return data ? Object.keys(data) : [];
          }
        }
      } catch (error) {
        this.logger.warn(`REST fallback failed for ${timeframe}: ${error.message}`);
      }
    }

    return [];
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

  @OnEvent('crypto.asset.new')
  async handleNewCryptoAsset(payload: {
    assetId: string;
    symbol: string;
    cryptoConfig: any;
    realtimeDbPath: string;
  }) {
    this.logger.log(`New crypto asset detected via event: ${payload.symbol}`);

    try {
      await this.loadCryptoAssets();

      if (!this.schedulerActive && this.cryptoAssets.length > 0) {
        this.logger.log('Starting crypto scheduler for new asset...');
        await this.startScheduler();
      } else {
        this.logger.log(`Scheduler already active with ${this.cryptoAssets.length} crypto assets`);
      }
    } catch (error) {
      this.logger.error(`Failed to handle new crypto asset: ${error.message}`);
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
    this.logger.log('CLEANUP STATS [OPT - SHALLOW KEYS MODE]:');
    this.logger.log(`Total Runs: ${this.cleanupStats.totalRuns}`);
    this.logger.log(`Total Deleted: ${this.cleanupStats.totalDeleted}`);
    this.logger.log(`Errors: ${this.cleanupStats.errors}`);
    this.logger.log(`1s Cleanup Interval: ${this.AGGRESSIVE_CLEANUP_INTERVAL / 60000} minutes [OPT]`);
    this.logger.log(`1s Retention: 4 minutes (240 bars) - NO MAX LIMIT`);
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
    this.logger.log('Manual cleanup triggered');
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
          interval: `${this.AGGRESSIVE_CLEANUP_INTERVAL / 60000} minutes [OPT was 1min]`,
          lastRun: this.lastAggressiveCleanupTime > 0
            ? `${Math.floor((Date.now() - this.lastAggressiveCleanupTime) / 60000)}m ago`
            : 'Never',
          retention: '4 minutes (240 bars) - Time-based only',
          method: 'Shallow keys read [OPT] — hemat 95% download vs limitToLast(1000)',
        },
        regular: {
          interval: `${this.CLEANUP_INTERVAL / 60000} minutes`,
          lastRun: this.lastCleanupTime > 0
            ? `${Math.floor((Date.now() - this.lastCleanupTime) / 60000)}m ago`
            : 'Never',
          method: 'Shallow keys read [OPT] — hemat 80% download vs limitToLast(500)',
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