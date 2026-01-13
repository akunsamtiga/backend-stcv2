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
  
  // ✅ NEW: Request deduplication (same as CoinGecko)
  private pendingRequests: Map<string, Promise<BinancePrice | null>> = new Map();
  
  private readonly CACHE_TTL = 60000; // 60 seconds
  private readonly STALE_CACHE_TTL = 300000; // 5 minutes
  
  private apiCallCount = 0;
  private cacheHitCount = 0;
  private errorCount = 0;
  private deduplicatedCount = 0;
  private lastCallTime = 0;
  private realtimeWriteCount = 0;
  
  // Rate limiting (Binance: 1200 req/min, we'll use conservative limits)
  private lastApiCallTime = 0;
  private readonly MIN_CALL_INTERVAL = 50; // 50ms between calls = ~20 req/sec
  private isRateLimited = false;
  private rateLimitUntil = 0;
  
  // ✅ BINANCE SYMBOL MAPPING
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

    setInterval(() => this.cleanupCache(), 60000);
    
    this.logger.log('✅ Binance Service initialized (PUBLIC API)');
    this.logger.log('   Rate Limit: 1200 req/min (conservative: 20 req/sec)');
    this.logger.log('   Cache TTL: 60 seconds');
    this.logger.log('   Request Deduplication: ENABLED');
  }

  /**
   * ✅ FIXED: Deduplicate concurrent requests
   */
  async getCurrentPrice(asset: Asset): Promise<BinancePrice | null> {
    if (!asset.cryptoConfig) {
      this.logger.error(`❌ Asset ${asset.symbol} missing cryptoConfig`);
      return null;
    }

    const { baseCurrency, quoteCurrency } = asset.cryptoConfig;
    
    // ✅ Map to Binance symbol (e.g., ETH/USD -> ETHUSDT)
    const binanceSymbol = this.getBinanceSymbol(baseCurrency);
    if (!binanceSymbol) {
      this.logger.error(`❌ Unsupported coin: ${baseCurrency}`);
      return null;
    }

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
    const requestPromise = this.fetchPrice(cacheKey, binanceSymbol, asset);
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
   * ✅ NEW: Actual fetch logic for Binance
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

      const response = await this.axios.get('/ticker/24hr', {
        params: {
          symbol: binanceSymbol,
        },
      });

      if (!response.data?.lastPrice) {
        throw new Error(`No price data for ${binanceSymbol}`);
      }

      const data = response.data;
      
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
      
      // ✅ BETTER error handling
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
        this.logger.error(
          `❌ API error for ${binanceSymbol}: ` +
          `${error.response.status} - ${error.response.statusText}`
        );
        if (error.response.data) {
          this.logger.error(`   Response: ${JSON.stringify(error.response.data)}`);
        }
      } else if (error.request) {
        this.logger.error(`❌ No response for ${binanceSymbol}: ${error.message}`);
      } else {
        this.logger.error(`❌ Error for ${cacheKey}: ${error.message}`);
      }

      return null;
    }
  }

  async getMultiplePrices(
    assets: Asset[]
  ): Promise<Map<string, BinancePrice | null>> {
    const results = new Map<string, BinancePrice | null>();
    
    this.logger.log(`📊 Fetching ${assets.length} crypto prices...`);
    
    // ✅ Use Promise.all for concurrent requests (deduplication handles duplicates)
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
   * ✅ VALIDATION: Check if crypto config is valid for Binance
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

    // ✅ Map to Binance symbol
    const binanceSymbol = this.getBinanceSymbol(baseCurrency);
    if (!binanceSymbol) {
      return { 
        valid: false, 
        error: `Unsupported coin: ${baseCurrency}. Supported: ${Object.keys(this.BINANCE_SYMBOL_MAP).join(', ')}` 
      };
    }

    // ✅ Note: Binance primarily uses USDT, BUSD, etc.
    const validQuoteCurrencies = ['USD', 'USDT', 'BUSD', 'EUR', 'GBP'];
    if (!validQuoteCurrencies.includes(quoteCurrency.toUpperCase())) {
      return { 
        valid: false, 
        error: `Quote currency ${quoteCurrency} not recommended. Use: ${validQuoteCurrencies.join(', ')}` 
      };
    }

    return { valid: true };
  }

  getAvailableSymbols(): string[] {
    return Object.keys(this.BINANCE_SYMBOL_MAP);
  }

  /**
   * ✅ Convert base currency to Binance symbol
   */
  private getBinanceSymbol(baseCurrency: string): string | null {
    return this.BINANCE_SYMBOL_MAP[baseCurrency.toUpperCase()] || null;
  }

  /**
   * ✅ Convert pair to Binance symbol (e.g., ETH/USD -> ETHUSDT)
   */
  private getBinanceTradingPair(baseCurrency: string, quoteCurrency: string): string {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    
    // If quote is USD, we map to USDT for Binance
    const mappedQuote = quote === 'USD' ? 'USDT' : quote;
    
    // Check if we have direct mapping
    const directSymbol = `${base}${mappedQuote}`;
    if (this.BINANCE_SYMBOL_MAP[base]) {
      return this.BINANCE_SYMBOL_MAP[base];
    }
    
    // Return direct pair
    return directSymbol;
  }

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
        marketCap: 0, // Binance doesn't provide market cap in this endpoint
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
    
    // ✅ FIXED: Generate proper path
    const path = `/crypto/${baseCurrency.toLowerCase()}_${quoteCurrency.toLowerCase().replace('usd', 'usdt')}`;
    return path;
  }

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
      cacheTTL: `${this.CACHE_TTL / 1000}s`,
      minInterval: `${this.MIN_CALL_INTERVAL}ms`,
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    this.pendingRequests.clear();
    this.logger.log('🗑️ Cache cleared');
  }
}