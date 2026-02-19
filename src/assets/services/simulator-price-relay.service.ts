// src/assets/services/simulator-price-relay.service.ts

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { FirebaseService } from '../../firebase/firebase.service';
import { AssetsService } from '../assets.service';
import { TradingGateway } from '../../websocket/trading.gateway';
import { ASSET_CATEGORY } from '../../common/constants';
import { Asset } from '../../common/interfaces';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface CachedPrice {
  price: number;
  timestamp: number;
  datetime: string;
  change: number;
  updatedAt: number;
}

interface OHLCBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isCompleted: boolean;
}

// ─────────────────────────────────────────────
// In-memory OHLC manager per asset
// Logika identik dengan TimeframeManager di simulator.js
// Tidak perlu baca RTDB — dihitung langsung dari price stream
// ─────────────────────────────────────────────

class InMemoryTimeframeManager {
  private readonly TIMEFRAMES: Record<string, number> = {
    '1s' : 1,
    '1m' : 60,
    '5m' : 300,
    '15m': 900,
    '30m': 1800,
    '1h' : 3600,
    '4h' : 14400,
    '1d' : 86400,
  };

  private bars: Record<string, OHLCBar | null> = {};
  private initialized = false;

  constructor() {
    for (const tf of Object.keys(this.TIMEFRAMES)) {
      this.bars[tf] = null;
    }
  }

  private getBarTimestamp(timestamp: number, seconds: number): number {
    return Math.floor(timestamp / seconds) * seconds;
  }

  /**
   * Terima price baru, update semua timeframe.
   * Return currentBars (semua TF) + completedBars (bar yang baru tutup).
   * Dipanggil tiap kali RTDB listener mendapat harga baru (~1 detik sekali).
   */
  update(timestamp: number, price: number): {
    currentBars: Record<string, OHLCBar>;
    completedBars: Record<string, OHLCBar>;
  } {
    const completedBars: Record<string, OHLCBar> = {};
    const currentBars: Record<string, OHLCBar>   = {};

    for (const [tf, seconds] of Object.entries(this.TIMEFRAMES)) {
      const barTs = this.getBarTimestamp(timestamp, seconds);
      const prev  = this.bars[tf];

      if (!prev || prev.timestamp !== barTs) {
        // Bar lama baru saja tutup
        if (prev) {
          completedBars[tf] = { ...prev, isCompleted: true };
        }
        // Buka bar baru
        this.bars[tf] = {
          timestamp   : barTs,
          open        : price,
          high        : price,
          low         : price,
          close       : price,
          volume      : Math.floor(1000 + Math.random() * 9000),
          isCompleted : false,
        };
      } else {
        // Update bar yang sedang berjalan
        prev.high  = Math.max(prev.high, price);
        prev.low   = Math.min(prev.low, price);
        prev.close = price;
        prev.volume += Math.floor(100 + Math.random() * 900);
      }

      currentBars[tf] = { ...this.bars[tf]! };
    }

    this.initialized = true;
    return { currentBars, completedBars };
  }

  /** Snapshot bar aktif tanpa update */
  getCurrentBars(): Record<string, OHLCBar> {
    const result: Record<string, OHLCBar> = {};
    for (const [tf, bar] of Object.entries(this.bars)) {
      if (bar) result[tf] = { ...bar };
    }
    return result;
  }

  isReady(): boolean {
    return this.initialized;
  }
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

@Injectable()
export class SimulatorPriceRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulatorPriceRelayService.name);

  private normalAssets: Asset[]  = [];
  private isRunning              = false;

  /** Harga terkini dari RTDB listener */
  private priceCache: Map<string, CachedPrice> = new Map();

  /**
   * In-memory OHLC state per aset.
   * Update tiap kali RTDB listener menerima harga baru.
   * Tidak ada RTDB read — semua dihitung dari price stream.
   */
  private ohlcManagers: Map<string, InMemoryTimeframeManager> = new Map();

  /** RTDB listener refs agar bisa di-detach */
  private activeListeners: Map<string, any> = new Map();

  private broadcastInterval: NodeJS.Timeout | null = null;

  private relayCount      = 0;
  private errorCount      = 0;
  private lastSuccessTime = 0;

  constructor(
    private firebaseService: FirebaseService,
    private assetsService: AssetsService,
    private tradingGateway: TradingGateway,
  ) {}

  async onModuleInit() {
    setTimeout(() => this.initialize(), 5000);
  }

  async onModuleDestroy() {
    this.stopRelay();
  }

  // ─────────────────────────────────────────────
  // Init & lifecycle
  // ─────────────────────────────────────────────

  private async initialize() {
    try {
      await this.loadNormalAssets();
      if (this.normalAssets.length > 0) {
        await this.startRelay();
      } else {
        this.logger.warn('No normal assets found, relay not started');
      }
    } catch (error) {
      this.logger.error(`Relay init failed: ${error.message}`);
    }
  }

  @OnEvent('simulator.asset.new')
  async handleNewSimulatorAsset(payload: {
    assetId: string; symbol: string; realtimeDbPath: string;
  }) {
    this.logger.log(`New simulator asset: ${payload.symbol}`);
    await this.loadNormalAssets();

    const asset = this.normalAssets.find(a => a.id === payload.assetId);
    if (asset && !this.activeListeners.has(asset.id)) {
      this.setupAssetListener(asset);
    }

    if (!this.isRunning && this.normalAssets.length > 0) {
      await this.startRelay();
    }
  }

  @OnEvent('asset.refresh.requested')
  async handleRefreshRequest() {
    await this.syncListeners();
  }

  @Cron('*/10 * * * *')
  async refreshAssets() {
    const prev = this.normalAssets.length;
    await this.loadNormalAssets();
    const curr = this.normalAssets.length;

    if (prev !== curr) {
      this.logger.log(`Assets changed: ${prev} → ${curr}`);
      await this.syncListeners();
    }

    if (prev === 0 && curr > 0 && !this.isRunning) await this.startRelay();
    else if (curr === 0 && this.isRunning) this.stopRelay();
  }

  private async loadNormalAssets() {
    try {
      const { assets } = await this.assetsService.getAllAssets(true);
      this.normalAssets = assets.filter(a => a.category === ASSET_CATEGORY.NORMAL);
      this.logger.log(`Loaded ${this.normalAssets.length} normal assets`);
    } catch (error) {
      this.logger.error(`Failed to load assets: ${error.message}`);
      this.normalAssets = [];
    }
  }

  // ─────────────────────────────────────────────
  // Start / Stop relay
  // ─────────────────────────────────────────────

  private async startRelay() {
    if (this.isRunning || this.normalAssets.length === 0) return;

    this.isRunning = true;
    this.logger.log(
      `Starting relay (LISTENER + IN-MEMORY OHLC) — assets: ${this.normalAssets.map(a => a.symbol).join(', ')}`
    );

    for (const asset of this.normalAssets) {
      this.setupAssetListener(asset);
    }

    // Broadcast price:update + ohlc:update dari cache tiap 1 detik — 0 RTDB reads
    this.broadcastInterval = setInterval(() => this.broadcastFromCache(), 1000);

    this.logger.log(
      `Relay started: ${this.activeListeners.size} RTDB listeners, OHLC computed entirely in-memory`
    );
  }

  private stopRelay() {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    for (const ref of this.activeListeners.values()) {
      try { ref.off(); } catch (_) {}
    }
    this.activeListeners.clear();
    this.priceCache.clear();
    this.ohlcManagers.clear();

    this.logger.log('Relay stopped');
  }

  // ─────────────────────────────────────────────
  // RTDB Persistent Listener
  // Satu listener per aset → data di-push otomatis oleh Firebase
  // ─────────────────────────────────────────────

  private setupAssetListener(asset: Asset): void {
    if (this.activeListeners.has(asset.id)) return;

    // Siapkan OHLC manager
    if (!this.ohlcManagers.has(asset.id)) {
      this.ohlcManagers.set(asset.id, new InMemoryTimeframeManager());
    }

    const path = `${this.getAssetPath(asset)}/current_price`;

    try {
      const db  = this.firebaseService.getRealtimeDatabase();
      const ref = db.ref(path);

      ref.on(
        'value',
        (snapshot) => {
          const data = snapshot.val();
          if (!data?.price) return;

          const price     = parseFloat(data.price);
          const timestamp = data.timestamp ?? Math.floor(Date.now() / 1000);

          // Update price cache
          this.priceCache.set(asset.id, {
            price,
            timestamp,
            datetime : data.datetime || '',
            change   : data.change   || 0,
            updatedAt: Date.now(),
          });

          // Update OHLC in-memory — tidak ada RTDB read sama sekali
          const manager = this.ohlcManagers.get(asset.id)!;
          const { completedBars } = manager.update(timestamp, price);

          // Kalau ada bar yang baru tutup, langsung emit segera
          // (tidak nunggu broadcast interval 1 detik)
          if (Object.keys(completedBars).length > 0) {
            try {
              this.tradingGateway.emitOhlcUpdate(asset.id, {
                assetId      : asset.id,
                currentBars  : manager.getCurrentBars(),
                completedBars,
                timestamp,
              });
              this.logger.debug(
                `Bar closed: ${asset.symbol} [${Object.keys(completedBars).join(', ')}]`
              );
            } catch (_) {}
          }
        },
        (error) => {
          this.logger.error(`RTDB listener error ${asset.symbol}: ${error.message}`);
          setTimeout(() => {
            this.activeListeners.delete(asset.id);
            this.setupAssetListener(asset);
          }, 5000);
        },
      );

      this.activeListeners.set(asset.id, ref);
      this.logger.log(`Listener + OHLC manager ready: ${asset.symbol} → ${path}`);

    } catch (error) {
      this.logger.error(`Failed to setup listener ${asset.symbol}: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // Broadcast — dipanggil tiap 1 detik
  // ─────────────────────────────────────────────

  private broadcastFromCache(): void {
    for (const asset of this.normalAssets) {
      const cached = this.priceCache.get(asset.id);
      if (!cached) continue;

      // Skip data stale > 10 detik (simulator mungkin down)
      if (Date.now() - cached.updatedAt > 10_000) {
        this.logger.debug(`${asset.symbol} stale ${Math.floor((Date.now() - cached.updatedAt) / 1000)}s`);
        continue;
      }

      try {
        this.tradingGateway.emitPriceUpdate(asset.id, {
          price            : cached.price,
          timestamp        : cached.timestamp,
          datetime         : cached.datetime,
          volume24h        : 0,
          changePercent24h : cached.change,
          high24h          : cached.price,
          low24h           : cached.price,
        });

        const manager = this.ohlcManagers.get(asset.id);
        if (manager?.isReady()) {
          this.tradingGateway.emitOhlcUpdate(asset.id, {
            assetId      : asset.id,
            currentBars  : manager.getCurrentBars(),
            completedBars: {},
            timestamp    : cached.timestamp,
          });
        }

        this.relayCount++;
        this.lastSuccessTime = Date.now();

      } catch (error) {
        this.errorCount++;
        this.logger.debug(`Broadcast failed ${asset.symbol}: ${error.message}`);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Sync listeners saat aset berubah
  // ─────────────────────────────────────────────

  private async syncListeners(): Promise<void> {
    const activeIds = new Set(this.normalAssets.map(a => a.id));

    for (const asset of this.normalAssets) {
      if (!this.activeListeners.has(asset.id)) {
        this.setupAssetListener(asset);
      }
    }

    for (const [id, ref] of this.activeListeners.entries()) {
      if (!activeIds.has(id)) {
        try { ref.off(); } catch (_) {}
        this.activeListeners.delete(id);
        this.priceCache.delete(id);
        this.ohlcManagers.delete(id);
        this.logger.log(`Listener removed: ${id}`);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  private getAssetPath(asset: Asset): string {
    if (asset.realtimeDbPath) {
      return asset.realtimeDbPath.startsWith('/') ? asset.realtimeDbPath : `/${asset.realtimeDbPath}`;
    }
    if (asset.dataSource === 'mock') {
      return `/mock/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }
    return `/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }

  getStatus() {
    const ageSec = this.lastSuccessTime > 0
      ? Math.floor((Date.now() - this.lastSuccessTime) / 1000)
      : null;

    return {
      isRunning      : this.isRunning,
      mode           : 'LISTENER + IN-MEMORY OHLC (0 RTDB reads)',
      normalAssets   : this.normalAssets.length,
      activeListeners: this.activeListeners.size,
      ohlcManagers   : this.ohlcManagers.size,
      relayCount     : this.relayCount,
      errorCount     : this.errorCount,
      lastSuccess    : ageSec !== null ? `${ageSec}s ago` : 'Never',
      isHealthy      : this.isRunning && ageSec !== null && ageSec < 10,
      assets: this.normalAssets.map(a => ({
        symbol        : a.symbol,
        listenerActive: this.activeListeners.has(a.id),
        hasCachedPrice: this.priceCache.has(a.id),
        ohlcReady     : this.ohlcManagers.get(a.id)?.isReady() ?? false,
        cacheAge      : this.priceCache.has(a.id)
          ? `${Math.floor((Date.now() - this.priceCache.get(a.id)!.updatedAt) / 1000)}s`
          : 'N/A',
      })),
    };
  }
}