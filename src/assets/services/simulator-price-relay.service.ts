// src/assets/services/simulator-price-relay.service.ts
// [OPT v2] Ganti polling RTDB tiap 1 detik dengan persistent RTDB listener
// SEBELUM: setInterval(relayPrices, 1000) → .once('value') × 10 aset = 864.000 reads/hari (~173 MB)
// SESUDAH: .on('value') × 10 aset = 0 reads polling, data push otomatis dari Firebase

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { FirebaseService } from '../../firebase/firebase.service';
import { AssetsService } from '../assets.service';
import { TradingGateway } from '../../websocket/trading.gateway';
import { ASSET_CATEGORY } from '../../common/constants';
import { Asset } from '../../common/interfaces';

interface CachedPrice {
  price: number;
  timestamp: number;
  datetime: string;
  change: number;
  updatedAt: number;
}

@Injectable()
export class SimulatorPriceRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulatorPriceRelayService.name);

  private normalAssets: Asset[] = [];
  private isRunning = false;

  // [OPT] In-memory price cache — diisi oleh RTDB persistent listener
  private priceCache: Map<string, CachedPrice> = new Map();

  // [OPT] Track active RTDB listener refs agar bisa di-detach saat stop/cleanup
  private activeListeners: Map<string, any> = new Map(); // assetId → rtdb Ref

  private broadcastInterval: NodeJS.Timeout | null = null;

  private relayCount = 0;
  private errorCount = 0;
  private lastSuccessTime = 0;

  constructor(
    private firebaseService: FirebaseService,
    private assetsService: AssetsService,
    private tradingGateway: TradingGateway,
  ) {}

  async onModuleInit() {
    setTimeout(async () => {
      await this.initialize();
    }, 5000);
  }

  async onModuleDestroy() {
    this.stopRelay();
  }

  private async initialize() {
    try {
      await this.loadNormalAssets();

      if (this.normalAssets.length > 0) {
        await this.startRelay();
      } else {
        this.logger.warn('No normal assets found, relay not started');
      }
    } catch (error) {
      this.logger.error(`Relay initialization failed: ${error.message}`);
    }
  }

  @OnEvent('simulator.asset.new')
  async handleNewSimulatorAsset(payload: {
    assetId: string;
    symbol: string;
    realtimeDbPath: string;
    simulatorSettings?: any;
  }) {
    this.logger.log(`New simulator asset detected: ${payload.symbol}`);

    try {
      await this.loadNormalAssets();

      const newAsset = this.normalAssets.find(a => a.id === payload.assetId);
      if (newAsset && !this.activeListeners.has(newAsset.id)) {
        this.setupAssetListener(newAsset);
      }

      if (!this.isRunning && this.normalAssets.length > 0) {
        await this.startRelay();
      } else {
        this.logger.log(`Relay running with ${this.normalAssets.length} assets`);
      }
    } catch (error) {
      this.logger.error(`Failed to handle new simulator asset: ${error.message}`);
    }
  }

  @OnEvent('asset.refresh.requested')
  async handleRefreshRequest() {
    this.logger.log('Manual refresh requested for simulator relay');
    await this.syncListeners();
  }

  @Cron('*/10 * * * *')
  async refreshAssets() {
    const previousCount = this.normalAssets.length;
    await this.loadNormalAssets();
    const currentCount = this.normalAssets.length;

    if (previousCount !== currentCount) {
      this.logger.log(`Assets changed: ${previousCount} → ${currentCount}`);
      await this.syncListeners();
    }

    if (previousCount === 0 && currentCount > 0 && !this.isRunning) {
      this.logger.log('Assets detected, starting relay...');
      await this.startRelay();
    } else if (currentCount === 0 && this.isRunning) {
      this.logger.warn('No more assets, stopping relay...');
      this.stopRelay();
    }
  }

  private async loadNormalAssets() {
    try {
      const { assets } = await this.assetsService.getAllAssets(true);
      this.normalAssets = assets.filter(a => a.category === ASSET_CATEGORY.NORMAL);
      this.logger.log(`Loaded ${this.normalAssets.length} normal assets for relay`);
    } catch (error) {
      this.logger.error(`Failed to load normal assets: ${error.message}`);
      this.normalAssets = [];
    }
  }

  private async startRelay() {
    if (this.isRunning) {
      this.logger.warn('Relay already running');
      return;
    }

    if (this.normalAssets.length === 0) {
      this.logger.warn('Cannot start relay: no normal assets');
      return;
    }

    this.isRunning = true;

    this.logger.log('Starting simulator price relay (LISTENER MODE — 0 polling reads)...');
    this.logger.log(`   Assets: ${this.normalAssets.map(a => a.symbol).join(', ')}`);

    // [OPT] Setup satu persistent listener per aset — ganti polling tiap 1 detik
    for (const asset of this.normalAssets) {
      this.setupAssetListener(asset);
    }

    // Broadcast dari in-memory cache tiap 1 detik — 0 RTDB reads!
    this.broadcastInterval = setInterval(() => {
      this.broadcastFromCache();
    }, 1000);

    this.logger.log(`Simulator relay started: ${this.activeListeners.size} RTDB listeners active`);
  }

  // [OPT] Setup RTDB persistent listener untuk satu aset
  // Firebase push delta otomatis saat data berubah → tidak perlu polling
  private setupAssetListener(asset: Asset): void {
    if (this.activeListeners.has(asset.id)) {
      this.logger.debug(`Listener already active for ${asset.symbol}`);
      return;
    }

    const path = this.getAssetPath(asset);
    const fullPath = `${path}/current_price`;

    try {
      // Gunakan Admin SDK ref langsung (persistent WebSocket connection)
      const db = this.firebaseService.getRealtimeDatabase();
      const ref = db.ref(fullPath);

      ref.on(
        'value',
        (snapshot) => {
          const data = snapshot.val();
          if (data && data.price) {
            this.priceCache.set(asset.id, {
              price: parseFloat(data.price),
              timestamp: data.timestamp || Math.floor(Date.now() / 1000),
              datetime: data.datetime || new Date().toISOString(),
              change: data.change || 0,
              updatedAt: Date.now(),
            });
          }
        },
        (error) => {
          this.logger.error(`RTDB listener error for ${asset.symbol}: ${error.message}`);
          // Coba setup ulang setelah 5 detik
          setTimeout(() => {
            this.activeListeners.delete(asset.id);
            this.setupAssetListener(asset);
          }, 5000);
        },
      );

      this.activeListeners.set(asset.id, ref);
      this.logger.log(`RTDB listener setup: ${asset.symbol} → ${fullPath}`);

    } catch (error) {
      this.logger.error(`Failed to setup listener for ${asset.symbol}: ${error.message}`);
    }
  }

  // Broadcast harga dari in-memory cache ke WebSocket clients — 0 RTDB reads
  private broadcastFromCache(): void {
    if (this.priceCache.size === 0) return;

    for (const asset of this.normalAssets) {
      const cached = this.priceCache.get(asset.id);
      if (!cached) continue;

      // Skip data yang terlalu stale (> 10 detik tidak update = simulator mungkin down)
      const age = Date.now() - cached.updatedAt;
      if (age > 10000) {
        this.logger.debug(`${asset.symbol} cache stale (${Math.floor(age / 1000)}s), skipping broadcast`);
        continue;
      }

      try {
        this.tradingGateway.emitPriceUpdate(asset.id, {
          price: cached.price,
          timestamp: cached.timestamp,
          datetime: cached.datetime,
          volume24h: 0,
          changePercent24h: cached.change,
          high24h: cached.price,
          low24h: cached.price,
        });
        this.relayCount++;
        this.lastSuccessTime = Date.now();
      } catch (error) {
        this.errorCount++;
        this.logger.debug(`Broadcast failed for ${asset.symbol}: ${error.message}`);
      }
    }
  }

  // Sync listeners: tambah listener baru, hapus yang sudah tidak aktif
  private async syncListeners(): Promise<void> {
    const activeIds = new Set(this.normalAssets.map(a => a.id));

    // Tambah listener untuk aset baru
    for (const asset of this.normalAssets) {
      if (!this.activeListeners.has(asset.id)) {
        this.setupAssetListener(asset);
      }
    }

    // Hapus listener untuk aset yang sudah tidak ada
    for (const [assetId, ref] of this.activeListeners.entries()) {
      if (!activeIds.has(assetId)) {
        try {
          ref.off();
        } catch (e) {
          // ignore
        }
        this.activeListeners.delete(assetId);
        this.priceCache.delete(assetId);
        this.logger.log(`RTDB listener removed: ${assetId}`);
      }
    }
  }

  private stopRelay() {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Hentikan broadcast interval
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    // Detach semua RTDB listeners
    for (const [assetId, ref] of this.activeListeners.entries()) {
      try {
        ref.off();
      } catch (e) {
        // ignore
      }
      this.logger.debug(`RTDB listener detached: ${assetId}`);
    }
    this.activeListeners.clear();
    this.priceCache.clear();

    this.logger.log('Simulator price relay stopped (all RTDB listeners detached)');
  }

  private getAssetPath(asset: Asset): string {
    if (asset.realtimeDbPath) {
      return asset.realtimeDbPath.startsWith('/')
        ? asset.realtimeDbPath
        : `/${asset.realtimeDbPath}`;
    }

    if (asset.dataSource === 'mock') {
      return `/mock/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }

    if (asset.dataSource === 'api' && asset.apiEndpoint) {
      return `/api/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }

    return `/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }

  getStatus() {
    const timeSinceLastSuccess = this.lastSuccessTime > 0
      ? Math.floor((Date.now() - this.lastSuccessTime) / 1000)
      : null;

    return {
      isRunning: this.isRunning,
      mode: 'LISTENER (0 polling reads)', // [OPT]
      normalAssets: this.normalAssets.length,
      activeListeners: this.activeListeners.size,
      cachedPrices: this.priceCache.size,
      relayCount: this.relayCount,
      errorCount: this.errorCount,
      lastSuccess: timeSinceLastSuccess !== null
        ? `${timeSinceLastSuccess}s ago`
        : 'Never',
      isHealthy: this.isRunning && timeSinceLastSuccess !== null && timeSinceLastSuccess < 10,
      assets: this.normalAssets.map(a => ({
        symbol: a.symbol,
        path: this.getAssetPath(a),
        listenerActive: this.activeListeners.has(a.id),
        hasCachedPrice: this.priceCache.has(a.id),
        cacheAge: this.priceCache.has(a.id)
          ? `${Math.floor((Date.now() - this.priceCache.get(a.id)!.updatedAt) / 1000)}s`
          : 'N/A',
      })),
    };
  }
}