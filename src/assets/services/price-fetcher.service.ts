import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { Asset, RealtimePrice } from '../../common/interfaces';

@Injectable()
export class PriceFetcherService {
  private readonly logger = new Logger(PriceFetcherService.name);
  
  // ⚡ Ultra-fast timeout
  private readonly TIMEOUT_MS = 1000; // 1 second only
  
  // ⚡ Multi-layer cache
  private priceCache: Map<string, {
    price: RealtimePrice;
    timestamp: number;
  }> = new Map();
  
  // ⚡ Super fast cache - 1 second TTL for order creation
  private readonly FAST_CACHE_TTL = 1000; // 1 second
  
  // ⚡ Normal cache - 3 seconds TTL for general use
  private readonly NORMAL_CACHE_TTL = 3000; // 3 seconds
  
  // ⚡ Connection pool for REST API
  private connectionPool: Map<string, number> = new Map();
  private readonly MAX_CONNECTIONS = 10;
  
  // ⚡ Performance metrics
  private fetchCount = 0;
  private cacheHits = 0;
  private avgFetchTime = 0;

  constructor(private firebaseService: FirebaseService) {
    // ⚡ Cleanup stale cache every 5 seconds
    setInterval(() => this.cleanupStaleCache(), 5000);
  }

  /**
   * ⚡ GET CURRENT PRICE - ULTRA FAST
   * Target: < 100ms with cache, < 500ms without
   */
  async getCurrentPrice(
    asset: Asset, 
    useFastCache = false
  ): Promise<RealtimePrice | null> {
    const startTime = Date.now();
    
    try {
      // ✅ Step 1: Try cache first (< 10ms)
      const cacheTTL = useFastCache ? this.FAST_CACHE_TTL : this.NORMAL_CACHE_TTL;
      const cached = this.getCachedPrice(asset.id, cacheTTL);
      
      if (cached) {
        this.cacheHits++;
        const duration = Date.now() - startTime;
        this.logger.debug(`⚡ Cache hit for ${asset.symbol} (${duration}ms)`);
        return cached;
      }

      // ✅ Step 2: Fetch with aggressive timeout
      const price = await this.fetchWithTimeout(asset);
      
      if (price) {
        this.priceCache.set(asset.id, {
          price,
          timestamp: Date.now(),
        });
      }

      const duration = Date.now() - startTime;
      this.fetchCount++;
      this.avgFetchTime = (this.avgFetchTime + duration) / 2;

      this.logger.debug(`⚡ Fetched ${asset.symbol} in ${duration}ms`);
      
      return price;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Price fetch failed after ${duration}ms: ${error.message}`);
      
      // ✅ Return stale cache as fallback
      return this.getStaleCache(asset.id);
    }
  }

  /**
   * ⚡ GET CACHED PRICE (< 10ms)
   */
  private getCachedPrice(assetId: string, maxAge: number): RealtimePrice | null {
    const cached = this.priceCache.get(assetId);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > maxAge) {
      return null; // Too old
    }

    return cached.price;
  }

  /**
   * ⚡ GET STALE CACHE (Last resort)
   */
  private getStaleCache(assetId: string): RealtimePrice | null {
    const cached = this.priceCache.get(assetId);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    
    // Only use if < 30 seconds old
    if (age < 30000) {
      this.logger.warn(`Using stale cache (${Math.round(age / 1000)}s old)`);
      return cached.price;
    }

    return null;
  }

  /**
   * ⚡ FETCH WITH AGGRESSIVE TIMEOUT
   */
  private async fetchWithTimeout(asset: Asset): Promise<RealtimePrice | null> {
    return Promise.race([
      this.fetchPrice(asset),
      this.timeoutPromise(),
    ]);
  }

  /**
   * ⚡ TIMEOUT PROMISE
   */
  private timeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout after ${this.TIMEOUT_MS}ms`));
      }, this.TIMEOUT_MS);
    });
  }

  /**
   * ⚡ FETCH PRICE (Main logic)
   */
  private async fetchPrice(asset: Asset): Promise<RealtimePrice | null> {
    switch (asset.dataSource) {
      case 'realtime_db':
        return await this.fetchFromRealtimeDbFast(asset);
      
      case 'api':
        return await this.fetchFromApi(asset);
      
      case 'mock':
        return this.generateMockPrice(asset);
      
      default:
        this.logger.error(`Unknown data source: ${asset.dataSource}`);
        return null;
    }
  }

  /**
   * ⚡ ULTRA-FAST REALTIME DB FETCH
   * Optimized for IDX_STC simulator
   */
  private async fetchFromRealtimeDbFast(asset: Asset): Promise<RealtimePrice | null> {
    if (!asset.realtimeDbPath) {
      this.logger.error(`Realtime DB path not configured for ${asset.symbol}`);
      return null;
    }

    try {
      // ✅ Direct fetch with hybrid method (REST or SDK)
      const data = await this.firebaseService.getRealtimeDbValue(asset.realtimeDbPath);

      if (!data?.price) {
        this.logger.warn(`No price data for ${asset.symbol}`);
        return null;
      }

      // ✅ Quick validation
      const now = Math.floor(Date.now() / 1000);
      const dataAge = now - (data.timestamp || 0);
      
      // Warn if data is old but still use it
      if (dataAge > 10) {
        this.logger.warn(
          `Price for ${asset.symbol} is ${dataAge}s old - simulator may be lagging`
        );
      }

      // ✅ Return normalized data
      return {
        price: parseFloat(data.price),
        timestamp: data.timestamp || now,
        datetime: data.datetime || new Date().toISOString(),
      };

    } catch (error) {
      this.logger.error(`Realtime DB error for ${asset.symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * ⚡ API FETCH (For future use)
   */
  private async fetchFromApi(asset: Asset): Promise<RealtimePrice | null> {
    if (!asset.apiEndpoint) {
      this.logger.error(`API endpoint not configured for ${asset.symbol}`);
      return null;
    }

    // TODO: Implement API fetching with connection pooling
    this.logger.warn(`API fetching not fully implemented for ${asset.symbol}`);
    return null;
  }

  /**
   * ⚡ MOCK PRICE (For testing)
   */
  private generateMockPrice(asset: Asset): RealtimePrice {
    const basePrice = 1000;
    const variation = (Math.random() - 0.5) * 20; // ±10
    const price = basePrice + variation;

    return {
      price: Math.round(price * 1000) / 1000,
      timestamp: Math.floor(Date.now() / 1000),
      datetime: new Date().toISOString(),
    };
  }

  /**
   * ⚡ CLEANUP STALE CACHE
   */
  private cleanupStaleCache(): void {
    const now = Date.now();
    const MAX_AGE = 60000; // 60 seconds
    
    for (const [assetId, cached] of this.priceCache.entries()) {
      const age = now - cached.timestamp;
      
      if (age > MAX_AGE) {
        this.priceCache.delete(assetId);
      }
    }

    if (this.priceCache.size > 0) {
      this.logger.debug(`Cache size: ${this.priceCache.size} assets`);
    }
  }

  /**
   * ⚡ PREFETCH PRICES (For active assets)
   * Call this periodically to warm up cache
   */
  async prefetchPrices(assets: Asset[]): Promise<void> {
    const startTime = Date.now();
    
    // Fetch all in parallel with limit
    const PARALLEL_LIMIT = 5;
    for (let i = 0; i < assets.length; i += PARALLEL_LIMIT) {
      const batch = assets.slice(i, i + PARALLEL_LIMIT);
      
      await Promise.allSettled(
        batch.map(asset => this.getCurrentPrice(asset, false))
      );
    }

    const duration = Date.now() - startTime;
    this.logger.log(`⚡ Prefetched ${assets.length} prices in ${duration}ms`);
  }

  /**
   * ⚡ PERFORMANCE STATS
   */
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
    };
  }

  /**
   * ⚡ BATCH FETCH (Multiple assets at once)
   */
  async batchFetchPrices(assets: Asset[]): Promise<Map<string, RealtimePrice | null>> {
    const results = new Map<string, RealtimePrice | null>();
    
    // Parallel fetch with Promise.allSettled
    const promises = assets.map(async (asset) => {
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

  /**
   * CLEAR CACHE (for testing)
   */
  clearCache(): void {
    this.priceCache.clear();
    this.logger.log('Price cache cleared');
  }

  /**
   * WARM UP CACHE (on service start)
   */
  async warmUpCache(assets: Asset[]): Promise<void> {
    this.logger.log(`⚡ Warming up cache for ${assets.length} assets...`);
    await this.prefetchPrices(assets);
  }
}