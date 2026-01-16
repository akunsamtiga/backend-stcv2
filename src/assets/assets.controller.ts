// src/assets/assets.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { USER_ROLES } from '../common/constants';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { CryptoPriceSchedulerService } from './services/crypto-price-scheduler.service';

@ApiTags('assets')
@Controller('assets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AssetsController {
  constructor(
    private assetsService: AssetsService,
    private cryptoScheduler: CryptoPriceSchedulerService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Create new asset (Super Admin only)',
    description: 'Create asset with full control over simulator and trading settings'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Asset created successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Asset created successfully',
          asset: {
            id: 'asset_id',
            name: 'IDX STC',
            symbol: 'IDX_STC',
            profitRate: 85,
            isActive: true,
            dataSource: 'realtime_db',
            realtimeDbPath: '/idx_stc/current_price',
            simulatorSettings: {
              initialPrice: 40.022,
              dailyVolatilityMin: 0.001,
              dailyVolatilityMax: 0.005,
              secondVolatilityMin: 0.00001,
              secondVolatilityMax: 0.00008,
              minPrice: 20.011,
              maxPrice: 80.044
            },
            tradingSettings: {
              minOrderAmount: 1000,
              maxOrderAmount: 1000000,
              allowedDurations: [1,2,3,4,5,15,30,45,60]
            }
          }
        }
      }
    }
  })
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
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Asset updated successfully' 
  })
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
    description: 'Permanently delete an asset and clean up associated Realtime Database data'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Asset deleted successfully with cleanup',
    schema: {
      example: {
        success: true,
        message: 'Asset deleted successfully',
        data: {
          symbol: 'BTC/USD',
          realtimeDbCleaned: true,
          firestoreDeleted: true,
          path: '/crypto/btc_usdt'
        }
      }
    }
  })
  async deleteAsset(@Param('id') assetId: string) {
    return this.assetsService.deleteAsset(assetId);
  }

  @Get(':id/settings')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get detailed asset settings (Admin only)',
    description: 'Get complete asset configuration including all settings'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns complete asset configuration',
    schema: {
      example: {
        success: true,
        data: {
          id: 'asset_id',
          name: 'IDX STC',
          symbol: 'IDX_STC',
          profitRate: 85,
          isActive: true,
          dataSource: 'realtime_db',
          realtimeDbPath: '/idx_stc/current_price',
          description: 'Indonesian stock index',
          simulatorSettings: {
            initialPrice: 40.022,
            dailyVolatilityMin: 0.001,
            dailyVolatilityMax: 0.005,
            secondVolatilityMin: 0.00001,
            secondVolatilityMax: 0.00008,
            minPrice: 20.011,
            maxPrice: 80.044
          },
          tradingSettings: {
            minOrderAmount: 1000,
            maxOrderAmount: 1000000,
            allowedDurations: [1,2,3,4,5,15,30,45,60]
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

  @Get('crypto/scheduler/status')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get crypto price scheduler status (Admin only)',
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
  @ApiOperation({ 
    summary: 'Trigger manual crypto price update (Super Admin only)',
  })
  async triggerCryptoUpdate() {
    await this.cryptoScheduler.triggerUpdate();
    return {
      success: true,
      message: 'Crypto price update triggered',
    };
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all assets',
    description: 'Get list of assets (basic info only for regular users)'
  })
  @ApiQuery({ 
    name: 'activeOnly', 
    required: false, 
    type: Boolean,
    description: 'Filter active assets only'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns list of assets' 
  })
  getAllAssets(@Query('activeOnly') activeOnly: boolean = false) {
    return this.assetsService.getAllAssets(activeOnly);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get asset by ID',
    description: 'Get basic asset information'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns asset details' 
  })
  getAssetById(@Param('id') assetId: string) {
    return this.assetsService.getAssetById(assetId);
  }

  @Post(':id/icon')
@UseGuards(RolesGuard)
@Roles(USER_ROLES.SUPER_ADMIN)
@ApiOperation({ 
  summary: 'Upload asset icon (Super Admin only)',
  description: 'Upload icon/logo for asset'
})
@ApiParam({ name: 'id', description: 'Asset ID' })
@ApiResponse({ status: 200, description: 'Icon uploaded successfully' })
async uploadIcon(
  @Param('id') assetId: string,
  @Body() body: { iconUrl: string },
) {
  return this.assetsService.updateAssetIcon(assetId, body.iconUrl);
}

  @Post('crypto/scheduler/cleanup')
@UseGuards(RolesGuard)
@Roles(USER_ROLES.SUPER_ADMIN)
@ApiOperation({ 
  summary: 'Trigger manual crypto cleanup (Super Admin only)',
  description: 'Manually trigger aggressive cleanup for all crypto OHLC data'
})
async triggerCryptoCleanup() {
  await this.cryptoScheduler.triggerCleanup();
  return {
    success: true,
    message: 'Crypto cleanup triggered successfully',
    info: 'Check logs for cleanup progress'
  };
}

@Get('crypto/scheduler/cleanup-stats')
@UseGuards(RolesGuard)
@Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
@ApiOperation({ 
  summary: 'Get crypto cleanup statistics (Admin only)',
})
getCleanupStats() {
  const status = this.cryptoScheduler.getStatus();
  return {
    success: true,
    data: status.cleanup,
  };
}

  @Get(':id/price')
  @ApiOperation({ 
    summary: 'Get current price for asset',
    description: 'Fetches real-time price with timeout and cache'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns current price data',
    schema: {
      example: {
        success: true,
        data: {
          asset: {
            id: 'asset_id',
            name: 'IDX STC',
            symbol: 'IDX_STC'
          },
          price: 40.125,
          timestamp: 1704067200,
          datetime: '2024-01-01T00:00:00.000Z',
          responseTime: 85
        }
      }
    }
  })
  getCurrentPrice(@Param('id') assetId: string) {
    return this.assetsService.getCurrentPrice(assetId);
  }
}