// src/assets/services/binance.service.ts

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

  private priceCache: Map<string, {
    price: BinancePrice;
    timestamp: number;
  }> = new Map();

  private pendingRequests: Map<string, Promise<BinancePrice | null>> = new Map();

  private readonly CACHE_TTL = 500;
  private readonly STALE_CACHE_TTL = 5000;

  private apiCallCount = 0;
  private cacheHitCount = 0;
  private errorCount = 0;
  private deduplicatedCount = 0;
  private lastCallTime = 0;
  private realtimeWriteCount = 0;

  private lastApiCallTime = 0;
  private readonly MIN_CALL_INTERVAL = 50;
  private isRateLimited = false;
  private rateLimitUntil = 0;

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
      timeout: 8000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'binary-trading-platform/1.0',
      },
    });

    setInterval(() => this.cleanupCache(), 5000);

    this.logger.log('Binance Service initialized with 500ms cache TTL');
  }

  async getCurrentPrice(asset: Asset, forceFresh = false): Promise<BinancePrice | null> {
    if (!asset.cryptoConfig) {
      this.logger.error(`Asset ${asset.symbol} missing cryptoConfig`);
      return null;
    }

    const { baseCurrency } = asset.cryptoConfig;
    let { quoteCurrency } = asset.cryptoConfig;

    if (quoteCurrency.toUpperCase() === 'USD') {
      quoteCurrency = 'USDT';
    }

    const binanceSymbol = this.getBinanceSymbol(baseCurrency);
    if (!binanceSymbol) {
      this.logger.error(`Unsupported coin: ${baseCurrency}`);
      return null;
    }

    const cacheKey = `${baseCurrency}/${quoteCurrency}`;

    if (!forceFresh) {
      const cached = this.getCachedPrice(cacheKey);
      if (cached) {
        this.cacheHitCount++;
        return cached;
      }
    }

    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      this.deduplicatedCount++;
      this.logger.debug(`Deduplicated request for ${cacheKey}`);
      return await pending;
    }

    const requestPromise = this.fetchPrice(cacheKey, binanceSymbol, asset);
    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  private async fetchPrice(
    cacheKey: string,
    binanceSymbol: string,
    asset: Asset
  ): Promise<BinancePrice | null> {
    if (this.isRateLimited) {
      const now = Date.now();
      if (now < this.rateLimitUntil) {
        const staleCache = this.getStaleCache(cacheKey);
        if (staleCache) {
          this.logger.warn(`Using stale cache for ${cacheKey} (rate limited)`);
          return staleCache;
        }
        return null;
      } else {
        this.isRateLimited = false;
        this.logger.log('Rate limit expired, resuming');
      }
    }

    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    if (timeSinceLastCall < this.MIN_CALL_INTERVAL) {
      const waitTime = this.MIN_CALL_INTERVAL - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    try {
      this.apiCallCount++;
      this.lastCallTime = Date.now();
      this.lastApiCallTime = Date.now();

      const response = await this.axios.get('/ticker/24hr', {
        params: { symbol: binanceSymbol },
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

      this.priceCache.set(cacheKey, {
        price,
        timestamp: Date.now(),
      });

      this.writePriceToRealtimeDb(asset, price).catch(error => {
        this.logger.error(`Realtime DB write failed: ${error.message}`);
      });

      if (this.apiCallCount % 60 === 0) {
        this.logger.log(
          `${cacheKey}: $${price.price} ` +
          `(${price.changePercent24h?.toFixed(2)}%) ` +
          `[API #${this.apiCallCount}, Rate: ${this.calculateAPIRate()}/min]`
        );
      }

      return price;

    } catch (error) {
      this.errorCount++;

      if (error.response?.status === 429) {
        this.isRateLimited = true;
        this.rateLimitUntil = Date.now() + 60000;

        this.logger.error(`Rate limit hit (429) for ${cacheKey}!`);
        this.logger.error(`Paused for 60 seconds`);
        this.logger.error(`Total API calls: ${this.apiCallCount}`);

        const staleCache = this.getStaleCache(cacheKey);
        if (staleCache) {
          return staleCache;
        }
      } else if (error.response) {
        this.logger.error(
          `API error for ${binanceSymbol}: ` +
          `${error.response.status} - ${error.response.statusText}`
        );
      } else {
        this.logger.error(`Error for ${cacheKey}: ${error.message}`);
      }

      return null;
    }
  }

  async getMultiplePrices(
    assets: Asset[],
    forceFresh = true
  ): Promise<Map<string, BinancePrice | null>> {
    const results = new Map<string, BinancePrice | null>();

    const promises = assets.map(async (asset) => {
      if (!asset.cryptoConfig) {
        return { assetId: asset.id, price: null };
      }

      try {
        const price = await this.getCurrentPrice(asset, forceFresh);
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

    return results;
  }

  private calculateAPIRate(): number {
    if (this.lastCallTime === 0) return 0;

    const uptimeSeconds = (Date.now() - this.lastCallTime) / 1000;
    if (uptimeSeconds < 1) return 0;

    return Math.round((this.apiCallCount / uptimeSeconds) * 60);
  }

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

    return { valid: true };
  }

  getAvailableSymbols(): string[] {
    return Object.keys(this.BINANCE_SYMBOL_MAP);
  }

  private getBinanceSymbol(baseCurrency: string): string | null {
    return this.BINANCE_SYMBOL_MAP[baseCurrency.toUpperCase()] || null;
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
      this.logger.error(`Realtime DB write failed: ${error.message}`);
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
    const normalizedQuote = quoteCurrency.toUpperCase() === 'USD'
      ? 'usdt'
      : quoteCurrency.toLowerCase();

    return `/crypto/${baseCurrency.toLowerCase()}_${normalizedQuote}`;
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

    const uptimeMs = this.lastCallTime > 0 ? Date.now() - this.lastCallTime : 0;
    const uptimeSeconds = uptimeMs / 1000;
    const estimatedCallsPerHour = uptimeSeconds > 0
      ? Math.round((this.apiCallCount / uptimeSeconds) * 3600)
      : 0;

    const currentRatePerMin = this.calculateAPIRate();

    return {
      mode: 'True 1-Second Mode (500ms cache)',
      apiCalls: this.apiCallCount,
      cacheHits: this.cacheHitCount,
      deduplicated: this.deduplicatedCount,
      cacheHitRate: `${cacheHitRate}%`,
      errors: this.errorCount,
      realtimeWrites: this.realtimeWriteCount,
      rateLimit: this.isRateLimited
        ? `Rate limited until ${new Date(this.rateLimitUntil).toLocaleTimeString()}`
        : 'OK',
      cacheTTL: '500ms',
      performance: {
        currentRatePerMin: `${currentRatePerMin} calls/min`,
        estimatedCallsPerHour: estimatedCallsPerHour,
        binanceLimit: '1200 calls/min',
        utilizationPercent: Math.round((currentRatePerMin / 1200) * 100),
        avgCacheAge: '~0.25s',
        updateFrequency: 'Every ~1s',
      },
      capacity: {
        currentAssets: this.priceCache.size,
        maxRecommended: 10,
        maxTheoretical: 15,
        warning: estimatedCallsPerHour > 60000
          ? 'High API usage - Consider reducing assets!'
          : 'Usage normal',
      },
      comparison: {
        vsOldCache: '2x more API calls (better realtime)',
        benefit: 'True 1-second updates',
        tradeoff: 'Higher API usage for better UX',
      }
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    this.pendingRequests.clear();
    this.logger.log('Cache cleared');
  }
}