// src/assets/services/coingecko.service.ts
// ✅ FINAL FIX: Request deduplication + Better error logging

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { FirebaseService } from '../../firebase/firebase.service';
import { Asset } from '../../common/interfaces';
import { TimezoneUtil } from '../../common/utils';

export interface CoinGeckoPrice {
  price: number;
  timestamp: number;
  datetime: string;
  volume24h?: number;
  change24h?: number;
  changePercent24h?: number;
  high24h?: number;
  low24h?: number;
  marketCap?: number;
}

@Injectable()
export class CoinGeckoService {
  private readonly logger = new Logger(CoinGeckoService.name);
  private readonly axios: AxiosInstance;
  
  // Price cache
  private priceCache: Map<string, {
    price: CoinGeckoPrice;
    timestamp: number;
  }> = new Map();
  
  // ✅ NEW: Request deduplication
  private pendingRequests: Map<string, Promise<CoinGeckoPrice | null>> = new Map();
  
  private readonly CACHE_TTL = 60000; // 60 seconds
  private readonly STALE_CACHE_TTL = 300000; // 5 minutes
  
  private apiCallCount = 0;
  private cacheHitCount = 0;
  private errorCount = 0;
  private deduplicatedCount = 0; // ✅ NEW
  private lastCallTime = 0;
  private realtimeWriteCount = 0;
  
  // Rate limiting
  private lastApiCallTime = 0;
  private readonly MIN_CALL_INTERVAL = 2000;
  private isRateLimited = false;
  private rateLimitUntil = 0;
  
  private readonly COIN_ID_MAP: Record<string, string> = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'BNB': 'binancecoin',
    'XRP': 'ripple',
    'ADA': 'cardano',
    'SOL': 'solana',
    'DOT': 'polkadot',
    'DOGE': 'dogecoin',
    'MATIC': 'matic-network',
    'POLYGON': 'matic-network',
    'LTC': 'litecoin',
    'AVAX': 'avalanche-2',
    'LINK': 'chainlink',
    'UNI': 'uniswap',
    'ATOM': 'cosmos',
    'XLM': 'stellar',
    'ALGO': 'algorand',
    'VET': 'vechain',
    'ICP': 'internet-computer',
    'FIL': 'filecoin',
    'TRX': 'tron',
    'ETC': 'ethereum-classic',
    'NEAR': 'near',
    'APT': 'aptos',
    'ARB': 'arbitrum',
    'OP': 'optimism',
  };
  
  private readonly VS_CURRENCY_MAP: Record<string, string> = {
    'USD': 'usd',
    'USDT': 'usd',
    'EUR': 'eur',
    'GBP': 'gbp',
    'JPY': 'jpy',
    'KRW': 'krw',
    'IDR': 'idr',
  };

  constructor(
    private firebaseService: FirebaseService,
  ) {
    this.axios = axios.create({
      baseURL: 'https://api.coingecko.com/api/v3',
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
      },
    });

    setInterval(() => this.cleanupCache(), 60000);
    
    this.logger.log('✅ CoinGecko Service initialized');
    this.logger.log('   Rate Limit: 10-50 calls/minute');
    this.logger.log('   Cache TTL: 60 seconds');
    this.logger.log('   Request Deduplication: ENABLED');
  }

  /**
   * ✅ FIXED: Deduplicate concurrent requests
   */
  async getCurrentPrice(asset: Asset): Promise<CoinGeckoPrice | null> {
    if (!asset.cryptoConfig) {
      this.logger.error(`❌ Asset ${asset.symbol} missing cryptoConfig`);
      return null;
    }

    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;
    const cacheKey = `${baseCurrency}/${quoteCurrency}`;

    // 1. Check cache first
    const cached = this.getCachedPrice(cacheKey);
    if (cached) {
      this.cacheHitCount++;
      this.logger.debug(`💰 Cache hit for ${cacheKey}`);
      return cached;
    }

    // 2. ✅ Check if request already pending (DEDUPLICATION)
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      this.deduplicatedCount++;
      this.logger.debug(`🔄 Deduplicated request for ${cacheKey}`);
      return await pending;
    }

    // 3. Create new request and store promise
    const requestPromise = this.fetchPrice(cacheKey, baseCurrency, quoteCurrency, asset);
    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      // ✅ Always cleanup pending request
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * ✅ NEW: Actual fetch logic (separated for deduplication)
   */
  private async fetchPrice(
    cacheKey: string,
    baseCurrency: string,
    quoteCurrency: string,
    asset: Asset
  ): Promise<CoinGeckoPrice | null> {
    // Check rate limit
    if (this.isRateLimited) {
      const now = Date.now();
      if (now < this.rateLimitUntil) {
        const waitTime = Math.ceil((this.rateLimitUntil - now) / 1000);
        this.logger.warn(`⏸️ Rate limited for ${waitTime}s`);
        
        const staleCache = this.getStaleCache(cacheKey);
        if (staleCache) {
          this.logger.warn(`⚠️ Using stale cache for ${cacheKey}`);
          return staleCache;
        }
        
        return null;
      } else {
        this.isRateLimited = false;
        this.logger.log('✅ Rate limit expired');
      }
    }

    // Enforce minimum interval
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    if (timeSinceLastCall < this.MIN_CALL_INTERVAL) {
      const waitTime = this.MIN_CALL_INTERVAL - timeSinceLastCall;
      this.logger.debug(`⏳ Waiting ${waitTime}ms before API call...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const coinId = this.getCoinId(baseCurrency);
    if (!coinId) {
      this.logger.error(`❌ Unsupported coin: ${baseCurrency}`);
      return null;
    }

    const vsCurrency = this.getVsCurrency(quoteCurrency);
    if (!vsCurrency) {
      this.logger.error(`❌ Unsupported quote: ${quoteCurrency}`);
      return null;
    }

    try {
      this.apiCallCount++;
      this.lastCallTime = Date.now();
      this.lastApiCallTime = Date.now();

      this.logger.debug(`📡 API call #${this.apiCallCount}: ${coinId} (${cacheKey})`);

      const response = await this.axios.get(`/coins/${coinId}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false,
        },
      });

      if (!response.data?.market_data) {
        throw new Error(`No market data for ${coinId}`);
      }

      const marketData = response.data.market_data;
      
      const currentPrice = marketData.current_price?.[vsCurrency];
      if (!currentPrice) {
        throw new Error(`No price for ${coinId} in ${vsCurrency}`);
      }

      const high24h = marketData.high_24h?.[vsCurrency];
      const low24h = marketData.low_24h?.[vsCurrency];
      const volume24h = marketData.total_volume?.[vsCurrency];
      const marketCap = marketData.market_cap?.[vsCurrency];
      const priceChange24h = marketData.price_change_24h_in_currency?.[vsCurrency];
      const priceChangePercent24h = marketData.price_change_percentage_24h_in_currency?.[vsCurrency];

      const price: CoinGeckoPrice = {
        price: parseFloat(currentPrice.toFixed(6)),
        timestamp: TimezoneUtil.getCurrentTimestamp(),
        datetime: TimezoneUtil.formatDateTime(),
        volume24h: volume24h || 0,
        change24h: priceChange24h || 0,
        changePercent24h: priceChangePercent24h || 0,
        high24h: high24h || currentPrice,
        low24h: low24h || currentPrice,
        marketCap: marketCap || 0,
      };

      // Cache for 60 seconds
      this.priceCache.set(cacheKey, {
        price,
        timestamp: Date.now(),
      });

      // Write to RT DB (async)
      this.writePriceToRealtimeDb(asset, price).catch(error => {
        this.logger.error(`❌ RT DB write failed: ${error.message}`);
      });

      this.logger.log(
        `✅ ${cacheKey}: $${price.price} ` +
        `(${price.changePercent24h?.toFixed(2)}%)`
      );

      return price;

    } catch (error) {
      this.errorCount++;
      
      // ✅ BETTER error logging
      if (error.response?.status === 429) {
        this.isRateLimited = true;
        this.rateLimitUntil = Date.now() + 60000;
        
        this.logger.error(`⚠️ Rate limit (429) for ${cacheKey}`);
        this.logger.warn(`⏸️ Paused for 60s`);
        
        const staleCache = this.getStaleCache(cacheKey);
        if (staleCache) {
          this.logger.warn(`⚠️ Using stale cache`);
          return staleCache;
        }
      } else if (error.response) {
        // ✅ Log response error details
        this.logger.error(
          `❌ API error for ${cacheKey}: ` +
          `${error.response.status} - ${error.response.statusText}`
        );
        if (error.response.data) {
          this.logger.error(`   Response: ${JSON.stringify(error.response.data)}`);
        }
      } else if (error.request) {
        // ✅ Log request error
        this.logger.error(`❌ No response for ${cacheKey}: ${error.message}`);
      } else {
        // ✅ Log other errors
        this.logger.error(`❌ Error for ${cacheKey}: ${error.message}`);
      }

      return null;
    }
  }

  async getMultiplePrices(
    assets: Asset[]
  ): Promise<Map<string, CoinGeckoPrice | null>> {
    const results = new Map<string, CoinGeckoPrice | null>();
    
    this.logger.log(`📊 Fetching ${assets.length} crypto prices...`);
    
    // ✅ Use Promise.all for concurrent requests (deduplication handles duplicates)
    const promises = assets.map(async (asset) => {
      if (!asset.cryptoConfig) {
        return { assetId: asset.id, price: null };
      }
      
      try {
        const price = await this.getCurrentPrice(asset);
        return { assetId: asset.id, price };
      } catch (error) {
        this.logger.error(`Batch error for ${asset.symbol}: ${error.message}`);
        return { assetId: asset.id, price: null };
      }
    });

    const settled = await Promise.allSettled(promises);
    
    settled.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        results.set(result.value.assetId, result.value.price);
      }
    });

    const successCount = Array.from(results.values()).filter(p => p !== null).length;
    this.logger.log(`✅ Batch: ${successCount}/${assets.length} successful`);

    return results;
  }

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

    if (!this.getCoinId(baseCurrency)) {
      return { 
        valid: false, 
        error: `Unsupported: ${baseCurrency}` 
      };
    }

    if (!this.getVsCurrency(quoteCurrency)) {
      return { 
        valid: false, 
        error: `Unsupported: ${quoteCurrency}` 
      };
    }

    return { valid: true };
  }

  getAvailableSymbols(): string[] {
    return Object.keys(this.COIN_ID_MAP);
  }

  private getCoinId(symbol: string): string | null {
    return this.COIN_ID_MAP[symbol.toUpperCase()] || null;
  }

  private getVsCurrency(currency: string): string | null {
    return this.VS_CURRENCY_MAP[currency.toUpperCase()] || null;
  }

  private async writePriceToRealtimeDb(
    asset: Asset,
    price: CoinGeckoPrice
  ): Promise<void> {
    try {
      if (!asset.cryptoConfig) return;

      const path = this.getCryptoAssetPath(asset);

      const priceData = {
        price: price.price,
        timestamp: price.timestamp,
        datetime: price.datetime,
        datetime_iso: TimezoneUtil.toISOString(),
        timezone: 'Asia/Jakarta',
        volume24h: price.volume24h || 0,
        change24h: price.change24h || 0,
        changePercent24h: price.changePercent24h || 0,
        high24h: price.high24h || 0,
        low24h: price.low24h || 0,
        marketCap: price.marketCap || 0,
        source: 'coingecko',
        pair: `${asset.cryptoConfig.baseCurrency}/${asset.cryptoConfig.quoteCurrency}`,
      };

      await this.firebaseService.setRealtimeDbValue(
        `${path}/current_price`,
        priceData,
        false
      );

      this.realtimeWriteCount++;

    } catch (error) {
      // Suppress RT DB errors (non-critical)
      this.logger.debug(`RT DB write failed: ${error.message}`);
    }
  }

  private getCryptoAssetPath(asset: Asset): string {
    if (!asset.cryptoConfig) {
      return `/crypto/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }

    if (asset.realtimeDbPath) {
      return asset.realtimeDbPath.startsWith('/') 
        ? asset.realtimeDbPath 
        : `/${asset.realtimeDbPath}`;
    }

    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;
    return `/crypto/${baseCurrency.toLowerCase()}_${quoteCurrency.toLowerCase()}`;
  }

  private getCachedPrice(key: string): CoinGeckoPrice | null {
    const cached = this.priceCache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) return null;

    return cached.price;
  }

  private getStaleCache(key: string): CoinGeckoPrice | null {
    const cached = this.priceCache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.STALE_CACHE_TTL) return null;

    return cached.price;
  }

  private cleanupCache(): void {
    const now = Date.now();
    
    for (const [key, cached] of this.priceCache.entries()) {
      if (now - cached.timestamp > this.STALE_CACHE_TTL) {
        this.priceCache.delete(key);
      }
    }
  }

  getStats() {
    const totalCalls = this.apiCallCount + this.cacheHitCount + this.deduplicatedCount;
    const cacheHitRate = totalCalls > 0
      ? Math.round(((this.cacheHitCount + this.deduplicatedCount) / totalCalls) * 100)
      : 0;

    return {
      apiCalls: this.apiCallCount,
      cacheHits: this.cacheHitCount,
      deduplicated: this.deduplicatedCount, // ✅ NEW
      cacheHitRate: `${cacheHitRate}%`,
      errors: this.errorCount,
      cacheSize: this.priceCache.size,
      pendingRequests: this.pendingRequests.size, // ✅ NEW
      realtimeWrites: this.realtimeWriteCount,
      lastCall: this.lastCallTime > 0
        ? `${Math.floor((Date.now() - this.lastCallTime) / 1000)}s ago`
        : 'Never',
      supportedCoins: Object.keys(this.COIN_ID_MAP).length,
      api: 'CoinGecko Free',
      rateLimit: this.isRateLimited 
        ? `⏸️ Until ${new Date(this.rateLimitUntil).toLocaleTimeString()}` 
        : '✅ OK',
      cacheTTL: `${this.CACHE_TTL / 1000}s`,
      minInterval: `${this.MIN_CALL_INTERVAL / 1000}s`,
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    this.pendingRequests.clear(); // ✅ NEW
    this.logger.log('🗑️ Cache cleared');
  }
}