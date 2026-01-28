import { Injectable, NotFoundException, ConflictException, Logger, RequestTimeoutException, BadRequestException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { BinanceService } from './services/binance.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { COLLECTIONS, ALL_DURATIONS, ASSET_CATEGORY, ASSET_DATA_SOURCE } from '../common/constants';
import { CalculationUtil, TimezoneUtil } from '../common/utils';
import { Asset } from '../common/interfaces';
import { InitializeAssetCandlesHelper } from './helpers/initialize-asset-candles.helper';

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
    private binanceService: BinanceService,
    private readonly eventEmitter: EventEmitter2,
    private initializeCandlesHelper: InitializeAssetCandlesHelper,
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

  private toPlainObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.toPlainObject(item));
    }
    
    if (obj instanceof Date) {
      return obj.toISOString();
    }
    
    if (typeof obj === 'object') {
      const plain: any = {};
      
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const value = obj[key];
          
          if (value !== undefined) {
            plain[key] = this.toPlainObject(value);
          }
        }
      }
      
      return plain;
    }
    
    return obj;
  }

  private preserveHighPrecision(value: number | undefined, defaultValue?: number): number | undefined {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    return value;
  }

  private validateSimulatorSettingsHighPrecision(settings: any): void {
    if (!settings) return;
    
    if (settings.dailyVolatilityMin > settings.dailyVolatilityMax) {
      throw new BadRequestException(
        'dailyVolatilityMin must be <= dailyVolatilityMax'
      );
    }
    
    if (settings.secondVolatilityMin > settings.secondVolatilityMax) {
      throw new BadRequestException(
        'secondVolatilityMin must be <= secondVolatilityMax'
      );
    }
    
    if (settings.minPrice !== undefined && settings.maxPrice !== undefined) {
      if (settings.minPrice >= settings.maxPrice) {
        throw new BadRequestException(
          `minPrice (${settings.minPrice}) must be < maxPrice (${settings.maxPrice})`
        );
      }
      
      const priceRange = settings.maxPrice - settings.minPrice;
      
      if (priceRange < 0.0000001) {
        throw new BadRequestException(
          `Price range too small: ${priceRange.toExponential()}. Minimum range is 0.0000001`
        );
      }
      
      if (settings.initialPrice < settings.minPrice || settings.initialPrice > settings.maxPrice) {
        throw new BadRequestException(
          `initialPrice (${settings.initialPrice}) must be between minPrice (${settings.minPrice}) and maxPrice (${settings.maxPrice})`
        );
      }
    }
    
    if (settings.minPrice !== undefined && settings.maxPrice !== undefined && settings.secondVolatilityMax !== undefined) {
      const priceRange = settings.maxPrice - settings.minPrice;
      const maxPriceChange = settings.initialPrice * settings.secondVolatilityMax;
      
      if (maxPriceChange > priceRange) {
        this.logger.warn(
          `⚠️ High volatility: Max price change per second (${maxPriceChange.toExponential()}) ` +
          `exceeds price range (${priceRange.toExponential()}). ` +
          `Price may hit boundaries frequently.`
        );
      }
    }
  }

  async createAsset(createAssetDto: CreateAssetDto, createdBy: string) {
    try {
      this.logger.log('🔧 Starting asset creation...');
      this.logger.log(`Category: ${createAssetDto.category}`);
      this.logger.log(`Type: ${createAssetDto.type}`);
      this.logger.log(`DataSource: ${createAssetDto.dataSource}`);
      
      const db = this.firebaseService.getFirestore();

      const existingSnapshot = await db.collection(COLLECTIONS.ASSETS)
        .where('symbol', '==', createAssetDto.symbol)
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        throw new ConflictException(`Asset with symbol ${createAssetDto.symbol} already exists`);
      }

      if (createAssetDto.icon) {
        const isBase64 = createAssetDto.icon.startsWith('data:image/');
        const isURL = createAssetDto.icon.startsWith('http://') || 
                      createAssetDto.icon.startsWith('https://');
        
        if (!isBase64 && !isURL) {
          throw new BadRequestException(
            'Icon must be a valid URL or base64 encoded image'
          );
        }
        
        if (isBase64 && createAssetDto.icon.length > 2800000) {
          throw new BadRequestException(
            'Icon file too large. Maximum size is 2MB'
          );
        }
        
        if (isBase64) {
          const validFormats = ['data:image/png', 'data:image/jpeg', 'data:image/jpg', 'data:image/svg+xml'];
          const hasValidFormat = validFormats.some(format => 
            createAssetDto.icon!.startsWith(format)
          );
          
          if (!hasValidFormat) {
            throw new BadRequestException(
              'Icon must be PNG, JPEG, JPG, or SVG format'
            );
          }
        }
      }

      if (!createAssetDto.type) {
        throw new BadRequestException('Asset type is required');
      }

      const validTypes = ['forex', 'stock', 'commodity', 'crypto', 'index'];
      if (!validTypes.includes(createAssetDto.type)) {
        throw new BadRequestException(
          `Invalid asset type: ${createAssetDto.type}. Must be one of: ${validTypes.join(', ')}`
        );
      }

      if (createAssetDto.type === 'crypto' && createAssetDto.category !== ASSET_CATEGORY.CRYPTO) {
        throw new BadRequestException(
          'Asset type "crypto" must have category "crypto"'
        );
      }

      if (createAssetDto.type !== 'crypto' && createAssetDto.category === ASSET_CATEGORY.CRYPTO) {
        throw new BadRequestException(
          `Category "crypto" requires type "crypto", but got type "${createAssetDto.type}"`
        );
      }

      if (!createAssetDto.category) {
        throw new BadRequestException('Category is required (normal or crypto)');
      }

      if (createAssetDto.category !== ASSET_CATEGORY.NORMAL && 
          createAssetDto.category !== ASSET_CATEGORY.CRYPTO) {
        throw new BadRequestException(
          `Invalid category: ${createAssetDto.category}. Must be 'normal' or 'crypto'`
        );
      }

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
        this.logger.log('💎 Creating crypto asset...');
        
        if (!createAssetDto.cryptoConfig) {
          throw new BadRequestException('cryptoConfig is required for crypto assets');
        }

        const plainCryptoConfig = this.toPlainObject(createAssetDto.cryptoConfig);
        const plainTradingSettings = this.toPlainObject(
          createAssetDto.tradingSettings || this.DEFAULT_TRADING_SETTINGS
        );

        const realtimeDbPath = createAssetDto.realtimeDbPath || 
          `/crypto/${plainCryptoConfig.baseCurrency.toLowerCase()}_${plainCryptoConfig.quoteCurrency.toLowerCase()}`;

        assetData = {
          id: assetId,
          name: createAssetDto.name,
          symbol: createAssetDto.symbol,
          icon: createAssetDto.icon || this.getDefaultCryptoIcon(plainCryptoConfig.baseCurrency),
          type: createAssetDto.type,
          category: 'crypto',
          profitRate: createAssetDto.profitRate,
          isActive: createAssetDto.isActive,
          dataSource: 'binance',
          realtimeDbPath: realtimeDbPath,
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
          path: realtimeDbPath,
        });

      } else {
        this.logger.log('📊 Creating normal asset...');
        
        if (createAssetDto.dataSource === ASSET_DATA_SOURCE.REALTIME_DB) {
          if (!createAssetDto.realtimeDbPath) {
            throw new BadRequestException('realtimeDbPath is required for realtime_db data source');
          }
          if (!createAssetDto.realtimeDbPath.startsWith('/')) {
            throw new BadRequestException('realtimeDbPath must start with /');
          }
        }

        const baseSimulatorSettings = createAssetDto.simulatorSettings || this.DEFAULT_SIMULATOR_SETTINGS;
        
        const plainSimulatorSettings = this.toPlainObject({
          initialPrice: this.preserveHighPrecision(baseSimulatorSettings.initialPrice, this.DEFAULT_SIMULATOR_SETTINGS.initialPrice),
          dailyVolatilityMin: this.preserveHighPrecision(baseSimulatorSettings.dailyVolatilityMin, this.DEFAULT_SIMULATOR_SETTINGS.dailyVolatilityMin),
          dailyVolatilityMax: this.preserveHighPrecision(baseSimulatorSettings.dailyVolatilityMax, this.DEFAULT_SIMULATOR_SETTINGS.dailyVolatilityMax),
          secondVolatilityMin: this.preserveHighPrecision(baseSimulatorSettings.secondVolatilityMin, this.DEFAULT_SIMULATOR_SETTINGS.secondVolatilityMin),
          secondVolatilityMax: this.preserveHighPrecision(baseSimulatorSettings.secondVolatilityMax, this.DEFAULT_SIMULATOR_SETTINGS.secondVolatilityMax),
          minPrice: baseSimulatorSettings.minPrice !== undefined 
            ? this.preserveHighPrecision(baseSimulatorSettings.minPrice) 
            : baseSimulatorSettings.initialPrice * 0.5,
          maxPrice: baseSimulatorSettings.maxPrice !== undefined 
            ? this.preserveHighPrecision(baseSimulatorSettings.maxPrice) 
            : baseSimulatorSettings.initialPrice * 2.0,
        });

        this.validateSimulatorSettingsHighPrecision(plainSimulatorSettings);

        const plainTradingSettings = this.toPlainObject(
          createAssetDto.tradingSettings || this.DEFAULT_TRADING_SETTINGS
        );

        assetData = {
          id: assetId,
          name: createAssetDto.name,
          symbol: createAssetDto.symbol,
          icon: createAssetDto.icon || this.getDefaultNormalIcon(createAssetDto.type),
          type: createAssetDto.type,
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
          realtimeDbPath: assetData.realtimeDbPath,
        });
      }

      const plainAssetData = this.toPlainObject(assetData);

      this.logger.log(`💾 Saving asset to Firestore...`);
      await db.collection(COLLECTIONS.ASSETS).doc(assetId).set(plainAssetData);

      // ============================================
      // ✅ INITIALIZE 240 CANDLES FOR NORMAL ASSETS
      // ============================================
      if (createAssetDto.category === ASSET_CATEGORY.NORMAL && 
          (createAssetDto.dataSource === ASSET_DATA_SOURCE.REALTIME_DB || 
           createAssetDto.dataSource === ASSET_DATA_SOURCE.MOCK)) {
        
        this.logger.log(`📈 Initializing 240 candles for ${createAssetDto.symbol}...`);
        
        try {
          const initialPrice = plainAssetData.simulatorSettings?.initialPrice || 
                              createAssetDto.initialPrice || 
                              1.0;
          const volatility = plainAssetData.simulatorSettings?.secondVolatilityMax || 
                            createAssetDto.volatility || 
                            0.001;

          await this.initializeCandlesHelper.initializeAssetCandles(
            assetId,
            createAssetDto.symbol,
            plainAssetData.realtimeDbPath,
            initialPrice,
            volatility,
          );

          this.logger.log(`✅ 240 candles initialized successfully for ${createAssetDto.symbol}`);
        } catch (candleError) {
          this.logger.error(`❌ Failed to initialize candles: ${candleError.message}`);
        }
      }

      this.invalidateCache();

      // ============================================
      // 🔔 EMIT EVENT UNTUK NOTIFY SERVICE LAIN
      // ============================================
      // Emit event agar simulator langsung pick up asset baru tanpa restart
      this.eventEmitter.emit('asset.created', {
        assetId,
        symbol: createAssetDto.symbol,
        name: createAssetDto.name,
        category: createAssetDto.category,
        type: createAssetDto.type,
        dataSource: createAssetDto.dataSource,
        realtimeDbPath: plainAssetData.realtimeDbPath,
        simulatorSettings: plainAssetData.simulatorSettings,
      });

      // Emit event khusus untuk simulator relay
      if (createAssetDto.category === ASSET_CATEGORY.NORMAL) {
        this.eventEmitter.emit('simulator.asset.new', {
          assetId,
          symbol: createAssetDto.symbol,
          realtimeDbPath: plainAssetData.realtimeDbPath,
          simulatorSettings: plainAssetData.simulatorSettings,
        });
        this.logger.log(`📡 Emitted simulator.asset.new event for ${createAssetDto.symbol}`);
      }

      // Emit event khusus untuk crypto scheduler
      if (createAssetDto.category === ASSET_CATEGORY.CRYPTO) {
        this.eventEmitter.emit('crypto.asset.new', {
          assetId,
          symbol: createAssetDto.symbol,
          cryptoConfig: plainAssetData.cryptoConfig,
          realtimeDbPath: plainAssetData.realtimeDbPath,
        });
        this.logger.log(`📡 Emitted crypto.asset.new event for ${createAssetDto.symbol}`);
      }

      this.logger.log('');
      this.logger.log('');
      this.logger.log('🎉 ================================================');
      this.logger.log(`🎉 NEW ${createAssetDto.type.toUpperCase()} ASSET: ${createAssetDto.symbol}`);
      this.logger.log('🎉 ================================================');
      this.logger.log(`   Name: ${createAssetDto.name}`);
      this.logger.log(`   Icon: ${plainAssetData.icon}`);
      this.logger.log(`   Type: ${createAssetDto.type.toUpperCase()}`);
      this.logger.log(`   Category: ${createAssetDto.category.toUpperCase()}`);
      this.logger.log(`   Data Source: ${createAssetDto.dataSource}`);
      
      if (createAssetDto.category === ASSET_CATEGORY.CRYPTO) {
        this.logger.log(`   💎 Pair: ${createAssetDto.cryptoConfig?.baseCurrency}/${createAssetDto.cryptoConfig?.quoteCurrency}`);
        if (createAssetDto.cryptoConfig?.exchange) {
          this.logger.log(`   💎 Exchange: ${createAssetDto.cryptoConfig.exchange}`);
        }
        this.logger.log(`   🔗 RT DB Path: ${plainAssetData.realtimeDbPath}`);
        this.logger.log(`   ⚡ Price Source: Binance API (FREE)`);
      } else {
        this.logger.log(`   🔗 RT DB Path: ${createAssetDto.realtimeDbPath || 'N/A'}`);
        this.logger.log(`   ⚡ Simulator: WILL BE SIMULATED`);
        if (plainAssetData.simulatorSettings) {
          this.logger.log(`   💰 Initial Price: ${plainAssetData.simulatorSettings.initialPrice}`);
          this.logger.log(`   📊 Price Range: ${plainAssetData.simulatorSettings.minPrice} - ${plainAssetData.simulatorSettings.maxPrice}`);
        }
        this.logger.log(`   📈 240 Candles: ${createAssetDto.dataSource === ASSET_DATA_SOURCE.REALTIME_DB || createAssetDto.dataSource === ASSET_DATA_SOURCE.MOCK ? 'GENERATED ✅' : 'SKIPPED (API source)'}`);
      }
      
      this.logger.log(`   📈 Profit Rate: ${createAssetDto.profitRate}%`);
      this.logger.log(`   🎯 Status: ${createAssetDto.isActive ? 'ACTIVE' : 'INACTIVE'}`);
      this.logger.log('🎉 ================================================');
      this.logger.log('');

      return {
        message: `${createAssetDto.type} ${createAssetDto.category} asset created successfully`,
        asset: plainAssetData,
        storageInfo: createAssetDto.category === 'crypto' 
          ? {
              type: 'crypto',
              description: '💎 Crypto prices fetched from Binance API and stored to Realtime Database',
              priceFlow: 'Binance API → Backend → Realtime Database',
              realtimeDbPath: plainAssetData.realtimeDbPath,
              updateFrequency: 'Every price fetch (cached 60s)',
              simulatorUsed: false,
              icon: plainAssetData.icon,
              apiInfo: 'Binance FREE - No API key needed',
            }
          : {
              type: 'normal',
              description: '📊 Normal asset will be simulated by trading-simulator service',
              priceFlow: 'Simulator → Realtime Database',
              realtimeDbPath: plainAssetData.realtimeDbPath,
              updateFrequency: '1 second',
              icon: plainAssetData.icon,
              simulatorUsed: true,
              candlesInitialized: createAssetDto.dataSource === ASSET_DATA_SOURCE.REALTIME_DB || createAssetDto.dataSource === ASSET_DATA_SOURCE.MOCK,
              initialCandles: 240,
            },
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

  async bulkCreateAssets(assets: CreateAssetDto[], createdBy: string) {
    this.logger.log(`Bulk creating ${assets.length} assets`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const assetDto of assets) {
      try {
        const result = await this.createAsset(assetDto, createdBy);
        results.push({ 
          success: true, 
          symbol: assetDto.symbol,
          data: result 
        });
        successCount++;
      } catch (error) {
        this.logger.error(`Failed to create ${assetDto.symbol}: ${error.message}`);
        results.push({
          success: false,
          symbol: assetDto.symbol,
          error: error.message,
        });
        failCount++;
      }
    }

    return {
      success: true,
      message: `Processed ${assets.length} assets (${successCount} success, ${failCount} failed)`,
      summary: {
        total: assets.length,
        success: successCount,
        failed: failCount
      },
      results,
    };
  }

  async reinitializeAssetCandles(assetId: string) {
    this.logger.log(`Re-initializing candles for asset: ${assetId}`);

    try {
      const db = this.firebaseService.getFirestore();
      const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
      
      if (!assetDoc.exists) {
        throw new NotFoundException(`Asset not found: ${assetId}`);
      }

      const assetData = assetDoc.data() as Asset;

      if (assetData.category !== ASSET_CATEGORY.NORMAL) {
        throw new BadRequestException('Can only reinitialize candles for normal assets');
      }

      if (assetData.dataSource !== ASSET_DATA_SOURCE.REALTIME_DB && 
          assetData.dataSource !== ASSET_DATA_SOURCE.MOCK) {
        throw new BadRequestException('Asset must use realtime_db or mock as data source');
      }

      const currentPrice = assetData.simulatorSettings?.initialPrice || 1.0;
      const volatility = assetData.simulatorSettings?.secondVolatilityMax || 0.001;
      const realtimeDbPath = assetData.realtimeDbPath || `assets/${assetData.symbol.replace(/[^a-zA-Z0-9]/g, '_')}`;

      await this.initializeCandlesHelper.initializeAssetCandles(
        assetId,
        assetData.symbol,
        realtimeDbPath,
        currentPrice,
        volatility,
      );

      return {
        success: true,
        message: `Candles reinitialized for ${assetData.symbol}`,
        data: {
          assetId,
          symbol: assetData.symbol,
          realtimeDbPath,
        },
      };

    } catch (error) {
      this.logger.error(`Failed to reinitialize candles: ${error.message}`);
      throw error;
    }
  }

  private getDefaultCryptoIcon(baseCurrency: string): string {
    const currency = baseCurrency.toUpperCase();
    
    const iconMap: Record<string, string> = {
      'BTC': 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
      'ETH': 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
      'BNB': 'https://cryptologos.cc/logos/bnb-bnb-logo.png',
      'XRP': 'https://cryptologos.cc/logos/xrp-xrp-logo.png',
      'ADA': 'https://cryptologos.cc/logos/cardano-ada-logo.png',
      'SOL': 'https://cryptologos.cc/logos/solana-sol-logo.png',
      'DOT': 'https://cryptologos.cc/logos/polkadot-new-dot-logo.png',
      'DOGE': 'https://cryptologos.cc/logos/dogecoin-doge-logo.png',
      'MATIC': 'https://cryptologos.cc/logos/polygon-matic-logo.png',
      'LTC': 'https://cryptologos.cc/logos/litecoin-ltc-logo.png',
    };
    
    return iconMap[currency] || `https://via.placeholder.com/64?text=${currency}`;
  }

  private getDefaultNormalIcon(type?: string): string {
    const iconMap: Record<string, string> = {
      'forex': 'https://via.placeholder.com/64?text=FX',
      'stock': 'https://via.placeholder.com/64?text=STOCK',
      'commodity': 'https://via.placeholder.com/64?text=COMMODITY',
      'index': 'https://via.placeholder.com/64?text=INDEX',
    };
    
    return type && iconMap[type] 
      ? iconMap[type] 
      : 'https://via.placeholder.com/64?text=Asset';
  }

  private async validateCryptoAsset(dto: CreateAssetDto): Promise<void> {
    this.logger.log('🔍 Validating crypto asset configuration...');

    if (dto.dataSource !== ASSET_DATA_SOURCE.BINANCE) {
      throw new BadRequestException(
        'Crypto assets must use "binance" as data source'
      );
    }

    if (!dto.cryptoConfig) {
      throw new BadRequestException(
        'cryptoConfig is required for crypto assets'
      );
    }

    const { baseCurrency, quoteCurrency } = dto.cryptoConfig;

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

    if (dto.simulatorSettings) {
      throw new BadRequestException(
        'Crypto assets should NOT have simulatorSettings (they use real-time API)'
      );
    }

    if (dto.apiEndpoint) {
      throw new BadRequestException(
        'Crypto assets should NOT have apiEndpoint (they use Binance API)'
      );
    }

    if (dto.realtimeDbPath) {
      if (!dto.realtimeDbPath.startsWith('/')) {
        throw new BadRequestException(
          'realtimeDbPath must start with / (e.g., /crypto/btc_usdt)'
        );
      }

      const invalidChars = /[^a-zA-Z0-9/_-]/g;
      if (invalidChars.test(dto.realtimeDbPath)) {
        throw new BadRequestException(
          'realtimeDbPath can only contain letters, numbers, /, _, and -'
        );
      }

      if (dto.realtimeDbPath.endsWith('/') && dto.realtimeDbPath !== '/') {
        throw new BadRequestException(
          'realtimeDbPath should not end with /'
        );
      }

      if (dto.realtimeDbPath.includes('/current_price')) {
        throw new BadRequestException(
          'realtimeDbPath should NOT include /current_price (added automatically)'
        );
      }

      if (dto.realtimeDbPath.includes('/ohlc_')) {
        throw new BadRequestException(
          'realtimeDbPath should NOT include /ohlc_ (reserved for OHLC data)'
        );
      }

      this.logger.log(
        `🔍 Custom Realtime DB path provided: ${dto.realtimeDbPath}`
      );
    } else {
      const defaultPath = `/crypto/${baseCurrency.toLowerCase()}_${quoteCurrency.toLowerCase().replace('usd', 'usdt')}`;
      this.logger.log(
        `🔍 No path provided, will use default: ${defaultPath}`
      );
    }

    const currencyRegex = /^[A-Z]{2,10}$/;
    
    if (!currencyRegex.test(baseCurrency.toUpperCase())) {
      throw new BadRequestException(
        `Invalid baseCurrency format: ${baseCurrency}. Must be 2-10 uppercase letters (e.g., BTC, ETH)`
      );
    }

    if (!currencyRegex.test(quoteCurrency.toUpperCase())) {
      throw new BadRequestException(
        `Invalid quoteCurrency format: ${quoteCurrency}. Must be 2-10 uppercase letters (e.g., USD, USDT)`
      );
    }

    this.logger.log(`✅ Basic validation passed: ${baseCurrency}/${quoteCurrency}`);

    try {
      this.logger.log(`🔌 Testing Binance API for ${baseCurrency}/${quoteCurrency}...`);
      
      const testAsset: Asset = {
        id: 'test',
        name: dto.name,
        symbol: dto.symbol,
        type: dto.type as any,
        category: 'crypto',
        profitRate: dto.profitRate,
        isActive: true,
        dataSource: 'binance',
        cryptoConfig: {
          baseCurrency: baseCurrency.toUpperCase(),
          quoteCurrency: quoteCurrency.toUpperCase(),
          exchange: dto.cryptoConfig.exchange,
        },
        createdAt: new Date().toISOString(),
      };

      const pricePromise = this.binanceService.getCurrentPrice(testAsset);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Binance API timeout (5s)')), 5000)
      );

      const price = await Promise.race([pricePromise, timeoutPromise]);
      
      if (!price) {
        this.logger.warn(
          `⚠️ Could not fetch price for ${baseCurrency}/${quoteCurrency}, but continuing with creation`
        );
      } else {
        this.logger.log(
          `✅ Price test successful: ${baseCurrency}/${quoteCurrency} = $${price.price}`
        );
      }

    } catch (error) {
      this.logger.warn(
        `⚠️ Price validation failed for ${baseCurrency}/${quoteCurrency}: ${error.message}`
      );
    }

    this.logger.log('');
    this.logger.log('✅ ================================================');
    this.logger.log('✅ CRYPTO ASSET VALIDATION COMPLETE (BINANCE)');
    this.logger.log('✅ ================================================');
    this.logger.log('');
  }

  private validateNormalAsset(dto: CreateAssetDto): void {
    if (dto.dataSource === ASSET_DATA_SOURCE.BINANCE) {
      throw new BadRequestException(
        'Normal assets cannot use "binance" data source'
      );
    }

    if (dto.cryptoConfig) {
      throw new BadRequestException(
        'Normal assets should not have cryptoConfig (only for crypto category)'
      );
    }

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

    if (dto.simulatorSettings) {
      this.validateSimulatorSettingsHighPrecision(dto.simulatorSettings);
    }

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

  async updateAsset(assetId: string, updateAssetDto: UpdateAssetDto) {
    const db = this.firebaseService.getFirestore();

    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    const currentAsset = assetDoc.data() as Asset;

    if (updateAssetDto.type) {
      const validTypes = ['forex', 'stock', 'commodity', 'crypto', 'index'];
      if (!validTypes.includes(updateAssetDto.type)) {
        throw new BadRequestException(
          `Invalid asset type: ${updateAssetDto.type}. Must be one of: ${validTypes.join(', ')}`
        );
      }

      if (updateAssetDto.type === 'crypto' && currentAsset.category !== ASSET_CATEGORY.CRYPTO) {
        throw new BadRequestException(
          'Cannot change type to "crypto" for non-crypto category assets'
        );
      }

      if (updateAssetDto.type !== 'crypto' && currentAsset.category === ASSET_CATEGORY.CRYPTO) {
        throw new BadRequestException(
          'Cannot change crypto asset type to non-crypto type'
        );
      }
    }

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

  async updateAssetIcon(assetId: string, iconUrl: string) {
    const db = this.firebaseService.getFirestore();

    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    await db.collection(COLLECTIONS.ASSETS).doc(assetId).update({
      icon: iconUrl,
      updatedAt: new Date().toISOString(),
    });

    this.invalidateCache();

    this.logger.log(`✅ Icon updated for asset ${assetId}`);

    return {
      message: 'Asset icon updated successfully',
      icon: iconUrl,
    };
  }

  async deleteAsset(assetId: string) {
    const db = this.firebaseService.getFirestore();

    const assetDoc = await db.collection(COLLECTIONS.ASSETS).doc(assetId).get();
    
    if (!assetDoc.exists) {
      throw new NotFoundException('Asset not found');
    }

    const asset = assetDoc.data() as Asset;
    const assetPath = asset.realtimeDbPath || this.generateAssetPath(asset);

    this.logger.log('');
    this.logger.log('🗑️ ================================================');
    this.logger.log('🗑️ DELETING ASSET WITH REALTIME DB CLEANUP');
    this.logger.log('🗑️ ================================================');
    this.logger.log(`   Asset: ${asset.symbol} (${assetId})`);
    this.logger.log(`   Type: ${asset.type}`);
    this.logger.log(`   Category: ${asset.category}`);
    this.logger.log(`   RT DB Path: ${assetPath}`);
    this.logger.log('🗑️ ================================================');

    let realtimeDeleteSuccess = false;
    try {
      realtimeDeleteSuccess = await this.firebaseService.deleteRealtimeDbData(assetPath);
      
      if (realtimeDeleteSuccess) {
        this.logger.log(`✅ Realtime DB cleanup successful for ${asset.symbol}`);
      } else {
        this.logger.warn(`⚠️ Realtime DB cleanup may have failed for ${asset.symbol}`);
      }
    } catch (error) {
      this.logger.error(`❌ Realtime DB cleanup error: ${error.message}`);
    }

    await db.collection(COLLECTIONS.ASSETS).doc(assetId).delete();

    this.invalidateCache();

    this.logger.log('');
    this.logger.log('✅ Asset deletion complete');
    this.logger.log(`   Symbol: ${asset.symbol}`);
    this.logger.log(`   RT DB: ${realtimeDeleteSuccess ? 'Cleaned' : 'Failed'}`);
    this.logger.log(`   Firestore: Deleted`);
    this.logger.log('🗑️ ================================================');
    this.logger.log('');

    return {
      message: 'Asset deleted successfully',
      details: {
        symbol: asset.symbol,
        type: asset.type,
        realtimeDbCleaned: realtimeDeleteSuccess,
        firestoreDeleted: true,
      },
    };
  }

  private generateAssetPath(asset: Asset): string {
    if (asset.realtimeDbPath) {
      return asset.realtimeDbPath;
    }

    if (asset.category === 'crypto' && asset.cryptoConfig) {
      const { baseCurrency, quoteCurrency } = asset.cryptoConfig;
      return `/crypto/${baseCurrency.toLowerCase()}_${quoteCurrency.toLowerCase().replace('usd', 'usdt')}`;
    }

    return `/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }

  async getAllAssets(activeOnly: boolean = false, type?: string) {
    const startTime = Date.now();
    
    if (this.allAssetsCache && !activeOnly && !type) {
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

    if (type) {
      const validTypes = ['forex', 'stock', 'commodity', 'crypto', 'index'];
      if (!validTypes.includes(type)) {
        throw new BadRequestException(
          `Invalid type filter: ${type}. Must be one of: ${validTypes.join(', ')}`
        );
      }
      query = query.where('type', '==', type) as any;
    }

    const snapshot = await query.get();
    const assets = snapshot.docs.map(doc => {
      const data = doc.data() as Asset;
      
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

    if (!activeOnly && !type) {
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
    
    const byType = assets.reduce((acc, asset) => {
      if (!acc[asset.type]) {
        acc[asset.type] = 0;
      }
      acc[asset.type]++;
      return acc;
    }, {} as Record<string, number>);
    
    this.logger.debug(
      `⚡ Fetched ${assets.length} assets in ${duration}ms ` +
      `(${Object.entries(byType).map(([t, c]) => `${t}: ${c}`).join(', ')})`
    );

    return {
      assets,
      total: assets.length,
      byType,
      filters: {
        activeOnly,
        type: type || 'all',
      },
    };
  }

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
          type: asset.type,
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

  async getAssetSettings(assetId: string): Promise<Asset> {
    return this.getAssetById(assetId);
  }

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
        this.logger.log(`💎 ${cryptoAssets.length} crypto assets ready (Binance)`);
      }
      
    } catch (error) {
      this.logger.error(`Cache warmup failed: ${error.message}`);
    }
  }

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

  private invalidateCache(): void {
    this.assetCache.clear();
    this.allAssetsCache = null;
    this.logger.debug('Asset cache invalidated');
  }

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

  async getActiveAssets(): Promise<Asset[]> {
    const { assets } = await this.getAllAssets(true);
    return assets;
  }

  getPerformanceStats() {
    const assetsByType = Array.from(this.assetCache.values()).reduce((acc, c) => {
      if (!acc[c.asset.type]) {
        acc[c.asset.type] = 0;
      }
      acc[c.asset.type]++;
      return acc;
    }, {} as Record<string, number>);

    return {
      cachedAssets: this.assetCache.size,
      assetsByType,
      allAssetsCached: !!this.allAssetsCache,
      priceStats: this.priceFetcherService.getPerformanceStats(),
      cryptoApi: 'Binance FREE',
    };
  }
}