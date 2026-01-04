// src/assets/services/price-fetcher.service.ts
// ✅ FIXED: Type errors in generateMockPrice

import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../firebase/firebase.service';
import { Asset, RealtimePrice } from '../../common/interfaces';
import { TimezoneUtil } from '../../common/utils';

@Injectable()
export class PriceFetcherService {
  private readonly logger = new Logger(PriceFetcherService.name);
  
  private readonly TIMEOUT_MS = 2000;
  
  private priceCache: Map<string, {
    price: RealtimePrice;
    timestamp: number;
  }> = new Map();
  
  private readonly FAST_CACHE_TTL = 2000;
  private readonly NORMAL_CACHE_TTL = 5000;
  private readonly STALE_CACHE_TTL = 30000;
  
  private fetchCount = 0;
  private cacheHits = 0;
  private avgFetchTime = 0;
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;

  constructor(private firebaseService: FirebaseService) {
    setInterval(() => this.cleanupStaleCache(), 5000);
  }

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
      } else {
        this.logger.debug(`⚡ Fetched ${asset.symbol} in ${duration}ms`);
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

  private getCachedPrice(assetId: string, maxAge: number): RealtimePrice | null {
    const cached = this.priceCache.get(assetId);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > maxAge) {
      return null;
    }

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

  private async fetchWithTimeout(asset: Asset): Promise<RealtimePrice | null> {
    return Promise.race([
      this.fetchPrice(asset),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), this.TIMEOUT_MS)
      ),
    ]);
  }

  private async fetchPrice(asset: Asset): Promise<RealtimePrice | null> {
    switch (asset.dataSource) {
      case 'realtime_db':
        return await this.fetchFromRealtimeDb(asset);
      
      case 'api':
        return await this.fetchFromApi(asset);
      
      case 'mock':
        return this.generateMockPrice(asset);
      
      default:
        this.logger.error(`Unknown data source: ${asset.dataSource}`);
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
      
      const data = await this.firebaseService.getRealtimeDbValue(
        fullPath,
        true
      );

      if (!data) {
        this.logger.warn(`⚠️ No data at ${fullPath}`);
        return null;
      }

      if (!data.price) {
        this.logger.warn(`⚠️ No price field at ${fullPath}, got: ${JSON.stringify(data)}`);
        return null;
      }

      const now = Math.floor(Date.now() / 1000);
      const dataTimestamp = data.timestamp || 0;
      const dataAge = now - dataTimestamp;
      
      if (dataAge > 30) {
        this.logger.warn(
          `⚠️ Price for ${asset.symbol} is ${dataAge}s old - simulator may be slow or stopped`
        );
      }

      const price = parseFloat(data.price);
      if (isNaN(price) || price <= 0) {
        this.logger.error(`Invalid price value for ${asset.symbol}: ${data.price}`);
        return null;
      }

      const result: RealtimePrice = {
        price: price,
        timestamp: dataTimestamp,
        datetime: data.datetime || new Date(dataTimestamp * 1000).toISOString(),
      };

      this.logger.debug(
        `✅ Got price for ${asset.symbol}: ${price} (${dataAge}s old) from ${fullPath}`
      );

      return result;

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

  private generateMockPrice(asset: Asset): RealtimePrice {
  const settings = asset.simulatorSettings;
  const basePrice = settings?.initialPrice ?? 1000;
  const volatility = settings?.secondVolatilityMax ?? 0.0001;
  
  const variation = (Math.random() - 0.5) * 2 * basePrice * volatility;
  const price = basePrice + variation;

  return {
    price: Math.round(price * 1000000) / 1000000,
    timestamp: TimezoneUtil.getCurrentTimestamp(),  // ✅ CONSISTENT
    datetime: TimezoneUtil.formatDateTime(),        // ✅ CONSISTENT
  };
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
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    this.logger.log('🗑️ Price cache cleared');
  }

  async warmUpCache(assets: Asset[]): Promise<void> {
    this.logger.log(`⚡ Warming up cache for ${assets.length} assets...`);
    await this.prefetchPrices(assets);
  }
}
