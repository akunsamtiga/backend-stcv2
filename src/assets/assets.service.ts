import { Injectable, NotFoundException, ConflictException, Logger, RequestTimeoutException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { COLLECTIONS } from '../common/constants';
import { Asset } from '../common/interfaces';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  
  // ⚡ Asset cache for ultra-fast access
  private assetCache: Map<string, { asset: Asset; timestamp: number }> = new Map();
  private allAssetsCache: { assets: Asset[]; timestamp: number } | null = null;
  
  private readonly ASSET_CACHE_TTL = 60000; // 60 seconds (assets don't change often)
  private readonly ALL_ASSETS_CACHE_TTL = 30000; // 30 seconds

  constructor(
    private firebaseService: FirebaseService,
    private priceFetcherService: PriceFetcherService,
  ) {
    // ⚡ Warmup cache on startup - WAIT FOR FIRESTORE
    setTimeout(async () => {
      try {
        await this.firebaseService.waitForFirestore(10000);
        await this.warmupCache();
      } catch (error) {
        this.logger.error(`Cache warmup delayed: ${error.message}`);
      }
    }, 3000); // Wait 3 seconds for Firebase to fully initialize
    
    // ⚡ Periodic cache refresh
    setInterval(() => this.refreshCache(), 60000); // Every minute
  }

  /**
   * CREATE ASSET
   */
  async createAsset(createAssetDto: CreateAssetDto, createdBy: string) {
    const db = this.firebaseService.getFirestore();

    const existingSnapshot = await db.collection(COLLECTIONS.ASSETS)
      .where('symbol', '==', createAssetDto.symbol)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      throw new ConflictException(`Asset ${createAssetDto.symbol} already exists`);
    }

    const assetId = await this.firebaseService.generateId(COLLECTIONS.ASSETS);
    const timestamp = new Date().toISOString();

    const assetData = {
      id: assetId,
      ...createAssetDto,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await db.collection(COLLECTIONS.ASSETS).doc(assetId).set(assetData);

    // Invalidate cache
    this.invalidateCache();

    this.logger.log(`Asset created: ${createAssetDto.symbol}`);

    return {
      message: 'Asset created',
      asset: assetData,
    };
  }

  /**
   * UPDATE ASSET
   */
  async updateAsset(assetId: string, updateAssetDto: UpdateAssetDto) {
    const db = this.firebaseService.getFirestore();

    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    await this.firebaseService.updateWithTimestamp(COLLECTIONS.ASSETS, assetId, updateAssetDto);

    // Invalidate cache
    this.invalidateCache();

    this.logger.log(`Asset updated: ${assetId}`);

    return {
      message: 'Asset updated',
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

    await db.collection(COLLECTIONS.ASSETS).doc(assetId).delete();

    // Invalidate cache
    this.invalidateCache();

    this.logger.log(`Asset deleted: ${assetId}`);

    return {
      message: 'Asset deleted',
    };
  }

  /**
   * ⚡ GET ALL ASSETS (CACHED)
   * Target: < 50ms with cache
   */
  async getAllAssets(activeOnly: boolean = false) {
    const startTime = Date.now();
    
    // ✅ Try cache first
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

    // ✅ Fetch from database
    const db = this.firebaseService.getFirestore();
    let query = db.collection(COLLECTIONS.ASSETS);
    
    if (activeOnly) {
      query = query.where('isActive', '==', true) as any;
    }

    const snapshot = await query.get();
    const assets = snapshot.docs.map(doc => doc.data() as Asset);

    // ✅ Update cache
    if (!activeOnly) {
      this.allAssetsCache = {
        assets,
        timestamp: Date.now(),
      };
    }

    // ✅ Update individual asset cache
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
   * ⚡ GET ASSET BY ID (ULTRA-FAST)
   * Target: < 20ms with cache
   */
  async getAssetById(assetId: string): Promise<Asset> {
    const startTime = Date.now();
    
    // ✅ Try cache first
    const cached = this.assetCache.get(assetId);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      
      if (age < this.ASSET_CACHE_TTL) {
        const duration = Date.now() - startTime;
        this.logger.debug(`⚡ Asset ${assetId} from cache (${duration}ms)`);
        return cached.asset;
      }
    }

    // ✅ Fetch from database
    const db = this.firebaseService.getFirestore();
    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    const asset = assetDoc.data() as Asset;

    // ✅ Update cache
    this.assetCache.set(assetId, {
      asset,
      timestamp: Date.now(),
    });

    const duration = Date.now() - startTime;
    this.logger.debug(`⚡ Fetched asset ${assetId} in ${duration}ms`);

    return asset;
  }

  /**
   * ⚡ GET CURRENT PRICE (ULTRA-FAST)
   * Target: < 200ms total
   */
  async getCurrentPrice(assetId: string) {
    const startTime = Date.now();
    
    try {
      // ✅ Step 1: Get asset from cache (< 20ms)
      const asset = await this.getAssetById(assetId);

      // ✅ Step 2: Get price with fast cache (< 100ms)
      const priceData = await Promise.race([
        this.priceFetcherService.getCurrentPrice(asset, true), // Use fast cache
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Price timeout')), 2000) // 2s max
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
   * ⚡ WARMUP CACHE (on startup)
   */
  private async warmupCache(): Promise<void> {
    try {
      // ✅ Check if Firestore is ready
      if (!this.firebaseService.isFirestoreReady()) {
        this.logger.warn('⚠️ Firestore not ready, skipping cache warmup');
        return;
      }

      this.logger.log('⚡ Warming up asset cache...');
      
      const { assets } = await this.getAllAssets(false);
      
      this.logger.log(`✅ Cache warmed: ${assets.length} assets`);
      
      // Also prefetch prices for active assets
      const activeAssets = assets.filter(a => a.isActive);
      if (activeAssets.length > 0) {
        await this.priceFetcherService.prefetchPrices(activeAssets);
      }
      
    } catch (error) {
      this.logger.error(`Cache warmup failed: ${error.message}`);
    }
  }

  /**
   * ⚡ REFRESH CACHE (periodic)
   */
  private async refreshCache(): Promise<void> {
    try {
      // Refresh all assets cache
      await this.getAllAssets(false);
      
      // Refresh prices for active assets
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
   * ⚡ BATCH GET ASSETS
   */
  async batchGetAssets(assetIds: string[]): Promise<Map<string, Asset>> {
    const results = new Map<string, Asset>();
    
    // Try cache first
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

    // Fetch uncached in parallel
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
   * ⚡ GET ACTIVE ASSETS (Cached)
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