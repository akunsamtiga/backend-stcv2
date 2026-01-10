// src/assets/services/cryptocompare.service.ts
// ✅ NEW: CryptoCompare API Integration

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { CRYPTOCOMPARE_CONFIG } from '../../common/constants';
import { CryptoComparePrice, Asset } from '../../common/interfaces';
import { TimezoneUtil } from '../../common/utils';

@Injectable()
export class CryptoCompareService {
  private readonly logger = new Logger(CryptoCompareService.name);
  private readonly axios: AxiosInstance;
  
  // Cache for crypto prices
  private priceCache: Map<string, {
    price: CryptoComparePrice;
    timestamp: number;
  }> = new Map();
  
  private readonly CACHE_TTL = CRYPTOCOMPARE_CONFIG.CACHE_TTL;
  
  // Statistics
  private apiCallCount = 0;
  private cacheHitCount = 0;
  private errorCount = 0;
  private lastCallTime = 0;

  constructor() {
    this.axios = axios.create({
      baseURL: CRYPTOCOMPARE_CONFIG.BASE_URL,
      timeout: CRYPTOCOMPARE_CONFIG.TIMEOUT,
      headers: {
        'Authorization': `Apikey ${CRYPTOCOMPARE_CONFIG.API_KEY}`,
      },
    });

    // Cleanup stale cache every minute
    setInterval(() => this.cleanupCache(), 60000);
  }

  /**
   * ✅ Get current price for a crypto asset
   */
  async getCurrentPrice(asset: Asset): Promise<CryptoComparePrice | null> {
    if (!asset.cryptoConfig) {
      this.logger.error(`Asset ${asset.symbol} missing cryptoConfig`);
      return null;
    }

    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;
    const cacheKey = `${baseCurrency}/${quoteCurrency}`;

    // Check cache first
    const cached = this.getCachedPrice(cacheKey);
    if (cached) {
      this.cacheHitCount++;
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cached;
    }

    try {
      this.apiCallCount++;
      this.lastCallTime = Date.now();

      // Fetch from CryptoCompare API
      const response = await this.axios.get('/pricemultifull', {
        params: {
          fsyms: baseCurrency,
          tsyms: quoteCurrency,
        },
      });

      if (!response.data?.RAW?.[baseCurrency]?.[quoteCurrency]) {
        throw new Error(`No data for ${cacheKey}`);
      }

      const data = response.data.RAW[baseCurrency][quoteCurrency];
      
      const price: CryptoComparePrice = {
        price: parseFloat(data.PRICE.toFixed(6)),
        timestamp: TimezoneUtil.getCurrentTimestamp(),
        datetime: TimezoneUtil.formatDateTime(),
        volume24h: data.VOLUME24HOUR,
        change24h: data.CHANGE24HOUR,
        changePercent24h: data.CHANGEPCT24HOUR,
        high24h: data.HIGH24HOUR,
        low24h: data.LOW24HOUR,
        marketCap: data.MKTCAP,
      };

      // Cache the result
      this.priceCache.set(cacheKey, {
        price,
        timestamp: Date.now(),
      });

      this.logger.debug(
        `✅ Fetched ${cacheKey}: $${price.price} ` +
        `(24h: ${price.changePercent24h?.toFixed(2)}%)`
      );

      return price;

    } catch (error) {
      this.errorCount++;
      this.logger.error(
        `❌ CryptoCompare API error for ${cacheKey}: ${error.message}`
      );

      // Try to return stale cache if available
      const staleCache = this.getStaleCache(cacheKey);
      if (staleCache) {
        this.logger.warn(`⚠️ Using stale cache for ${cacheKey}`);
        return staleCache;
      }

      return null;
    }
  }

  /**
   * ✅ Get historical OHLC data
   */
  async getHistoricalOHLC(
    baseCurrency: string,
    quoteCurrency: string,
    timeframe: 'minute' | 'hour' | 'day',
    limit: number = 100
  ): Promise<any[]> {
    try {
      const endpoint = timeframe === 'minute' 
        ? '/v2/histominute'
        : timeframe === 'hour'
        ? '/v2/histohour'
        : '/v2/histoday';

      const response = await this.axios.get(endpoint, {
        params: {
          fsym: baseCurrency,
          tsym: quoteCurrency,
          limit,
        },
      });

      if (response.data?.Data?.Data) {
        return response.data.Data.Data.map((bar: any) => ({
          timestamp: bar.time,
          datetime: TimezoneUtil.formatDateTime(new Date(bar.time * 1000)),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volumefrom,
        }));
      }

      return [];

    } catch (error) {
      this.logger.error(
        `❌ Failed to fetch OHLC for ${baseCurrency}/${quoteCurrency}: ${error.message}`
      );
      return [];
    }
  }

  /**
   * ✅ Get multiple prices at once (for batch operations)
   */
  async getMultiplePrices(
    assets: Asset[]
  ): Promise<Map<string, CryptoComparePrice | null>> {
    const results = new Map<string, CryptoComparePrice | null>();
    
    // Group by base currency for efficient API calls
    const byCurrency = new Map<string, { asset: Asset; quote: string }[]>();
    
    for (const asset of assets) {
      if (!asset.cryptoConfig) continue;
      
      const base = asset.cryptoConfig.baseCurrency;
      if (!byCurrency.has(base)) {
        byCurrency.set(base, []);
      }
      byCurrency.get(base)!.push({
        asset,
        quote: asset.cryptoConfig.quoteCurrency,
      });
    }

    // Fetch prices in batches
    for (const [baseCurrency, items] of byCurrency) {
      const quoteCurrencies = [...new Set(items.map(i => i.quote))].join(',');
      
      try {
        const response = await this.axios.get('/pricemultifull', {
          params: {
            fsyms: baseCurrency,
            tsyms: quoteCurrencies,
          },
        });

        for (const { asset, quote } of items) {
          const data = response.data?.RAW?.[baseCurrency]?.[quote];
          
          if (data) {
            const price: CryptoComparePrice = {
              price: parseFloat(data.PRICE.toFixed(6)),
              timestamp: TimezoneUtil.getCurrentTimestamp(),
              datetime: TimezoneUtil.formatDateTime(),
              volume24h: data.VOLUME24HOUR,
              change24h: data.CHANGE24HOUR,
              changePercent24h: data.CHANGEPCT24HOUR,
              high24h: data.HIGH24HOUR,
              low24h: data.LOW24HOUR,
              marketCap: data.MKTCAP,
            };
            
            results.set(asset.id, price);
          } else {
            results.set(asset.id, null);
          }
        }

      } catch (error) {
        this.logger.error(`❌ Batch fetch error for ${baseCurrency}: ${error.message}`);
        items.forEach(({ asset }) => results.set(asset.id, null));
      }
    }

    return results;
  }

  /**
   * ✅ Validate crypto asset configuration
   */
  validateCryptoConfig(asset: Asset): { valid: boolean; error?: string } {
    if (!asset.cryptoConfig) {
      return { valid: false, error: 'Missing cryptoConfig' };
    }

    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;

    if (!baseCurrency || baseCurrency.length < 2) {
      return { valid: false, error: 'Invalid baseCurrency' };
    }

    if (!quoteCurrency || quoteCurrency.length < 2) {
      return { valid: false, error: 'Invalid quoteCurrency' };
    }

    return { valid: true };
  }

  /**
   * ✅ Get available crypto symbols from CryptoCompare
   */
  async getAvailableSymbols(): Promise<string[]> {
    try {
      const response = await this.axios.get('/all/coinlist');
      
      if (response.data?.Data) {
        return Object.keys(response.data.Data);
      }
      
      return [];
    } catch (error) {
      this.logger.error(`❌ Failed to fetch coin list: ${error.message}`);
      return [];
    }
  }

  /**
   * Private helper methods
   */
  private getCachedPrice(key: string): CryptoComparePrice | null {
    const cached = this.priceCache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) {
      return null;
    }

    return cached.price;
  }

  private getStaleCache(key: string): CryptoComparePrice | null {
    const cached = this.priceCache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    // Allow stale cache up to 30 seconds
    if (age > 30000) {
      return null;
    }

    return cached.price;
  }

  private cleanupCache(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    for (const [key, cached] of this.priceCache.entries()) {
      if (now - cached.timestamp > staleThreshold) {
        this.priceCache.delete(key);
      }
    }
  }

  /**
   * ✅ Get service statistics
   */
  getStats() {
    const totalCalls = this.apiCallCount + this.cacheHitCount;
    const cacheHitRate = totalCalls > 0
      ? Math.round((this.cacheHitCount / totalCalls) * 100)
      : 0;

    return {
      apiCalls: this.apiCallCount,
      cacheHits: this.cacheHitCount,
      cacheHitRate: `${cacheHitRate}%`,
      errors: this.errorCount,
      cacheSize: this.priceCache.size,
      lastCall: this.lastCallTime > 0
        ? `${Math.floor((Date.now() - this.lastCallTime) / 1000)}s ago`
        : 'Never',
    };
  }

  /**
   * ✅ Clear cache (for testing/debugging)
   */
  clearCache(): void {
    this.priceCache.clear();
    this.logger.log('🗑️ Cache cleared');
  }
}