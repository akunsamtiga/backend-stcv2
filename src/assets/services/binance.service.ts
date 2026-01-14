// src/assets/services/binance.service.ts
// ✅ FIXED: 5-second cache for near-realtime updates

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { FirebaseService } from '../../firebase/firebase.service';
import { Asset } from '../../common/interfaces';
import { TimezoneUtil } from '../../common/utils';

export interface BinancePrice {
  price: number;
  timestamp: number;
  datetime: string;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
}

@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);
  private readonly axios: AxiosInstance;
  
  // Price cache
  private priceCache: Map<string, {
    price: BinancePrice;
    timestamp: number;
  }> = new Map();
  
  // Request deduplication
  private pendingRequests: Map<string, Promise<BinancePrice | null>> = new Map();
  
  // ✅ FIXED: Changed from 60s to 5s for near-realtime
  private readonly CACHE_TTL = 5000; // 5 seconds (was 60000)
  private readonly STALE_CACHE_TTL = 15000; // 15 seconds (was 300000)
  
  private apiCallCount = 0;
  private cacheHitCount = 0;
  private errorCount = 0;
  private deduplicatedCount = 0;
  private lastCallTime = 0;
  private realtimeWriteCount = 0;
  
  // Rate limiting (Binance: 1200 req/min)
  private lastApiCallTime = 0;
  private readonly MIN_CALL_INTERVAL = 50; // 50ms between calls
  private isRateLimited = false;
  private rateLimitUntil = 0;
  
  // ✅ Binance symbol mapping
  private readonly BINANCE_SYMBOL_MAP: Record<string, string> = {
    'BTC': 'BTCUSDT',
    'ETH': 'ETHUSDT',
    'BNB': 'BNBUSDT',
    'XRP': 'XRPUSDT',
    'ADA': 'ADAUSDT',
    'SOL': 'SOLUSDT',
    'DOT': 'DOTUSDT',
    'DOGE': 'DOGEUSDT',
    'MATIC': 'MATICUSDT',
    'LTC': 'LTCUSDT',
    'AVAX': 'AVAXUSDT',
    'LINK': 'LINKUSDT',
    'UNI': 'UNIUSDT',
    'ATOM': 'ATOMUSDT',
    'XLM': 'XLMUSDT',
    'ALGO': 'ALGOUSDT',
    'VET': 'VETUSDT',
    'ICP': 'ICPUSDT',
    'FIL': 'FILUSDT',
    'TRX': 'TRXUSDT',
    'ETC': 'ETCUSDT',
    'NEAR': 'NEARUSDT',
    'APT': 'APTUSDT',
    'ARB': 'ARBUSDT',
    'OP': 'OPUSDT',
  };

  constructor(
    private firebaseService: FirebaseService,
  ) {
    this.axios = axios.create({
      baseURL: 'https://api.binance.com/api/v3',
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'binary-trading-platform/1.0',
      },
    });

    setInterval(() => this.cleanupCache(), 10000);
    
    this.logger.log('✅ Binance Service initialized (NEAR-REALTIME MODE)');
    this.logger.log('   Rate Limit: 1200 req/min (conservative: 20 req/sec)');
    this.logger.log('   Cache TTL: 5 seconds ← OPTIMIZED!');
    this.logger.log('   API Calls: ~720/hour per asset');
    this.logger.log('   Request Deduplication: ENABLED');
    this.logger.log('   📄 Auto USD->USDT Mapping: ENABLED');
  }

  /**
   * ✅ Main entry point with 5s cache
   */
  async getCurrentPrice(asset: Asset): Promise<BinancePrice | null> {
    if (!asset.cryptoConfig) {
      this.logger.error(`❌ Asset ${asset.symbol} missing cryptoConfig`);
      return null;
    }

    // ✅ Normalize quote currency (USD -> USDT)
    const { baseCurrency } = asset.cryptoConfig;
    let { quoteCurrency } = asset.cryptoConfig;
    
    if (quoteCurrency.toUpperCase() === 'USD') {
      quoteCurrency = 'USDT';
      this.logger.debug(`📄 Auto-mapped ${baseCurrency}/USD to ${baseCurrency}/USDT`);
    }
    
    // ✅ Get Binance symbol
    const binanceSymbol = this.getBinanceSymbol(baseCurrency);
    if (!binanceSymbol) {
      this.logger.error(`❌ Unsupported coin: ${baseCurrency}`);
      this.logger.error(`   Supported: ${Object.keys(this.BINANCE_SYMBOL_MAP).join(', ')}`);
      return null;
    }

    const cacheKey = `${baseCurrency}/${quoteCurrency}`;

    // 1. Check cache (5s TTL - akan miss lebih sering!)
    const cached = this.getCachedPrice(cacheKey);
    if (cached) {
      this.cacheHitCount++;
      this.logger.debug(`💰 Cache hit for ${cacheKey} (${this.getCacheAge(cacheKey)}s old)`);
      return cached;
    }

    // 2. Check deduplication
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      this.deduplicatedCount++;
      this.logger.debug(`🔄 Deduplicated request for ${cacheKey}`);
      return await pending;
    }

    // 3. Fetch fresh data (lebih sering karena cache cuma 5s!)
    const requestPromise = this.fetchPrice(cacheKey, binanceSymbol, asset);
    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * ✅ Actual fetch with rate limiting
   */
  private async fetchPrice(
    cacheKey: string,
    binanceSymbol: string,
    asset: Asset
  ): Promise<BinancePrice | null> {
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

    try {
      this.apiCallCount++;
      this.lastCallTime = Date.now();
      this.lastApiCallTime = Date.now();

      this.logger.debug(`📡 API call #${this.apiCallCount}: ${binanceSymbol} (${cacheKey})`);

      // ✅ Call Binance API
      const response = await this.axios.get('/ticker/24hr', {
        params: {
          symbol: binanceSymbol,
        },
      });

      if (!response.data?.lastPrice) {
        throw new Error(`No price data for ${binanceSymbol}`);
      }

      const data = response.data;
      
      // ✅ Create price object
      const price: BinancePrice = {
        price: parseFloat(parseFloat(data.lastPrice).toFixed(6)),
        timestamp: TimezoneUtil.getCurrentTimestamp(),
        datetime: TimezoneUtil.formatDateTime(),
        volume24h: parseFloat(data.volume) || 0,
        change24h: parseFloat(data.priceChange) || 0,
        changePercent24h: parseFloat(data.priceChangePercent) || 0,
        high24h: parseFloat(data.highPrice) || 0,
        low24h: parseFloat(data.lowPrice) || 0,
      };

      // ✅ Cache for 5 seconds (not 60!)
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
        `(${price.changePercent24h?.toFixed(2)}%) ` +
        `[API call #${this.apiCallCount}]`
      );

      return price;

    } catch (error) {
      this.errorCount++;
      
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
      } else if (error.response?.status === 400) {
        this.logger.error(`❌ Invalid symbol: ${binanceSymbol}`);
        this.logger.error(`   ${asset.symbol} (${asset.cryptoConfig?.baseCurrency}/${asset.cryptoConfig?.quoteCurrency})`);
      } else if (error.response?.status === 404) {
        this.logger.error(`❌ Symbol not found: ${binanceSymbol}`);
      } else if (error.response) {
        this.logger.error(
          `❌ API error for ${binanceSymbol}: ` +
          `${error.response.status} - ${error.response.statusText}`
        );
      } else if (error.request) {
        this.logger.error(`❌ No response for ${binanceSymbol}: ${error.message}`);
      } else {
        this.logger.error(`❌ Error for ${cacheKey}: ${error.message}`);
      }

      return null;
    }
  }

  /**
   * ✅ Batch fetch multiple prices
   */
  async getMultiplePrices(
    assets: Asset[]
  ): Promise<Map<string, BinancePrice | null>> {
    const results = new Map<string, BinancePrice | null>();
    
    this.logger.log(`📊 Fetching ${assets.length} crypto prices...`);
    
    const promises = assets.map(async (asset) => {
      if (!asset.cryptoConfig) {
        this.logger.warn(`Asset ${asset.symbol} missing cryptoConfig, skipping`);
        return { assetId: asset.id, price: null };
      }
      
      try {
        const price = await this.getCurrentPrice(asset);
        return { assetId: asset.id, price };
      } catch (error) {
        this.logger.error(`Batch fetch error for ${asset.symbol}: ${error.message}`);
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

  /**
   * ✅ Validation
   */
  validateCryptoConfig(asset: Asset): { valid: boolean; error?: string } {
    if (!asset.cryptoConfig) {
      return { valid: false, error: 'Missing cryptoConfig' };
    }

    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;

    if (!baseCurrency || baseCurrency.trim().length < 2) {
      return { valid: false, error: 'Invalid baseCurrency' };
    }

    if (!quoteCurrency || quoteCurrency.trim().length < 2) {
      return { valid: false, error: 'Invalid quoteCurrency' };
    }

    const binanceSymbol = this.getBinanceSymbol(baseCurrency);
    if (!binanceSymbol) {
      return { 
        valid: false, 
        error: `Unsupported coin: ${baseCurrency}. Supported: ${Object.keys(this.BINANCE_SYMBOL_MAP).join(', ')}` 
      };
    }

    const normalizedQuote = quoteCurrency.toUpperCase();
    const validQuoteCurrencies = ['USD', 'USDT', 'BUSD', 'EUR', 'GBP'];
    if (!validQuoteCurrencies.includes(normalizedQuote)) {
      return { 
        valid: false, 
        error: `Quote currency ${quoteCurrency} not supported. Use: ${validQuoteCurrencies.join(', ')}` 
      };
    }

    return { valid: true };
  }

  /**
   * ✅ Get available symbols
   */
  getAvailableSymbols(): string[] {
    return Object.keys(this.BINANCE_SYMBOL_MAP);
  }

  /**
   * ✅ Convert base currency to Binance symbol
   */
  private getBinanceSymbol(baseCurrency: string): string | null {
    const symbol = this.BINANCE_SYMBOL_MAP[baseCurrency.toUpperCase()];
    if (!symbol) {
      this.logger.warn(`❌ No Binance symbol for: ${baseCurrency}`);
      return null;
    }
    return symbol;
  }

  /**
   * ✅ Write price to Realtime Database
   */
  private async writePriceToRealtimeDb(
    asset: Asset,
    price: BinancePrice
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
        marketCap: 0,
        source: 'binance',
        pair: `${asset.cryptoConfig.baseCurrency}/${asset.cryptoConfig.quoteCurrency}`,
      };

      await this.firebaseService.setRealtimeDbValue(
        `${path}/current_price`,
        priceData,
        false
      );

      this.realtimeWriteCount++;

    } catch (error) {
      this.logger.error(`❌ RT DB write failed: ${error.message}`);
    }
  }

  /**
   * ✅ Generate proper path
   */
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
    
    const normalizedQuote = quoteCurrency.toUpperCase() === 'USD' 
      ? 'usdt' 
      : quoteCurrency.toLowerCase();
    
    const path = `/crypto/${baseCurrency.toLowerCase()}_${normalizedQuote}`;
    return path;
  }

  /**
   * Cache management
   */
  private getCachedPrice(key: string): BinancePrice | null {
    const cached = this.priceCache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) return null;

    return cached.price;
  }

  private getStaleCache(key: string): BinancePrice | null {
    const cached = this.priceCache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.STALE_CACHE_TTL) return null;

    return cached.price;
  }

  private getCacheAge(key: string): number {
    const cached = this.priceCache.get(key);
    if (!cached) return 0;
    
    return Math.floor((Date.now() - cached.timestamp) / 1000);
  }

  private cleanupCache(): void {
    const now = Date.now();
    
    for (const [key, cached] of this.priceCache.entries()) {
      if (now - cached.timestamp > this.STALE_CACHE_TTL) {
        this.priceCache.delete(key);
      }
    }
  }

  /**
   * ✅ Statistics
   */
  getStats() {
    const totalCalls = this.apiCallCount + this.cacheHitCount + this.deduplicatedCount;
    const cacheHitRate = totalCalls > 0
      ? Math.round(((this.cacheHitCount + this.deduplicatedCount) / totalCalls) * 100)
      : 0;

    // Calculate estimated calls per hour
    const uptime = this.lastCallTime > 0 ? Date.now() - this.lastCallTime : 0;
    const estimatedCallsPerHour = uptime > 0
      ? Math.round((this.apiCallCount / (uptime / 1000)) * 3600)
      : 0;

    return {
      apiCalls: this.apiCallCount,
      cacheHits: this.cacheHitCount,
      deduplicated: this.deduplicatedCount,
      cacheHitRate: `${cacheHitRate}%`,
      errors: this.errorCount,
      cacheSize: this.priceCache.size,
      pendingRequests: this.pendingRequests.size,
      realtimeWrites: this.realtimeWriteCount,
      lastCall: this.lastCallTime > 0
        ? `${Math.floor((Date.now() - this.lastCallTime) / 1000)}s ago`
        : 'Never',
      supportedCoins: Object.keys(this.BINANCE_SYMBOL_MAP).length,
      api: 'Binance FREE',
      rateLimit: this.isRateLimited 
        ? `⏸️ Until ${new Date(this.rateLimitUntil).toLocaleTimeString()}` 
        : '✅ OK',
      cacheTTL: '5s ← OPTIMIZED!',
      minInterval: `${this.MIN_CALL_INTERVAL}ms`,
      autoMapping: 'USD→USDT ✅',
      estimatedCallsPerHour,
      performance: {
        avgCacheAge: `~2.5s`,
        updateFrequency: 'Every ~5s',
        apiCallsPerAssetPerHour: '~720',
      }
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    this.pendingRequests.clear();
    this.logger.log('🗑️ Cache cleared');
  }
}