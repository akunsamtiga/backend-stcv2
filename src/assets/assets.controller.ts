import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete, 
  Body, 
  Param, 
  Query, 
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiBearerAuth, 
  ApiParam, 
  ApiQuery, 
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { USER_ROLES } from '../common/constants';
import { AssetsService } from './assets.service';
import { CryptoPriceSchedulerService } from './services/crypto-price-scheduler.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@ApiTags('assets')
@Controller('assets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AssetsController {
  constructor(
    private assetsService: AssetsService,
    private cryptoScheduler: CryptoPriceSchedulerService,
  ) {}

  // ============================================
  // SUPER ADMIN ONLY - FULL CONTROL
  // ============================================

  @Post()
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ 
    summary: 'Create new asset (Super Admin only)',
    description: `Create asset with full control over simulator and trading settings.
    
**Asset Categories:**
- \`normal\`: Standard assets (stocks, indices, commodities) - Simulated by trading-simulator service
- \`crypto\`: Cryptocurrency assets - Real-time prices from CryptoCompare API

**Data Sources:**
- \`realtime_db\`: Firebase Realtime Database (for normal assets)
- \`mock\`: Mock/Simulator (for normal assets)
- \`cryptocompare\`: CryptoCompare API (for crypto assets only)

**Important Notes:**
- Crypto assets MUST use \`cryptocompare\` data source
- Crypto assets MUST have \`cryptoConfig\` with baseCurrency and quoteCurrency
- Crypto assets should NOT have \`simulatorSettings\` or \`apiEndpoint\`
- Normal assets MUST use \`realtime_db\` or \`mock\` data source
- Normal assets should have \`simulatorSettings\` for price simulation`
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Asset created successfully',
    schema: {
      example: {
        success: true,
        message: 'crypto asset created successfully',
        data: {
          asset: {
            id: 'asset_abc123',
            name: 'Bitcoin',
            symbol: 'BTC/USD',
            category: 'crypto',
            profitRate: 85,
            isActive: true,
            dataSource: 'cryptocompare',
            realtimeDbPath: '/crypto/btc_usd',
            cryptoConfig: {
              baseCurrency: 'BTC',
              quoteCurrency: 'USD',
              exchange: 'Binance'
            },
            description: 'Bitcoin - Leading cryptocurrency',
            tradingSettings: {
              minOrderAmount: 1000,
              maxOrderAmount: 1000000,
              allowedDurations: [0.0167, 1, 2, 3, 4, 5, 15, 30, 45, 60]
            },
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            createdBy: 'super_admin_id'
          },
          storageInfo: {
            type: 'crypto',
            description: '💎 Crypto prices fetched from CryptoCompare API and stored to Realtime Database',
            priceFlow: 'CryptoCompare API → Backend → Realtime Database',
            realtimeDbPath: '/crypto/btc_usd',
            updateFrequency: 'Every 5 seconds',
            simulatorUsed: false
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad Request - Invalid input data',
    schema: {
      example: {
        success: false,
        error: 'Crypto assets MUST use "cryptocompare" data source',
        statusCode: 400
      }
    }
  })
  @ApiResponse({ 
    status: 409, 
    description: 'Conflict - Asset symbol already exists',
    schema: {
      example: {
        success: false,
        error: 'Asset with symbol BTC/USD already exists',
        statusCode: 409
      }
    }
  })
  @ApiBody({ type: CreateAssetDto })
  createAsset(
    @Body() createAssetDto: CreateAssetDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.assetsService.createAsset(createAssetDto, userId);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Update asset (Super Admin only)',
    description: 'Update any asset property including simulator and trading settings'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Asset ID',
    example: 'asset_abc123'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Asset updated successfully',
    schema: {
      example: {
        success: true,
        message: 'Asset updated successfully'
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Asset not found',
    schema: {
      example: {
        success: false,
        error: 'Asset not found',
        statusCode: 404
      }
    }
  })
  @ApiBody({ type: UpdateAssetDto })
  updateAsset(
    @Param('id') assetId: string,
    @Body() updateAssetDto: UpdateAssetDto,
  ) {
    return this.assetsService.updateAsset(assetId, updateAssetDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Delete asset (Super Admin only)',
    description: 'Permanently delete an asset'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Asset ID',
    example: 'asset_abc123'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Asset deleted successfully',
    schema: {
      example: {
        success: true,
        message: 'Asset deleted successfully'
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Asset not found'
  })
  deleteAsset(@Param('id') assetId: string) {
    return this.assetsService.deleteAsset(assetId);
  }

  @Get(':id/settings')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get detailed asset settings (Admin only)',
    description: 'Get complete asset configuration including all settings'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Asset ID',
    example: 'asset_abc123'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns complete asset configuration',
    schema: {
      example: {
        success: true,
        data: {
          id: 'asset_abc123',
          name: 'Bitcoin',
          symbol: 'BTC/USD',
          category: 'crypto',
          profitRate: 85,
          isActive: true,
          dataSource: 'cryptocompare',
          realtimeDbPath: '/crypto/btc_usd',
          description: 'Bitcoin - Leading cryptocurrency',
          cryptoConfig: {
            baseCurrency: 'BTC',
            quoteCurrency: 'USD',
            exchange: 'Binance'
          },
          tradingSettings: {
            minOrderAmount: 1000,
            maxOrderAmount: 1000000,
            allowedDurations: [0.0167, 1, 2, 3, 4, 5, 15, 30, 45, 60]
          },
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          createdBy: 'super_admin_id'
        }
      }
    }
  })
  getAssetSettings(@Param('id') assetId: string) {
    return this.assetsService.getAssetSettings(assetId);
  }

  // ============================================
  // PUBLIC ENDPOINTS (All authenticated users)
  // ============================================

  @Get()
  @ApiOperation({ 
    summary: 'Get all assets',
    description: `Get list of all active trading assets.
    
Returns both normal and crypto assets with basic information.
Crypto assets are identified by \`category: 'crypto'\` field.`
  })
  @ApiQuery({ 
    name: 'activeOnly', 
    required: false, 
    type: Boolean,
    description: 'Filter active assets only (default: false)',
    example: true
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns list of assets',
    schema: {
      example: {
        success: true,
        data: {
          assets: [
            {
              id: 'asset_normal_1',
              name: 'IDX STC',
              symbol: 'IDX_STC',
              category: 'normal',
              profitRate: 85,
              isActive: true,
              dataSource: 'realtime_db',
              realtimeDbPath: '/idx_stc',
              tradingSettings: {
                minOrderAmount: 1000,
                maxOrderAmount: 1000000,
                allowedDurations: [1, 2, 3, 4, 5, 15, 30, 45, 60]
              }
            },
            {
              id: 'asset_crypto_1',
              name: 'Bitcoin',
              symbol: 'BTC/USD',
              category: 'crypto',
              profitRate: 85,
              isActive: true,
              dataSource: 'cryptocompare',
              realtimeDbPath: '/crypto/btc_usd',
              cryptoConfig: {
                baseCurrency: 'BTC',
                quoteCurrency: 'USD'
              },
              tradingSettings: {
                minOrderAmount: 1000,
                maxOrderAmount: 1000000,
                allowedDurations: [0.0167, 1, 2, 3, 4, 5, 15, 30, 45, 60]
              }
            }
          ],
          total: 2,
          byCategory: {
            normal: 1,
            crypto: 1
          }
        }
      }
    }
  })
  getAllAssets(@Query('activeOnly') activeOnly: boolean = false) {
    return this.assetsService.getAllAssets(activeOnly);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get asset by ID',
    description: 'Get detailed information about a specific asset'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Asset ID',
    example: 'asset_abc123'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns asset details',
    schema: {
      example: {
        success: true,
        data: {
          id: 'asset_abc123',
          name: 'Bitcoin',
          symbol: 'BTC/USD',
          category: 'crypto',
          profitRate: 85,
          isActive: true,
          dataSource: 'cryptocompare',
          cryptoConfig: {
            baseCurrency: 'BTC',
            quoteCurrency: 'USD'
          },
          tradingSettings: {
            minOrderAmount: 1000,
            maxOrderAmount: 1000000,
            allowedDurations: [0.0167, 1, 2, 3, 4, 5, 15, 30, 45, 60]
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Asset not found'
  })
  getAssetById(@Param('id') assetId: string) {
    return this.assetsService.getAssetById(assetId);
  }

  @Get(':id/price')
  @ApiOperation({ 
    summary: 'Get current price for asset',
    description: `Fetches real-time price with timeout and cache.

**For Normal Assets:**
- Price fetched from Firebase Realtime Database
- Updated by trading-simulator service every 1 second

**For Crypto Assets:**
- Price fetched from CryptoCompare API
- Cached for 5 seconds to avoid rate limits
- Updated by background scheduler every 5 seconds`
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Asset ID',
    example: 'asset_abc123'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns current price data',
    schema: {
      example: {
        success: true,
        data: {
          asset: {
            id: 'asset_abc123',
            name: 'Bitcoin',
            symbol: 'BTC/USD',
            category: 'crypto'
          },
          price: 68342.50,
          timestamp: 1704067200,
          datetime: '2024-01-01T00:00:00.000Z',
          responseTime: 85
        }
      }
    }
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Asset not found or price unavailable',
    schema: {
      example: {
        success: false,
        error: 'Price unavailable for BTC/USD',
        statusCode: 404
      }
    }
  })
  @ApiResponse({ 
    status: 408, 
    description: 'Request timeout (price service timeout)',
    schema: {
      example: {
        success: false,
        error: 'Price service timeout',
        statusCode: 408
      }
    }
  })
  getCurrentPrice(@Param('id') assetId: string) {
    return this.assetsService.getCurrentPrice(assetId);
  }

  // ============================================
  // CRYPTO SCHEDULER ENDPOINTS (Admin only)
  // ============================================

  @Get('crypto/scheduler/status')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get crypto price scheduler status (Admin only)',
    description: `Get detailed status of the crypto price background scheduler.
    
Shows information about:
- Running status
- Active crypto assets
- Update statistics
- Last update time
- Error counts`
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns scheduler status',
    schema: {
      example: {
        success: true,
        data: {
          isRunning: true,
          assetCount: 3,
          updateCount: 1250,
          errorCount: 2,
          lastUpdate: '5s ago',
          updateInterval: '5000ms',
          assets: [
            {
              symbol: 'BTC/USD',
              pair: 'BTC/USD',
              path: '/crypto/btc_usd'
            },
            {
              symbol: 'ETH/USD',
              pair: 'ETH/USD',
              path: '/crypto/eth_usd'
            },
            {
              symbol: 'BNB/USD',
              pair: 'BNB/USD',
              path: '/crypto/bnb_usd'
            }
          ]
        }
      }
    }
  })
  getCryptoSchedulerStatus() {
    return {
      success: true,
      data: this.cryptoScheduler.getStatus(),
    };
  }

  @Post('crypto/scheduler/trigger')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Trigger manual crypto price update (Super Admin only)',
    description: `Manually trigger a crypto price update cycle.
    
Useful for:
- Testing the scheduler
- Forcing immediate price refresh
- Debugging price issues

This will immediately fetch prices for all active crypto assets and write to Realtime Database.`
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Update triggered successfully',
    schema: {
      example: {
        success: true,
        message: 'Crypto price update triggered'
      }
    }
  })
  async triggerCryptoUpdate() {
    await this.cryptoScheduler.triggerUpdate();
    return {
      success: true,
      message: 'Crypto price update triggered',
    };
  }

  @Post('crypto/scheduler/refresh-assets')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Refresh crypto assets list (Super Admin only)',
    description: `Manually refresh the list of crypto assets in the scheduler.
    
Useful when:
- New crypto assets are added
- Existing crypto assets are modified
- Assets are activated/deactivated

This will reload all active crypto assets from Firestore and update the scheduler.`
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Assets refreshed successfully',
    schema: {
      example: {
        success: true,
        message: 'Crypto assets list refreshed'
      }
    }
  })
  async refreshCryptoAssets() {
    await this.cryptoScheduler.refreshCryptoAssets();
    return {
      success: true,
      message: 'Crypto assets list refreshed',
    };
  }

  // ============================================
  // PERFORMANCE & MONITORING
  // ============================================

  @Get('performance/stats')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get assets service performance statistics (Admin only)',
    description: 'Get detailed performance metrics for asset operations'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns performance statistics',
    schema: {
      example: {
        success: true,
        data: {
          cachedAssets: 15,
          normalAssets: 10,
          cryptoAssets: 5,
          allAssetsCached: true,
          priceStats: {
            totalFetches: 5000,
            cacheHits: 3500,
            cacheHitRate: '70%',
            avgFetchTime: 85,
            cacheSize: 15,
            consecutiveFailures: 0,
            isHealthy: true,
            cryptoStats: {
              apiCalls: 1000,
              cacheHits: 800,
              cacheHitRate: '80%',
              errors: 5,
              realtimeWrites: 1000,
              lastCall: '2s ago'
            }
          }
        }
      }
    }
  })
  getPerformanceStats() {
    return {
      success: true,
      data: this.assetsService.getPerformanceStats(),
    };
  }
}
