// src/assets/services/coingecko.service.ts
// ✅ FIXED: Better rate limiting, longer cache, error handling

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
  
  // ✅ LONGER cache to reduce API calls
  private priceCache: Map<string, {
    price: CoinGeckoPrice;
    timestamp: number;
  }> = new Map();
  
  private readonly CACHE_TTL = 60000; // ✅ 60 seconds (was 10s)
  private readonly STALE_CACHE_TTL = 300000; // ✅ 5 minutes for fallback
  
  private apiCallCount = 0;
  private cacheHitCount = 0;
  private errorCount = 0;
  private lastCallTime = 0;
  private realtimeWriteCount = 0;
  
  // ✅ Rate limiting
  private lastApiCallTime = 0;
  private readonly MIN_CALL_INTERVAL = 2000; // ✅ 2 seconds between calls
  private isRateLimited = false;
  private rateLimitUntil = 0;
  
  // ✅ UPDATED: Better coin ID mapping
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
    'POLYGON': 'matic-network', // ✅ Alias
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
      timeout: 10000, // ✅ Longer timeout
      headers: {
        'Accept': 'application/json',
      },
    });

    setInterval(() => this.cleanupCache(), 60000);
    
    this.logger.log('✅ CoinGecko Service initialized (FREE API)');
    this.logger.log('   Rate Limit: 10-50 calls/minute');
    this.logger.log('   Cache TTL: 60 seconds');
    this.logger.log(`   Supported coins: ${Object.keys(this.COIN_ID_MAP).length}`);
  }

  /**
   * ✅ FIXED: Better rate limiting and error handling
   */
  async getCurrentPrice(asset: Asset): Promise<CoinGeckoPrice | null> {
    if (!asset.cryptoConfig) {
      this.logger.error(`Asset ${asset.symbol} missing cryptoConfig`);
      return null;
    }

    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;
    const cacheKey = `${baseCurrency}/${quoteCurrency}`;

    // ✅ Check cache first
    const cached = this.getCachedPrice(cacheKey);
    if (cached) {
      this.cacheHitCount++;
      this.logger.debug(`💰 Cache hit for ${cacheKey}`);
      return cached;
    }

    // ✅ Check if rate limited
    if (this.isRateLimited) {
      const now = Date.now();
      if (now < this.rateLimitUntil) {
        const waitTime = Math.ceil((this.rateLimitUntil - now) / 1000);
        this.logger.warn(`⏸️ Rate limited, waiting ${waitTime}s...`);
        
        // Return stale cache if available
        const staleCache = this.getStaleCache(cacheKey);
        if (staleCache) {
          this.logger.warn(`⚠️ Using stale cache for ${cacheKey}`);
          return staleCache;
        }
        
        return null;
      } else {
        this.isRateLimited = false;
        this.logger.log('✅ Rate limit expired, resuming...');
      }
    }

    // ✅ Enforce minimum interval between calls
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    if (timeSinceLastCall < this.MIN_CALL_INTERVAL) {
      const waitTime = this.MIN_CALL_INTERVAL - timeSinceLastCall;
      this.logger.debug(`⏳ Waiting ${waitTime}ms before next API call...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const coinId = this.getCoinId(baseCurrency);
    if (!coinId) {
      this.logger.error(`Unsupported coin: ${baseCurrency}`);
      return null;
    }

    const vsCurrency = this.getVsCurrency(quoteCurrency);
    if (!vsCurrency) {
      this.logger.error(`Unsupported quote currency: ${quoteCurrency}`);
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
      const high24h = marketData.high_24h?.[vsCurrency];
      const low24h = marketData.low_24h?.[vsCurrency];
      const volume24h = marketData.total_volume?.[vsCurrency];
      const marketCap = marketData.market_cap?.[vsCurrency];
      const priceChange24h = marketData.price_change_24h_in_currency?.[vsCurrency];
      const priceChangePercent24h = marketData.price_change_percentage_24h_in_currency?.[vsCurrency];

      if (!currentPrice) {
        throw new Error(`No price data for ${coinId} in ${vsCurrency}`);
      }

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

      // ✅ Cache for longer
      this.priceCache.set(cacheKey, {
        price,
        timestamp: Date.now(),
      });

      // ✅ Write to Realtime DB (async, non-blocking)
      this.writePriceToRealtimeDb(asset, price).catch(error => {
        this.logger.error(`RT DB write error: ${error.message}`);
      });

      this.logger.debug(
        `✅ Fetched ${cacheKey}: $${price.price} ` +
        `(24h: ${price.changePercent24h?.toFixed(2)}%)`
      );

      return price;

    } catch (error) {
      this.errorCount++;
      
      // ✅ Handle rate limit (429)
      if (error.response?.status === 429) {
        this.isRateLimited = true;
        this.rateLimitUntil = Date.now() + 60000; // Wait 60 seconds
        
        this.logger.error(`⚠️ CoinGecko rate limit (429) for ${cacheKey}`);
        this.logger.warn(`⏸️ Pausing API calls for 60 seconds...`);
        
        // Return stale cache if available
        const staleCache = this.getStaleCache(cacheKey);
        if (staleCache) {
          this.logger.warn(`⚠️ Using stale cache for ${cacheKey}`);
          return staleCache;
        }
      } else {
        this.logger.error(`❌ CoinGecko API error for ${cacheKey}: ${error.message}`);
      }

      return null;
    }
  }

  /**
   * ✅ FIXED: Batch with longer delays and better error handling
   */
  async getMultiplePrices(
    assets: Asset[]
  ): Promise<Map<string, CoinGeckoPrice | null>> {
    const results = new Map<string, CoinGeckoPrice | null>();
    
    this.logger.log(`📊 Fetching prices for ${assets.length} crypto assets...`);
    
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      
      if (!asset.cryptoConfig) {
        this.logger.warn(`Asset ${asset.symbol} missing cryptoConfig, skipping`);
        results.set(asset.id, null);
        continue;
      }
      
      try {
        const price = await this.getCurrentPrice(asset);
        results.set(asset.id, price);
        
        // ✅ Longer delay between batch calls (3 seconds = 20 calls/minute max)
        if (i < assets.length - 1) {
          this.logger.debug(`⏳ Waiting 3s before next request...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
      } catch (error) {
        this.logger.error(`Batch fetch error for ${asset.symbol}: ${error.message}`);
        results.set(asset.id, null);
      }
    }

    const successCount = Array.from(results.values()).filter(p => p !== null).length;
    this.logger.log(`✅ Batch complete: ${successCount}/${assets.length} successful`);

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
        error: `Unsupported coin: ${baseCurrency}. Supported: ${Object.keys(this.COIN_ID_MAP).join(', ')}` 
      };
    }

    if (!this.getVsCurrency(quoteCurrency)) {
      return { 
        valid: false, 
        error: `Unsupported quote currency: ${quoteCurrency}. Supported: ${Object.keys(this.VS_CURRENCY_MAP).join(', ')}` 
      };
    }

    return { valid: true };
  }

  getAvailableSymbols(): string[] {
    return Object.keys(this.COIN_ID_MAP);
  }

  private getCoinId(symbol: string): string | null {
    const upperSymbol = symbol.toUpperCase();
    return this.COIN_ID_MAP[upperSymbol] || null;
  }

  private getVsCurrency(currency: string): string | null {
    const upperCurrency = currency.toUpperCase();
    return this.VS_CURRENCY_MAP[upperCurrency] || null;
  }

  private async writePriceToRealtimeDb(
    asset: Asset,
    price: CoinGeckoPrice
  ): Promise<void> {
    try {
      if (!asset.cryptoConfig) {
        return;
      }

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
      this.logger.error(`❌ RT DB write failed for ${asset.symbol}: ${error.message}`);
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
    const staleThreshold = this.STALE_CACHE_TTL;

    for (const [key, cached] of this.priceCache.entries()) {
      if (now - cached.timestamp > staleThreshold) {
        this.priceCache.delete(key);
      }
    }
  }

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
      realtimeWrites: this.realtimeWriteCount,
      lastCall: this.lastCallTime > 0
        ? `${Math.floor((Date.now() - this.lastCallTime) / 1000)}s ago`
        : 'Never',
      supportedCoins: Object.keys(this.COIN_ID_MAP).length,
      api: 'CoinGecko Free Tier',
      rateLimit: this.isRateLimited ? `⏸️ Limited until ${new Date(this.rateLimitUntil).toLocaleTimeString()}` : '✅ OK',
      cacheTTL: `${this.CACHE_TTL / 1000}s`,
      minCallInterval: `${this.MIN_CALL_INTERVAL / 1000}s`,
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    this.logger.log('🗑️ Cache cleared');
  }
}