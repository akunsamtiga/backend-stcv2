// src/assets/assets.service.ts
// ✅ COMPLETE - Fixed class instance to plain object conversion for Firestore

import { Injectable, NotFoundException, ConflictException, Logger, RequestTimeoutException, BadRequestException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { CryptoCompareService } from './services/cryptocompare.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { COLLECTIONS, ALL_DURATIONS, ASSET_CATEGORY, ASSET_DATA_SOURCE } from '../common/constants';
import { Asset } from '../common/interfaces';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  
  private assetCache: Map<string, { asset: Asset; timestamp: number }> = new Map();
  private allAssetsCache: { assets: Asset[]; timestamp: number } | null = null;
  
  private readonly ASSET_CACHE_TTL = 60000;
  private readonly ALL_ASSETS_CACHE_TTL = 30000;

  private readonly DEFAULT_SIMULATOR_SETTINGS = {
    initialPrice: 40.022,
    dailyVolatilityMin: 0.001,
    dailyVolatilityMax: 0.005,
    secondVolatilityMin: 0.00001,
    secondVolatilityMax: 0.00008,
    minPrice: 20.011,
    maxPrice: 80.044,
  };

  private readonly DEFAULT_TRADING_SETTINGS = {
    minOrderAmount: 1000,
    maxOrderAmount: 1000000,
    allowedDurations: [
      0.0167,
      ...ALL_DURATIONS.filter(d => d >= 1)
    ] as number[],
  };

  constructor(
    private firebaseService: FirebaseService,
    private priceFetcherService: PriceFetcherService,
    private cryptoCompareService: CryptoCompareService,
  ) {
    setTimeout(async () => {
      try {
        await this.firebaseService.waitForFirestore(10000);
        await this.warmupCache();
      } catch (error) {
        this.logger.error(`Cache warmup delayed: ${error.message}`);
      }
    }, 3000);
    
    setInterval(() => this.refreshCache(), 60000);
  }

  /**
   * ✅ CRITICAL: Helper to convert DTO classes to plain objects
   * Firestore doesn't support objects with custom prototypes
   */
  private toPlainObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.toPlainObject(item));
    }
    
    // Handle dates
    if (obj instanceof Date) {
      return obj.toISOString();
    }
    
    // Handle objects (including class instances)
    if (typeof obj === 'object') {
      const plain: any = {};
      
      // Get all enumerable properties (including from class)
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const value = obj[key];
          
          // Skip undefined values
          if (value !== undefined) {
            plain[key] = this.toPlainObject(value);
          }
        }
      }
      
      return plain;
    }
    
    // Primitive values
    return obj;
  }

  /**
   * ✅ CREATE ASSET - FIXED with plain object conversion
   */
  async createAsset(createAssetDto: CreateAssetDto, createdBy: string) {
    try {
      this.logger.log('🔍 Starting asset creation...');
      this.logger.log(`Category: ${createAssetDto.category}`);
      this.logger.log(`DataSource: ${createAssetDto.dataSource}`);
      
      const db = this.firebaseService.getFirestore();

      // ✅ Check duplicate symbol
      const existingSnapshot = await db.collection(COLLECTIONS.ASSETS)
        .where('symbol', '==', createAssetDto.symbol)
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        throw new ConflictException(`Asset with symbol ${createAssetDto.symbol} already exists`);
      }

      // ✅ VALIDATION 1: Category validation
      if (!createAssetDto.category) {
        throw new BadRequestException('Category is required (normal or crypto)');
      }

      if (createAssetDto.category !== ASSET_CATEGORY.NORMAL && 
          createAssetDto.category !== ASSET_CATEGORY.CRYPTO) {
        throw new BadRequestException(
          `Invalid category: ${createAssetDto.category}. Must be 'normal' or 'crypto'`
        );
      }

      // ✅ VALIDATION 2: Category-specific validation
      if (createAssetDto.category === ASSET_CATEGORY.CRYPTO) {
        this.logger.log('🔍 Validating crypto asset...');
        await this.validateCryptoAsset(createAssetDto);
      } else {
        this.logger.log('🔍 Validating normal asset...');
        this.validateNormalAsset(createAssetDto);
      }

      const assetId = await this.firebaseService.generateId(COLLECTIONS.ASSETS);
      const timestamp = new Date().toISOString();

      let assetData: any;

      if (createAssetDto.category === ASSET_CATEGORY.CRYPTO) {
        // ===================================
        // 💎 CRYPTO ASSET
        // ===================================
        this.logger.log('💎 Creating crypto asset...');
        
        if (!createAssetDto.cryptoConfig) {
          throw new BadRequestException('cryptoConfig is required for crypto assets');
        }

        // ✅ CRITICAL: Convert DTOs to plain objects
        const plainCryptoConfig = this.toPlainObject(createAssetDto.cryptoConfig);
        const plainTradingSettings = this.toPlainObject(
          createAssetDto.tradingSettings || this.DEFAULT_TRADING_SETTINGS
        );

        assetData = {
          id: assetId,
          name: createAssetDto.name,
          symbol: createAssetDto.symbol,
          category: 'crypto',
          profitRate: createAssetDto.profitRate,
          isActive: createAssetDto.isActive,
          dataSource: 'cryptocompare',
          cryptoConfig: {
            baseCurrency: plainCryptoConfig.baseCurrency.toUpperCase(),
            quoteCurrency: plainCryptoConfig.quoteCurrency.toUpperCase(),
            exchange: plainCryptoConfig.exchange || undefined,
          },
          description: createAssetDto.description || '',
          tradingSettings: plainTradingSettings,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy,
        };

        this.logger.log('💎 Crypto asset data prepared:', {
          pair: `${assetData.cryptoConfig.baseCurrency}/${assetData.cryptoConfig.quoteCurrency}`,
          hasSimulatorSettings: !!assetData.simulatorSettings,
          hasRealtimeDbPath: !!assetData.realtimeDbPath,
        });

      } else {
        // ===================================
        // 📊 NORMAL ASSET
        // ===================================
        this.logger.log('📊 Creating normal asset...');
        
        // Validate data source requirements
        if (createAssetDto.dataSource === ASSET_DATA_SOURCE.REALTIME_DB) {
          if (!createAssetDto.realtimeDbPath) {
            throw new BadRequestException('realtimeDbPath is required for realtime_db data source');
          }
          if (!createAssetDto.realtimeDbPath.startsWith('/')) {
            throw new BadRequestException('realtimeDbPath must start with /');
          }
        }

        // ✅ CRITICAL: Convert DTOs to plain objects
        const baseSimulatorSettings = createAssetDto.simulatorSettings || this.DEFAULT_SIMULATOR_SETTINGS;
        const plainSimulatorSettings = this.toPlainObject({
          ...this.DEFAULT_SIMULATOR_SETTINGS,
          ...baseSimulatorSettings,
          minPrice: baseSimulatorSettings.minPrice || (baseSimulatorSettings.initialPrice * 0.5),
          maxPrice: baseSimulatorSettings.maxPrice || (baseSimulatorSettings.initialPrice * 2.0),
        });

        const plainTradingSettings = this.toPlainObject(
          createAssetDto.tradingSettings || this.DEFAULT_TRADING_SETTINGS
        );

        assetData = {
          id: assetId,
          name: createAssetDto.name,
          symbol: createAssetDto.symbol,
          category: 'normal',
          profitRate: createAssetDto.profitRate,
          isActive: createAssetDto.isActive,
          dataSource: createAssetDto.dataSource as any,
          realtimeDbPath: createAssetDto.realtimeDbPath,
          apiEndpoint: createAssetDto.apiEndpoint,
          description: createAssetDto.description || '',
          simulatorSettings: plainSimulatorSettings,
          tradingSettings: plainTradingSettings,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy,
        };

        this.logger.log('📊 Normal asset data prepared:', {
          dataSource: assetData.dataSource,
          hasCryptoConfig: !!assetData.cryptoConfig,
          hasSimulatorSettings: !!assetData.simulatorSettings,
        });
      }

      // ✅ CRITICAL: Final conversion to ensure no class instances
      const plainAssetData = this.toPlainObject(assetData);

      // ✅ Save to Firestore
      this.logger.log(`💾 Saving asset to Firestore...`);
      await db.collection(COLLECTIONS.ASSETS).doc(assetId).set(plainAssetData);

      this.invalidateCache();

      // ✅ LOG CREATION
      this.logger.log('');
      this.logger.log('🎉 ================================================');
      this.logger.log(`🎉 NEW ${createAssetDto.category.toUpperCase()} ASSET: ${createAssetDto.symbol}`);
      this.logger.log('🎉 ================================================');
      this.logger.log(`   Name: ${createAssetDto.name}`);
      this.logger.log(`   Category: ${createAssetDto.category.toUpperCase()}`);
      this.logger.log(`   Data Source: ${createAssetDto.dataSource}`);
      
      if (createAssetDto.category === ASSET_CATEGORY.CRYPTO) {
        this.logger.log(`   💎 Base: ${createAssetDto.cryptoConfig?.baseCurrency}`);
        this.logger.log(`   💎 Quote: ${createAssetDto.cryptoConfig?.quoteCurrency}`);
        this.logger.log(`   💎 Source: CryptoCompare API`);
        this.logger.log(`   ⚡ Simulator: NOT USED (real-time API)`);
      } else {
        if (createAssetDto.dataSource === ASSET_DATA_SOURCE.REALTIME_DB) {
          this.logger.log(`   📍 Path: ${createAssetDto.realtimeDbPath}`);
          this.logger.log(`   ⚡ Simulator: WILL BE SIMULATED`);
        }
        this.logger.log(`   💰 Initial Price: ${plainAssetData.simulatorSettings?.initialPrice}`);
      }
      
      this.logger.log(`   📈 Profit Rate: ${createAssetDto.profitRate}%`);
      this.logger.log('🎉 ================================================');
      this.logger.log('');

      return {
        message: `${createAssetDto.category} asset created successfully`,
        asset: plainAssetData,
        simulatorNote: createAssetDto.category === 'crypto' 
          ? '💎 This crypto asset will use real-time CryptoCompare API (not simulated)'
          : '📊 This normal asset will be simulated by the trading-simulator service',
      };

    } catch (error) {
      this.logger.error('❌ Asset creation error:', error.message);
      this.logger.error(error.stack);
      
      if (error instanceof BadRequestException || 
          error instanceof ConflictException) {
        throw error;
      }
      
      throw new BadRequestException(
        `Failed to create asset: ${error.message}`
      );
    }
  }

  /**
   * ✅ VALIDATE CRYPTO ASSET
   */
  private async validateCryptoAsset(dto: CreateAssetDto): Promise<void> {
    this.logger.log('🔍 Validating crypto asset configuration...');

    // Check data source
    if (dto.dataSource !== ASSET_DATA_SOURCE.CRYPTOCOMPARE) {
      throw new BadRequestException(
        'Crypto assets must use "cryptocompare" as data source'
      );
    }

    // Check cryptoConfig exists
    if (!dto.cryptoConfig) {
      throw new BadRequestException(
        'cryptoConfig is required for crypto assets'
      );
    }

    const { baseCurrency, quoteCurrency } = dto.cryptoConfig;

    // Validate currencies
    if (!baseCurrency || baseCurrency.trim().length < 2) {
      throw new BadRequestException(
        'baseCurrency is required and must be at least 2 characters (e.g., BTC, ETH)'
      );
    }

    if (!quoteCurrency || quoteCurrency.trim().length < 2) {
      throw new BadRequestException(
        'quoteCurrency is required and must be at least 2 characters (e.g., USD, USDT)'
      );
    }

    // ✅ IMPORTANT: Check that crypto assets don't have normal asset fields
    if (dto.simulatorSettings) {
      throw new BadRequestException(
        'Crypto assets should NOT have simulatorSettings (they use real-time API)'
      );
    }

    if (dto.realtimeDbPath) {
      throw new BadRequestException(
        'Crypto assets should NOT have realtimeDbPath (they use CryptoCompare API)'
      );
    }

    if (dto.apiEndpoint) {
      throw new BadRequestException(
        'Crypto assets should NOT have apiEndpoint (they use CryptoCompare API)'
      );
    }

    this.logger.log(`✅ Crypto validation passed: ${baseCurrency}/${quoteCurrency}`);

    // ✅ Optional: Test price fetch (can be disabled if causing timeout)
    try {
      this.logger.log(`🔍 Testing price fetch for ${baseCurrency}/${quoteCurrency}...`);
      
      const testAsset: Asset = {
        id: 'test',
        name: dto.name,
        symbol: dto.symbol,
        category: 'crypto',
        profitRate: dto.profitRate,
        isActive: true,
        dataSource: 'cryptocompare',
        cryptoConfig: {
          baseCurrency: baseCurrency.toUpperCase(),
          quoteCurrency: quoteCurrency.toUpperCase(),
          exchange: dto.cryptoConfig.exchange,
        },
        createdAt: new Date().toISOString(),
      };

      // Short timeout for validation
      const pricePromise = this.cryptoCompareService.getCurrentPrice(testAsset);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Validation timeout')), 5000)
      );

      const price = await Promise.race([pricePromise, timeoutPromise]);
      
      if (!price) {
        this.logger.warn(
          `⚠️ Could not fetch price for ${baseCurrency}/${quoteCurrency}, but continuing with creation`
        );
      } else {
        this.logger.log(
          `✅ Price validation successful: ${baseCurrency}/${quoteCurrency} = $${price.price}`
        );
      }

    } catch (error) {
      this.logger.warn(
        `⚠️ Price validation failed for ${baseCurrency}/${quoteCurrency}: ${error.message}`
      );
      // Don't throw error, just warn - asset creation can continue
      this.logger.warn('⚠️ Continuing with asset creation anyway...');
    }
  }

  /**
   * ✅ VALIDATE NORMAL ASSET
   */
  private validateNormalAsset(dto: CreateAssetDto): void {
    // Must NOT have cryptocompare as data source
    if (dto.dataSource === ASSET_DATA_SOURCE.CRYPTOCOMPARE) {
      throw new BadRequestException(
        'Normal assets cannot use "cryptocompare" data source'
      );
    }

    // Must NOT have cryptoConfig
    if (dto.cryptoConfig) {
      throw new BadRequestException(
        'Normal assets should not have cryptoConfig (only for crypto category)'
      );
    }

    // Validate dataSource-specific requirements
    if (dto.dataSource === ASSET_DATA_SOURCE.REALTIME_DB) {
      if (!dto.realtimeDbPath) {
        throw new BadRequestException(
          'realtimeDbPath is required for realtime_db data source'
        );
      }

      if (!dto.realtimeDbPath.startsWith('/')) {
        throw new BadRequestException(
          'realtimeDbPath must start with /'
        );
      }

      if (dto.realtimeDbPath.includes('/current_price')) {
        throw new BadRequestException(
          'realtimeDbPath should NOT include /current_price (added automatically)'
        );
      }
    }

    if (dto.dataSource === ASSET_DATA_SOURCE.API && !dto.apiEndpoint) {
      throw new BadRequestException(
        'apiEndpoint is required for api data source'
      );
    }

    // Validate simulator settings if provided
    if (dto.simulatorSettings) {
      const s = dto.simulatorSettings;
      
      if (s.dailyVolatilityMin > s.dailyVolatilityMax) {
        throw new BadRequestException(
          'dailyVolatilityMin must be <= dailyVolatilityMax'
        );
      }

      if (s.secondVolatilityMin > s.secondVolatilityMax) {
        throw new BadRequestException(
          'secondVolatilityMin must be <= secondVolatilityMax'
        );
      }

      if (s.minPrice && s.maxPrice && s.minPrice >= s.maxPrice) {
        throw new BadRequestException(
          'minPrice must be < maxPrice'
        );
      }
    }

    // Validate trading settings
    if (dto.tradingSettings) {
      const t = dto.tradingSettings;
      
      if (t.minOrderAmount > t.maxOrderAmount) {
        throw new BadRequestException(
          'minOrderAmount must be <= maxOrderAmount'
        );
      }

      if (!t.allowedDurations || t.allowedDurations.length === 0) {
        throw new BadRequestException(
          'allowedDurations must contain at least one duration'
        );
      }
    }
  }

  /**
   * ✅ UPDATE ASSET - FIXED with plain object conversion
   */
  async updateAsset(assetId: string, updateAssetDto: UpdateAssetDto) {
    const db = this.firebaseService.getFirestore();

    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    const currentAsset = assetDoc.data() as Asset;

    // ✅ Convert DTO to plain object
    const plainUpdateData = this.toPlainObject({
      ...updateAssetDto,
      updatedAt: new Date().toISOString(),
    });

    await db.collection(COLLECTIONS.ASSETS).doc(assetId).update(plainUpdateData);

    this.invalidateCache();

    this.logger.log(`✅ Asset updated: ${currentAsset.symbol}`);

    return {
      message: 'Asset updated successfully',
    };
  }

  /**
   * ✅ DELETE ASSET
   */
  async deleteAsset(assetId: string) {
    const db = this.firebaseService.getFirestore();

    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    const asset = assetDoc.data() as Asset;

    await db.collection(COLLECTIONS.ASSETS).doc(assetId).delete();

    this.invalidateCache();

    this.logger.log(`🗑️ Asset deleted: ${asset.symbol}`);

    return {
      message: 'Asset deleted successfully',
    };
  }

  /**
   * ✅ GET ALL ASSETS
   */
  async getAllAssets(activeOnly: boolean = false) {
    const startTime = Date.now();
    
    if (this.allAssetsCache && !activeOnly) {
      const age = Date.now() - this.allAssetsCache.timestamp;
      
      if (age < this.ALL_ASSETS_CACHE_TTL) {
        const duration = Date.now() - startTime;
        this.logger.debug(`⚡ All assets from cache (${duration}ms)`);
        
        return {
          assets: this.allAssetsCache.assets,
          total: this.allAssetsCache.assets.length,
        };
      }
    }

    const db = this.firebaseService.getFirestore();
    let query = db.collection(COLLECTIONS.ASSETS);
    
    if (activeOnly) {
      query = query.where('isActive', '==', true) as any;
    }

    const snapshot = await query.get();
    const assets = snapshot.docs.map(doc => {
      const data = doc.data() as Asset;
      
      // Apply defaults only for normal assets
      if (data.category !== ASSET_CATEGORY.CRYPTO) {
        if (!data.simulatorSettings) {
          data.simulatorSettings = this.DEFAULT_SIMULATOR_SETTINGS;
        }
      }
      
      if (!data.tradingSettings) {
        data.tradingSettings = this.DEFAULT_TRADING_SETTINGS;
      }
      
      return data;
    });

    if (!activeOnly) {
      this.allAssetsCache = {
        assets,
        timestamp: Date.now(),
      };
    }

    for (const asset of assets) {
      this.assetCache.set(asset.id, {
        asset,
        timestamp: Date.now(),
      });
    }

    const duration = Date.now() - startTime;
    
    const normalAssets = assets.filter(a => a.category === ASSET_CATEGORY.NORMAL);
    const cryptoAssets = assets.filter(a => a.category === ASSET_CATEGORY.CRYPTO);
    
    this.logger.debug(
      `⚡ Fetched ${assets.length} assets in ${duration}ms ` +
      `(Normal: ${normalAssets.length}, Crypto: ${cryptoAssets.length})`
    );

    return {
      assets,
      total: assets.length,
      byCategory: {
        normal: normalAssets.length,
        crypto: cryptoAssets.length,
      },
    };
  }

  /**
   * ✅ GET ASSET BY ID
   */
  async getAssetById(assetId: string): Promise<Asset> {
    const startTime = Date.now();
    
    const cached = this.assetCache.get(assetId);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      
      if (age < this.ASSET_CACHE_TTL) {
        const duration = Date.now() - startTime;
        this.logger.debug(`⚡ Asset ${assetId} from cache (${duration}ms)`);
        return cached.asset;
      }
    }

    const db = this.firebaseService.getFirestore();
    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    let asset = assetDoc.data() as Asset;

    // Apply defaults only for normal assets
    if (asset.category !== ASSET_CATEGORY.CRYPTO) {
      if (!asset.simulatorSettings) {
        asset.simulatorSettings = this.DEFAULT_SIMULATOR_SETTINGS;
      }
    }
    
    if (!asset.tradingSettings) {
      asset.tradingSettings = this.DEFAULT_TRADING_SETTINGS;
    }

    this.assetCache.set(assetId, {
      asset,
      timestamp: Date.now(),
    });

    const duration = Date.now() - startTime;
    this.logger.debug(`⚡ Fetched asset ${assetId} in ${duration}ms`);

    return asset;
  }

  /**
   * ✅ GET CURRENT PRICE
   */
  async getCurrentPrice(assetId: string) {
    const startTime = Date.now();
    
    try {
      const asset = await this.getAssetById(assetId);

      const priceData = await Promise.race([
        this.priceFetcherService.getCurrentPrice(asset, true),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Price timeout')), 2000)
        ),
      ]);

      if (!priceData) {
        throw new NotFoundException(`Price unavailable for ${asset.symbol}`);
      }

      const duration = Date.now() - startTime;
      this.logger.debug(`⚡ Got price for ${asset.symbol} in ${duration}ms`);

      return {
        asset: {
          id: asset.id,
          name: asset.name,
          symbol: asset.symbol,
          category: asset.category,
        },
        price: priceData.price,
        timestamp: priceData.timestamp,
        datetime: priceData.datetime,
        responseTime: duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Price fetch failed after ${duration}ms: ${error.message}`);
      
      if (error.message.includes('timeout')) {
        throw new RequestTimeoutException('Price service timeout');
      }
      
      throw error;
    }
  }

  /**
   * ✅ GET ASSET SETTINGS
   */
  async getAssetSettings(assetId: string): Promise<Asset> {
    return this.getAssetById(assetId);
  }

  /**
   * ✅ WARMUP CACHE
   */
  private async warmupCache(): Promise<void> {
    try {
      if (!this.firebaseService.isFirestoreReady()) {
        this.logger.warn('⚠️ Firestore not ready, skipping cache warmup');
        return;
      }

      this.logger.log('⚡ Warming up asset cache...');
      
      const { assets } = await this.getAllAssets(false);
      
      this.logger.log(`✅ Cache warmed: ${assets.length} assets`);
      
      const activeAssets = assets.filter(a => a.isActive);
      if (activeAssets.length > 0) {
        await this.priceFetcherService.prefetchPrices(activeAssets);
      }
      
      const cryptoAssets = assets.filter(a => a.category === ASSET_CATEGORY.CRYPTO);
      
      if (cryptoAssets.length > 0) {
        this.logger.log(`💎 ${cryptoAssets.length} crypto assets ready`);
      }
      
    } catch (error) {
      this.logger.error(`Cache warmup failed: ${error.message}`);
    }
  }

  /**
   * ✅ REFRESH CACHE
   */
  private async refreshCache(): Promise<void> {
    try {
      await this.getAllAssets(false);
      
      const activeAssets = this.allAssetsCache?.assets.filter(a => a.isActive) || [];
      if (activeAssets.length > 0) {
        await this.priceFetcherService.prefetchPrices(activeAssets);
      }
      
      this.logger.debug('⚡ Cache refreshed');
    } catch (error) {
      this.logger.error(`Cache refresh failed: ${error.message}`);
    }
  }

  /**
   * ✅ INVALIDATE CACHE
   */
  private invalidateCache(): void {
    this.assetCache.clear();
    this.allAssetsCache = null;
    this.logger.debug('Asset cache invalidated');
  }

  /**
   * ✅ BATCH GET ASSETS
   */
  async batchGetAssets(assetIds: string[]): Promise<Map<string, Asset>> {
    const results = new Map<string, Asset>();
    
    const uncachedIds: string[] = [];
    
    for (const assetId of assetIds) {
      const cached = this.assetCache.get(assetId);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < this.ASSET_CACHE_TTL) {
          results.set(assetId, cached.asset);
          continue;
        }
      }
      uncachedIds.push(assetId);
    }

    if (uncachedIds.length > 0) {
      const promises = uncachedIds.map(id => 
        this.getAssetById(id).catch(() => null)
      );
      
      const assets = await Promise.all(promises);
      
      assets.forEach((asset, index) => {
        if (asset) {
          results.set(uncachedIds[index], asset);
        }
      });
    }

    return results;
  }

  /**
   * ✅ GET ACTIVE ASSETS
   */
  async getActiveAssets(): Promise<Asset[]> {
    const { assets } = await this.getAllAssets(true);
    return assets;
  }

  /**
   * ✅ GET PERFORMANCE STATS
   */
  getPerformanceStats() {
    const normalAssets = Array.from(this.assetCache.values())
      .filter(c => c.asset.category === ASSET_CATEGORY.NORMAL);
    
    const cryptoAssets = Array.from(this.assetCache.values())
      .filter(c => c.asset.category === ASSET_CATEGORY.CRYPTO);

    return {
      cachedAssets: this.assetCache.size,
      normalAssets: normalAssets.length,
      cryptoAssets: cryptoAssets.length,
      allAssetsCached: !!this.allAssetsCache,
      priceStats: this.priceFetcherService.getPerformanceStats(),
    };
  }
}