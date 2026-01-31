// src/assets/services/price-fetcher.service.ts
// ✅ VERSI DIPERBAIKI - FORCE REALTIME PRICE UNTUK ORDER

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FirebaseService } from '../../firebase/firebase.service';
import { BinanceService } from './binance.service';
import { TradingGateway } from '../../websocket/trading.gateway';
import { OnEvent } from '@nestjs/event-emitter';
import { Asset, RealtimePrice } from '../../common/interfaces';
import { ASSET_CATEGORY, ASSET_DATA_SOURCE } from '../../common/constants';

@Injectable()
export class PriceFetcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceFetcherService.name);
  
  private readonly TIMEOUT_MS = 2000;
  
  private priceCache: Map<string, {
    price: RealtimePrice;
    timestamp: number;
  }> = new Map();
  
  // ✅ PERUBAHAN 1: Kurangi cache TTL untuk lebih responsive
  private readonly FAST_CACHE_TTL = 1000;      // 2000 → 1000 (1 detik)
  private readonly NORMAL_CACHE_TTL = 2000;    // 5000 → 2000 (2 detik)  
  private readonly STALE_CACHE_TTL = 30000;
  
  private fetchCount = 0;
  private cacheHits = 0;
  private avgFetchTime = 0;
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;
  
  // ✅ PERUBAHAN 2: Tambah simulasi untuk aset MOCK
  private simulatedPrices: Map<string, {
    price: number;
    initialPrice: number;
    timestamp: number;
  }> = new Map();
  private simulationInterval: NodeJS.Timeout | null = null;
  private updateCount = 0;
  private lastLogTime = Date.now();

  constructor(
    private firebaseService: FirebaseService,
    private binanceService: BinanceService,
    private readonly tradingGateway: TradingGateway,
  ) {
    setInterval(() => this.cleanupStaleCache(), 5000);
  }

  async onModuleInit() {
    this.logger.log('🚀 Initializing Price Fetcher Service...');
    
    // ✅ PERUBAHAN 3: Initialize simulated prices
    await this.initializeSimulatedPrices();
    this.startSimulationInterval();
    
    this.logger.log('✅ Price Fetcher Service initialized - Mock prices update every 1 second');
  }

  onModuleDestroy() {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.logger.log('🛑 Simulation interval cleared');
    }
  }

  // ============================================================================
  // ✅ PERUBAHAN UTAMA: REALTIME PRICE DENGAN BYPASS CACHE
  // ============================================================================
  
  async getCurrentPriceRealtime(
    asset: Asset,
    bypassCache = false
  ): Promise<RealtimePrice | null> {
    // ✅ FIX: Untuk REALTIME_DB dengan bypassCache, force fetch langsung ke Firebase
    if (asset.dataSource === ASSET_DATA_SOURCE.REALTIME_DB && bypassCache) {
      return await this.fetchRealtimeDbFresh(asset);
    }

    // ✅ Untuk MOCK dengan bypass cache, generate fresh price
    if (asset.dataSource === ASSET_DATA_SOURCE.MOCK && bypassCache) {
      return this.generateFreshMockPrice(asset);
    }

    // Untuk CRYPTO, gunakan binance dengan bypass
    if (asset.category === ASSET_CATEGORY.CRYPTO) {
      return await this.fetchCryptoPrice(asset, bypassCache);
    }

    // Fallback ke method biasa untuk kasus lain
    return this.getCurrentPrice(asset, bypassCache);
  }

  // ============================================================================
  // ✅ METHOD BARU: FETCH FRESH DARI REALTIME DB (TANPA CACHE)
  // ============================================================================
  
  private async fetchRealtimeDbFresh(asset: Asset): Promise<RealtimePrice | null> {
    if (!asset.realtimeDbPath) {
      this.logger.error(`❌ [FRESH] Realtime DB path not configured for ${asset.symbol}`);
      return null;
    }

    const startTime = Date.now();
    
    try {
      const fullPath = `${asset.realtimeDbPath}/current_price`;
      
      this.logger.debug(`📡 [FRESH-FETCH] ${asset.symbol} from ${fullPath}`);
      
      // 🔥 KRITIS: useCache = false untuk memaksa fetch langsung ke Firebase
      const data = await this.firebaseService.getRealtimeDbValue(
        fullPath,
        false // ❌ Jangan gunakan cache internal Firebase!
      );

      if (!data || !data.price) {
        this.logger.warn(`⚠️ [FRESH] No price data at ${fullPath}`);
        return null;
      }

      const now = Math.floor(Date.now() / 1000);
      const dataTimestamp = data.timestamp || 0;
      const dataAge = now - dataTimestamp;
      
      // Warning jika data simulator terlalu tua (> 3 detik)
      if (dataAge > 3) {
        this.logger.warn(
          `⚠️ [FRESH] ${asset.symbol} data is ${dataAge}s old - simulator delay detected`
        );
      }

      const price = parseFloat(data.price);
      if (isNaN(price) || price <= 0) {
        this.logger.error(`❌ [FRESH] Invalid price for ${asset.symbol}: ${data.price}`);
        return null;
      }

      const result: RealtimePrice = {
        price: price,
        timestamp: dataTimestamp,
        datetime: data.datetime || new Date(dataTimestamp * 1000).toISOString(),
      };

      const duration = Date.now() - startTime;
      this.logger.debug(
        `✅ [FRESH] ${asset.symbol}: ${price} (${dataAge}s old, ${duration}ms)`
      );

      return result;

    } catch (error) {
      this.logger.error(`❌ [FRESH] Failed to fetch ${asset.symbol}: ${error.message}`);
      // Fallback ke method biasa jika fresh fetch gagal
      return this.getCurrentPrice(asset, true);
    }
  }

  // ============================================================================
  // ✅ METHOD BARU: GENERATE FRESH MOCK PRICE
  // ============================================================================
  
  private generateFreshMockPrice(asset: Asset): RealtimePrice {
    // Initialize if not exists
    if (!this.simulatedPrices.has(asset.id)) {
      this.initializeMockPrice(asset);
    }

    const currentData = this.simulatedPrices.get(asset.id);
    const initialPrice = currentData?.initialPrice || currentData?.price || 1000;
    
    // Generate fresh price dengan volatilitas
    const volatility = 0.0005; // 0.05%
    const microNoise = (Math.random() - 0.5) * 0.00001;
    const change = (Math.random() - 0.5) * 2 * volatility + microNoise;
    let newPrice = (currentData?.price || initialPrice) * (1 + change);
    
    // Boundary check
    const maxDeviation = 0.02;
    const minPrice = initialPrice * (1 - maxDeviation);
    const maxPrice = initialPrice * (1 + maxDeviation);
    newPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));
    newPrice = this.roundPriceByMagnitude(newPrice);
    
    // Update stored price
    this.simulatedPrices.set(asset.id, {
      price: newPrice,
      initialPrice: initialPrice,
      timestamp: Date.now(),
    });

    const now = Math.floor(Date.now() / 1000);
    
    this.logger.debug(`🎲 [MOCK-FRESH] ${asset.symbol}: ${newPrice}`);

    return {
      price: newPrice,
      timestamp: now,
      datetime: new Date().toISOString(),
    };
  }

  // ============================================================================
  // METHOD EXISTING (TETAP SAMA)
  // ============================================================================

  async getCurrentPrice(
    asset: Asset, 
    useFastCache = false
  ): Promise<RealtimePrice | null> {
    const startTime = Date.now();
    
    try {
      const cacheTTL = useFastCache ? this.FAST_CACHE_TTL : this.NORMAL_CACHE_TTL;
      const cached = this.getCachedPrice(asset.id, cacheTTL);
      
      if (cached) {
        this.cacheHits++;
        const duration = Date.now() - startTime;
        this.logger.debug(`⚡ Cache hit for ${asset.symbol} (${duration}ms)`);
        return cached;
      }

      const price = await this.fetchWithRetry(asset, 3);
      
      if (price) {
        this.priceCache.set(asset.id, {
          price,
          timestamp: Date.now(),
        });

        this.consecutiveFailures = 0;
      }

      const duration = Date.now() - startTime;
      this.fetchCount++;
      this.avgFetchTime = (this.avgFetchTime + duration) / 2;

      if (duration > 1000) {
        this.logger.warn(`⚠️ Slow fetch for ${asset.symbol}: ${duration}ms`);
      }
      
      return price;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.consecutiveFailures++;
      
      this.logger.error(
        `❌ Price fetch failed after ${duration}ms (failure ${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}): ${error.message}`
      );
      
      const staleCache = this.getStaleCache(asset.id);
      if (staleCache) {
        this.logger.warn(`⚠️ Using stale cache for ${asset.symbol} (${this.getStaleAge(asset.id)}s old)`);
        return staleCache;
      }

      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        this.logger.error('❌ Too many consecutive failures, cache might need warming');
        this.consecutiveFailures = 0;
      }
      
      return null;
    }
  }

  private async fetchWithRetry(asset: Asset, maxRetries: number): Promise<RealtimePrice | null> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const price = await this.fetchWithTimeout(asset);
        
        if (price) {
          if (attempt > 0) {
            this.logger.log(`✅ ${asset.symbol} fetch succeeded on retry ${attempt}`);
          }
          return price;
        }

      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          const delay = 200 * (attempt + 1);
          this.logger.debug(`Retry ${attempt + 1} for ${asset.symbol} in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Failed to fetch price');
  }

  private async fetchWithTimeout(asset: Asset): Promise<RealtimePrice | null> {
    return Promise.race([
      this.fetchPrice(asset),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), this.TIMEOUT_MS)
      ),
    ]);
  }

  private async fetchPrice(asset: Asset): Promise<RealtimePrice | null> {
    if (asset.category === ASSET_CATEGORY.CRYPTO) {
      return await this.fetchCryptoPrice(asset);
    }

    switch (asset.dataSource) {
      case ASSET_DATA_SOURCE.REALTIME_DB:
        return await this.fetchFromRealtimeDb(asset);
      
      case ASSET_DATA_SOURCE.API:
        return await this.fetchFromApi(asset);
      
      case ASSET_DATA_SOURCE.MOCK:
        return this.generateMockPrice(asset);
      
      default:
        this.logger.error(`Unknown data source: ${asset.dataSource}`);
        return null;
    }
  }

  private async fetchCryptoPrice(asset: Asset, forceFresh = false): Promise<RealtimePrice | null> {
    try {
      const cryptoPrice = await this.binanceService.getCurrentPrice(asset, forceFresh);
      
      if (!cryptoPrice) {
        return null;
      }

      return {
        price: cryptoPrice.price,
        timestamp: cryptoPrice.timestamp,
        datetime: cryptoPrice.datetime,
      };

    } catch (error) {
      this.logger.error(`❌ Crypto price fetch error for ${asset.symbol}: ${error.message}`);
      return null;
    }
  }

  private async fetchFromRealtimeDb(asset: Asset): Promise<RealtimePrice | null> {
    if (!asset.realtimeDbPath) {
      this.logger.error(`Realtime DB path not configured for ${asset.symbol}`);
      return null;
    }

    try {
      const fullPath = `${asset.realtimeDbPath}/current_price`;
      
      this.logger.debug(`📡 Fetching price from: ${fullPath}`);
      
      // Untuk fetch biasa, gunakan cache (true) untuk performa
      const data = await this.firebaseService.getRealtimeDbValue(
        fullPath,
        true
      );

      if (!data || !data.price) {
        this.logger.warn(`⚠️ No price at ${fullPath}`);
        return null;
      }

      const now = Math.floor(Date.now() / 1000);
      const dataTimestamp = data.timestamp || 0;
      const dataAge = now - dataTimestamp;
      
      if (dataAge > 30) {
        this.logger.warn(
          `⚠️ Price for ${asset.symbol} is ${dataAge}s old - simulator may be slow`
        );
      }

      const price = parseFloat(data.price);
      if (isNaN(price) || price <= 0) {
        this.logger.error(`Invalid price value for ${asset.symbol}: ${data.price}`);
        return null;
      }

      return {
        price: price,
        timestamp: dataTimestamp,
        datetime: data.datetime || new Date(dataTimestamp * 1000).toISOString(),
      };

    } catch (error) {
      this.logger.error(`❌ Realtime DB error for ${asset.symbol}: ${error.message}`);
      throw error;
    }
  }

  private async fetchFromApi(asset: Asset): Promise<RealtimePrice | null> {
    if (!asset.apiEndpoint) {
      this.logger.error(`API endpoint not configured for ${asset.symbol}`);
      return null;
    }

    this.logger.warn(`API fetching not fully implemented for ${asset.symbol}`);
    return null;
  }

  private initializeMockPrice(asset: Asset): void {
    if (this.simulatedPrices.has(asset.id)) return;

    const settings = asset.simulatorSettings;
    const initialPrice = settings?.initialPrice ?? this.getDefaultInitialPrice(asset);
    
    this.simulatedPrices.set(asset.id, {
      price: initialPrice,
      initialPrice: initialPrice,
      timestamp: Date.now(),
    });

    this.logger.debug(`📊 Initialized mock price for ${asset.symbol}: ${initialPrice}`);
  }

  private getDefaultInitialPrice(asset: Asset): number {
    const priceRanges: Record<string, { min: number; max: number }> = {
      forex: { min: 1.0, max: 2.0 },
      commodities: { min: 50, max: 200 },
      stocks: { min: 100, max: 500 },
      indices: { min: 10000, max: 40000 },
      crypto: { min: 30000, max: 70000 },
    };

    const range = priceRanges[asset.category] || { min: 100, max: 1000 };
    return range.min + Math.random() * (range.max - range.min);
  }

  private generateMockPrice(asset: Asset): RealtimePrice {
    if (!this.simulatedPrices.has(asset.id)) {
      this.initializeMockPrice(asset);
    }

    const priceData = this.simulatedPrices.get(asset.id);
    if (priceData) {
      const realtimePrice = {
        price: priceData.price,
        timestamp: Math.floor(Date.now() / 1000),
        datetime: new Date().toISOString(),
      };

      if (asset.category !== ASSET_CATEGORY.CRYPTO) {
        this.tradingGateway.emitPriceUpdate(asset.id, realtimePrice);
      }

      return realtimePrice;
    }

    // Fallback
    const basePrice = asset.simulatorSettings?.initialPrice ?? 1000;
    const volatility = asset.simulatorSettings?.secondVolatilityMax ?? 0.0001;
    const variation = (Math.random() - 0.5) * 2 * basePrice * volatility;
    const price = basePrice + variation;

    return {
      price: Math.round(price * 1000000) / 1000000,
      timestamp: Math.floor(Date.now() / 1000),
      datetime: new Date().toISOString(),
    };
  }

  private roundPriceByMagnitude(price: number): number {
    if (price < 1) {
      return Math.round(price * 100000) / 100000; // 5 decimals
    } else if (price < 100) {
      return Math.round(price * 1000) / 1000; // 3 decimals
    } else if (price < 1000) {
      return Math.round(price * 100) / 100; // 2 decimals
    } else {
      return Math.round(price * 10) / 10; // 1 decimal
    }
  }

  // ============================================================================
  // ✅ PERUBAHAN 8: UPDATE INTERVAL SIMULASI 1 DETIK
  // ============================================================================
  
  private async initializeSimulatedPrices() {
    this.logger.log('📊 Simulated prices ready for initialization');
  }

  private startSimulationInterval() {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
    }
    
    // Update setiap 1 detik
    this.simulationInterval = setInterval(() => {
      this.updateSimulatedPrices();
    }, 1000);
  }

  private updateSimulatedPrices() {
    if (this.simulatedPrices.size === 0) return;

    const updateStart = Date.now();
    let updatedCount = 0;

    this.simulatedPrices.forEach((priceData, assetId) => {
      const volatility = 0.0005; 
      const microNoise = (Math.random() - 0.5) * 0.00001;
      const change = (Math.random() - 0.5) * 2 * volatility + microNoise;
      let newPrice = priceData.price * (1 + change);
      
      const initialPrice = priceData.initialPrice || priceData.price;
      const maxDeviation = 0.02;
      const minPrice = initialPrice * (1 - maxDeviation);
      const maxPrice = initialPrice * (1 + maxDeviation);
      
      newPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));
      newPrice = this.roundPriceByMagnitude(newPrice);
      
      this.simulatedPrices.set(assetId, {
        price: newPrice,
        initialPrice: initialPrice,
        timestamp: Date.now(),
      });
      
      updatedCount++;
    });

    const duration = Date.now() - updateStart;
    this.updateCount++;
    
    const now = Date.now();
    if (now - this.lastLogTime >= 10000) {
      const avgDuration = updatedCount > 0 ? duration / updatedCount : 0;
      this.logger.debug(
        `📈 Mock Price Update: ${updatedCount} assets in ${duration}ms ` +
        `(avg: ${avgDuration.toFixed(2)}ms/asset), ` +
        `total updates: ${this.updateCount}`
      );
      this.lastLogTime = now;
    }
  }

  private getCachedPrice(assetId: string, maxAge: number): RealtimePrice | null {
    const cached = this.priceCache.get(assetId);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > maxAge) return null;

    return cached.price;
  }

  private getStaleCache(assetId: string): RealtimePrice | null {
    const cached = this.priceCache.get(assetId);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    
    if (age < this.STALE_CACHE_TTL) {
      return cached.price;
    }

    return null;
  }

  private getStaleAge(assetId: string): number {
    const cached = this.priceCache.get(assetId);
    if (!cached) return 0;

    return Math.round((Date.now() - cached.timestamp) / 1000);
  }

  private cleanupStaleCache(): void {
    const now = Date.now();
    const MAX_AGE = 60000;
    
    let cleaned = 0;
    for (const [assetId, cached] of this.priceCache.entries()) {
      const age = now - cached.timestamp;
      
      if (age > MAX_AGE) {
        this.priceCache.delete(assetId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`🗑️ Cleaned ${cleaned} stale cache entries`);
    }
  }

  async prefetchPrices(assets: Asset[]): Promise<void> {
    const startTime = Date.now();
    
    const PARALLEL_LIMIT = 3;
    for (let i = 0; i < assets.length; i += PARALLEL_LIMIT) {
      const batch = assets.slice(i, i + PARALLEL_LIMIT);
      
      await Promise.allSettled(
        batch.map(asset => this.getCurrentPrice(asset, false))
      );
    }

    const duration = Date.now() - startTime;
    this.logger.log(`⚡ Prefetched ${assets.length} prices in ${duration}ms`);
  }

  async batchFetchPrices(assets: Asset[]): Promise<Map<string, RealtimePrice | null>> {
    const results = new Map<string, RealtimePrice | null>();
    
    const cryptoAssets = assets.filter(a => a.category === ASSET_CATEGORY.CRYPTO);
    const normalAssets = assets.filter(a => a.category !== ASSET_CATEGORY.CRYPTO);
    
    if (cryptoAssets.length > 0) {
      const cryptoPrices = await this.binanceService.getMultiplePrices(cryptoAssets);
      
      for (const asset of cryptoAssets) {
        const cryptoPrice = cryptoPrices.get(asset.id);
        if (cryptoPrice) {
          results.set(asset.id, {
            price: cryptoPrice.price,
            timestamp: cryptoPrice.timestamp,
            datetime: cryptoPrice.datetime,
          });
        } else {
          results.set(asset.id, null);
        }
      }
    }
    
    const promises = normalAssets.map(async (asset) => {
      try {
        const price = await this.getCurrentPrice(asset, false);
        results.set(asset.id, price);
      } catch (error) {
        results.set(asset.id, null);
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  getPerformanceStats() {
    const cacheHitRate = this.fetchCount > 0 
      ? Math.round((this.cacheHits / (this.fetchCount + this.cacheHits)) * 100)
      : 0;

    return {
      totalFetches: this.fetchCount,
      cacheHits: this.cacheHits,
      cacheHitRate: `${cacheHitRate}%`,
      avgFetchTime: Math.round(this.avgFetchTime),
      cacheSize: this.priceCache.size,
      consecutiveFailures: this.consecutiveFailures,
      isHealthy: this.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES,
      mockPricesCount: this.simulatedPrices.size,
      mockUpdatesCount: this.updateCount,
      cryptoStats: this.binanceService.getStats(),
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    this.binanceService.clearCache();
    this.logger.log('🗑️ Price cache cleared');
  }

  async warmUpCache(assets: Asset[]): Promise<void> {
    this.logger.log(`⚡ Warming up cache for ${assets.length} assets...`);
    await this.prefetchPrices(assets);
  }

  @OnEvent('simulator.price.update')
  handleSimulatorPriceUpdate(payload: { assetId: string, priceData: RealtimePrice }) {
    this.tradingGateway.emitPriceUpdate(payload.assetId, payload.priceData);
    this.logger.debug(`📡 Simulator price broadcast: ${payload.assetId} = ${payload.priceData.price}`);
  }
}