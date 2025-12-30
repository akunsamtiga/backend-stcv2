// src/assets/assets.service.ts
// ✅ MULTI-ASSET SUPPORT - Setiap asset punya path & settings tersendiri

import { Injectable, NotFoundException, ConflictException, Logger, RequestTimeoutException, BadRequestException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { COLLECTIONS, ALL_DURATIONS } from '../common/constants';
import { Asset } from '../common/interfaces';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  
  private assetCache: Map<string, { asset: Asset; timestamp: number }> = new Map();
  private allAssetsCache: { assets: Asset[]; timestamp: number } | null = null;
  
  private readonly ASSET_CACHE_TTL = 60000;
  private readonly ALL_ASSETS_CACHE_TTL = 30000;

  // ✅ DEFAULT SETTINGS - Akan digunakan jika tidak ada custom settings
  private readonly DEFAULT_SIMULATOR_SETTINGS = {
  initialPrice: 40.022,
  dailyVolatilityMin: 0.001,
  dailyVolatilityMax: 0.005,
  secondVolatilityMin: 0.00001,
  secondVolatilityMax: 0.00008,
  minPrice: 20.011,  // ✅ Tambahkan ini (50% of initial)
  maxPrice: 80.044,  // ✅ Tambahkan ini (200% of initial)
};


  private readonly DEFAULT_TRADING_SETTINGS = {
    minOrderAmount: 1000,
    maxOrderAmount: 1000000,
    allowedDurations: [...ALL_DURATIONS] as number[],
  };

  constructor(
    private firebaseService: FirebaseService,
    private priceFetcherService: PriceFetcherService,
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
   * ✅ CREATE ASSET - Multi-asset dengan path validation
   */
  async createAsset(createAssetDto: CreateAssetDto, createdBy: string) {
    const db = this.firebaseService.getFirestore();

    // Check duplicate symbol
    const existingSnapshot = await db.collection(COLLECTIONS.ASSETS)
      .where('symbol', '==', createAssetDto.symbol)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      throw new ConflictException(`Asset with symbol ${createAssetDto.symbol} already exists`);
    }

    // ✅ VALIDATION: realtimeDbPath untuk realtime_db
    if (createAssetDto.dataSource === 'realtime_db') {
      if (!createAssetDto.realtimeDbPath) {
        throw new BadRequestException('realtimeDbPath is required for realtime_db data source');
      }

      // ✅ Path HARUS dimulai dengan /
      if (!createAssetDto.realtimeDbPath.startsWith('/')) {
        throw new BadRequestException(
          'realtimeDbPath must start with /. Example: "/idx_stc" or "/assets/eurusd"'
        );
      }

      // ✅ Path TIDAK boleh mengandung /current_price (akan ditambahkan otomatis)
      if (createAssetDto.realtimeDbPath.includes('/current_price')) {
        throw new BadRequestException(
          'realtimeDbPath should NOT include /current_price. ' +
          'Example: "/idx_stc" (not "/idx_stc/current_price"). ' +
          'The system will automatically append /current_price when fetching prices.'
        );
      }

      // ✅ Check jika path sudah digunakan asset lain
      const pathSnapshot = await db.collection(COLLECTIONS.ASSETS)
        .where('realtimeDbPath', '==', createAssetDto.realtimeDbPath)
        .limit(1)
        .get();

      if (!pathSnapshot.empty) {
        throw new ConflictException(
          `Path ${createAssetDto.realtimeDbPath} is already used by another asset`
        );
      }

      this.logger.log(`✅ Valid realtimeDbPath: ${createAssetDto.realtimeDbPath}`);
      this.logger.log(`   Price will be fetched from: ${createAssetDto.realtimeDbPath}/current_price`);
    }

    // ✅ VALIDATION: apiEndpoint untuk api
    if (createAssetDto.dataSource === 'api' && !createAssetDto.apiEndpoint) {
      throw new BadRequestException('apiEndpoint is required for api data source');
    }

    // ✅ SIMULATOR SETTINGS - Merge dengan default
    const simulatorSettings = createAssetDto.simulatorSettings 
      ? {
          ...this.DEFAULT_SIMULATOR_SETTINGS,
          ...createAssetDto.simulatorSettings,
          minPrice: createAssetDto.simulatorSettings.minPrice || 
                    (createAssetDto.simulatorSettings.initialPrice * 0.5),
          maxPrice: createAssetDto.simulatorSettings.maxPrice || 
                    (createAssetDto.simulatorSettings.initialPrice * 2.0),
        }
      : this.DEFAULT_SIMULATOR_SETTINGS;

    // Validate volatility
    if (simulatorSettings.dailyVolatilityMin > simulatorSettings.dailyVolatilityMax) {
      throw new BadRequestException('dailyVolatilityMin must be <= dailyVolatilityMax');
    }

    if (simulatorSettings.secondVolatilityMin > simulatorSettings.secondVolatilityMax) {
      throw new BadRequestException('secondVolatilityMin must be <= secondVolatilityMax');
    }

    // ✅ TRADING SETTINGS - Merge dengan default
    const tradingSettings = createAssetDto.tradingSettings 
      ? {
          ...this.DEFAULT_TRADING_SETTINGS,
          ...createAssetDto.tradingSettings,
        }
      : this.DEFAULT_TRADING_SETTINGS;

    if (tradingSettings.minOrderAmount > tradingSettings.maxOrderAmount) {
      throw new BadRequestException('minOrderAmount must be <= maxOrderAmount');
    }

    if (!tradingSettings.allowedDurations || tradingSettings.allowedDurations.length === 0) {
      throw new BadRequestException('allowedDurations must contain at least one duration');
    }

    // ✅ CREATE ASSET DATA
    const assetId = await this.firebaseService.generateId(COLLECTIONS.ASSETS);
    const timestamp = new Date().toISOString();

    const assetData: Asset = {
      id: assetId,
      name: createAssetDto.name,
      symbol: createAssetDto.symbol,
      profitRate: createAssetDto.profitRate,
      isActive: createAssetDto.isActive,
      dataSource: createAssetDto.dataSource as any,
      realtimeDbPath: createAssetDto.realtimeDbPath,
      apiEndpoint: createAssetDto.apiEndpoint,
      description: createAssetDto.description,
      simulatorSettings,
      tradingSettings,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await db.collection(COLLECTIONS.ASSETS).doc(assetId).set(assetData);

    // Clear cache
    this.invalidateCache();

    // ✅ LOG CREATION
    this.logger.log('');
    this.logger.log('🎉 ================================================');
    this.logger.log(`🎉 NEW ASSET CREATED: ${createAssetDto.symbol}`);
    this.logger.log('🎉 ================================================');
    this.logger.log(`   Name: ${createAssetDto.name}`);
    this.logger.log(`   Symbol: ${createAssetDto.symbol}`);
    this.logger.log(`   Data Source: ${createAssetDto.dataSource}`);
    
    if (createAssetDto.dataSource === 'realtime_db') {
      this.logger.log(`   Path: ${createAssetDto.realtimeDbPath}`);
      this.logger.log(`   Full Price Path: ${createAssetDto.realtimeDbPath}/current_price`);
    }
    
    this.logger.log(`   Profit Rate: ${createAssetDto.profitRate}%`);
    this.logger.log(`   Initial Price: ${simulatorSettings.initialPrice}`);
    this.logger.log(`   Volatility Range: ${simulatorSettings.secondVolatilityMin} - ${simulatorSettings.secondVolatilityMax}`);
    this.logger.log(`   Price Range: ${simulatorSettings.minPrice || 'auto'} - ${simulatorSettings.maxPrice || 'auto'}`);
    this.logger.log(`   Min Order: ${tradingSettings.minOrderAmount}`);
    this.logger.log(`   Max Order: ${tradingSettings.maxOrderAmount}`);
    this.logger.log(`   Durations: ${tradingSettings.allowedDurations.join(', ')} minutes`);
    this.logger.log('🎉 ================================================');
    this.logger.log('');
    this.logger.log('💡 NEXT STEPS:');
    this.logger.log('   1. Simulator will auto-detect this asset');
    this.logger.log('   2. Price generation will start automatically');
    this.logger.log('   3. No restart needed!');
    this.logger.log('');

    return {
      message: 'Asset created successfully',
      asset: assetData,
    };
  }

  /**
   * ✅ UPDATE ASSET - With path validation
   */
  async updateAsset(assetId: string, updateAssetDto: UpdateAssetDto) {
    const db = this.firebaseService.getFirestore();

    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    const currentAsset = assetDoc.data() as Asset;

    // Check duplicate symbol
    if (updateAssetDto.symbol && updateAssetDto.symbol !== currentAsset.symbol) {
      const existingSnapshot = await db.collection(COLLECTIONS.ASSETS)
        .where('symbol', '==', updateAssetDto.symbol)
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        throw new ConflictException(`Asset with symbol ${updateAssetDto.symbol} already exists`);
      }
    }

    // ✅ VALIDATION: realtimeDbPath
    if (updateAssetDto.dataSource === 'realtime_db') {
      const realtimeDbPath = updateAssetDto.realtimeDbPath || currentAsset.realtimeDbPath;
      
      if (!realtimeDbPath) {
        throw new BadRequestException('realtimeDbPath is required for realtime_db data source');
      }

      if (realtimeDbPath.includes('/current_price')) {
        throw new BadRequestException(
          'realtimeDbPath should NOT include /current_price. ' +
          'Example: "/idx_stc" (not "/idx_stc/current_price")'
        );
      }

      if (!realtimeDbPath.startsWith('/')) {
        throw new BadRequestException(
          'realtimeDbPath must start with /. Example: "/idx_stc"'
        );
      }

      // Check duplicate path (jika path berubah)
      if (updateAssetDto.realtimeDbPath && updateAssetDto.realtimeDbPath !== currentAsset.realtimeDbPath) {
        const pathSnapshot = await db.collection(COLLECTIONS.ASSETS)
          .where('realtimeDbPath', '==', updateAssetDto.realtimeDbPath)
          .limit(1)
          .get();

        if (!pathSnapshot.empty && pathSnapshot.docs[0].id !== assetId) {
          throw new ConflictException(
            `Path ${updateAssetDto.realtimeDbPath} is already used by another asset`
          );
        }
      }
    }

    // ✅ VALIDATION: apiEndpoint
    if (updateAssetDto.dataSource === 'api') {
      const apiEndpoint = updateAssetDto.apiEndpoint || currentAsset.apiEndpoint;
      if (!apiEndpoint) {
        throw new BadRequestException('apiEndpoint is required for api data source');
      }
    }

    // ✅ MERGE SIMULATOR SETTINGS
    let simulatorSettings = currentAsset.simulatorSettings || this.DEFAULT_SIMULATOR_SETTINGS;
    
    if (updateAssetDto.simulatorSettings) {
      simulatorSettings = {
        ...simulatorSettings,
        ...updateAssetDto.simulatorSettings,
      };

      if (simulatorSettings.dailyVolatilityMin > simulatorSettings.dailyVolatilityMax) {
        throw new BadRequestException('dailyVolatilityMin must be <= dailyVolatilityMax');
      }

      if (simulatorSettings.secondVolatilityMin > simulatorSettings.secondVolatilityMax) {
        throw new BadRequestException('secondVolatilityMin must be <= secondVolatilityMax');
      }
    }

    // ✅ MERGE TRADING SETTINGS
    let tradingSettings = currentAsset.tradingSettings || this.DEFAULT_TRADING_SETTINGS;
    
    if (updateAssetDto.tradingSettings) {
      tradingSettings = {
        ...tradingSettings,
        ...updateAssetDto.tradingSettings,
      };

      if (tradingSettings.minOrderAmount > tradingSettings.maxOrderAmount) {
        throw new BadRequestException('minOrderAmount must be <= maxOrderAmount');
      }

      if (!tradingSettings.allowedDurations || tradingSettings.allowedDurations.length === 0) {
        throw new BadRequestException('allowedDurations must contain at least one duration');
      }
    }

    const updateData = {
      ...updateAssetDto,
      simulatorSettings,
      tradingSettings,
      updatedAt: new Date().toISOString(),
    };

    await db.collection(COLLECTIONS.ASSETS).doc(assetId).update(updateData);

    this.invalidateCache();

    this.logger.log(`✅ Asset updated: ${currentAsset.symbol}`);
    if (updateAssetDto.simulatorSettings) {
      this.logger.log(`   Simulator settings changed`);
    }
    if (updateAssetDto.tradingSettings) {
      this.logger.log(`   Trading settings changed`);
    }

    return {
      message: 'Asset updated successfully',
    };
  }

  /**
   * DELETE ASSET
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
   * GET ALL ASSETS
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
      
      if (!data.simulatorSettings) {
        data.simulatorSettings = this.DEFAULT_SIMULATOR_SETTINGS;
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
    this.logger.debug(`⚡ Fetched ${assets.length} assets in ${duration}ms`);

    return {
      assets,
      total: assets.length,
    };
  }

  /**
   * GET ASSET BY ID
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

    if (!asset.simulatorSettings) {
      asset.simulatorSettings = this.DEFAULT_SIMULATOR_SETTINGS;
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
   * GET CURRENT PRICE
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
   * GET ASSET SETTINGS
   */
  async getAssetSettings(assetId: string): Promise<Asset> {
    return this.getAssetById(assetId);
  }

  /**
   * CACHE WARMUP
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
      
    } catch (error) {
      this.logger.error(`Cache warmup failed: ${error.message}`);
    }
  }

  /**
   * CACHE REFRESH
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
   * INVALIDATE CACHE
   */
  private invalidateCache(): void {
    this.assetCache.clear();
    this.allAssetsCache = null;
    this.logger.debug('Asset cache invalidated');
  }

  /**
   * BATCH GET ASSETS
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
   * GET ACTIVE ASSETS
   */
  async getActiveAssets(): Promise<Asset[]> {
    const { assets } = await this.getAllAssets(true);
    return assets;
  }

  /**
   * PERFORMANCE STATS
   */
  getPerformanceStats() {
    return {
      cachedAssets: this.assetCache.size,
      allAssetsCached: !!this.allAssetsCache,
      priceStats: this.priceFetcherService.getPerformanceStats(),
    };
  }
}