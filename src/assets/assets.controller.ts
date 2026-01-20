// src/assets/assets.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { USER_ROLES, ASSET_TYPE_INFO } from '../common/constants';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { CryptoPriceSchedulerService } from './services/crypto-price-scheduler.service';
import { SimulatorPriceRelayService } from './services/simulator-price-relay.service';

@ApiTags('assets')
@Controller('assets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AssetsController {
  constructor(
    private assetsService: AssetsService,
    private cryptoScheduler: CryptoPriceSchedulerService,
    private simulatorRelay: SimulatorPriceRelayService,
  ) {}

  @Get('types')
  @ApiOperation({ 
    summary: 'Get available asset types',
    description: 'Returns list of supported asset types with metadata'
  })
  @ApiResponse({ status: 200, description: 'Returns asset types information' })
  getAssetTypes() {
    return {
      success: true,
      data: {
        types: ASSET_TYPE_INFO,
        availableTypes: Object.keys(ASSET_TYPE_INFO),
      }
    };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Create new asset (Super Admin only)',
    description: 'Create asset with full control over type, simulator and trading settings'
  })
  @ApiResponse({ status: 201, description: 'Asset created successfully' })
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
    description: 'Update any asset property including type, simulator and trading settings'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, description: 'Asset updated successfully' })
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
  @ApiResponse({ status: 200, description: 'Asset deleted successfully with cleanup' })
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
  @ApiResponse({ status: 200, description: 'Returns complete asset configuration' })
  getAssetSettings(@Param('id') assetId: string) {
    return this.assetsService.getAssetSettings(assetId);
  }

  @Get('crypto/scheduler/status')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get crypto price scheduler status (Admin only)',
    description: 'Returns scheduler status, active crypto assets, and performance metrics'
  })
  @ApiResponse({ status: 200, description: 'Scheduler status retrieved successfully' })
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
    description: 'Manually trigger crypto price fetch and OHLC generation'
  })
  @ApiResponse({ status: 200, description: 'Manual update triggered successfully' })
  async triggerCryptoUpdate() {
    await this.cryptoScheduler.triggerUpdate();
    return {
      success: true,
      message: 'Crypto price update triggered',
    };
  }

  @Post('crypto/scheduler/cleanup')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Trigger manual crypto cleanup (Super Admin only)',
    description: 'Manually trigger aggressive cleanup for all crypto OHLC data'
  })
  @ApiResponse({ status: 200, description: 'Cleanup triggered successfully' })
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
    description: 'Returns cleanup statistics including runs, deleted bars, and timeframe breakdown'
  })
  @ApiResponse({ status: 200, description: 'Cleanup stats retrieved successfully' })
  getCleanupStats() {
    const status = this.cryptoScheduler.getStatus();
    return {
      success: true,
      data: status.cleanup,
    };
  }

  @Get('simulator/relay/status')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get simulator price relay status (Admin only)',
    description: 'Returns relay service status for normal assets'
  })
  @ApiResponse({ status: 200, description: 'Relay status retrieved successfully' })
  getSimulatorRelayStatus() {
    return {
      success: true,
      data: this.simulatorRelay.getStatus(),
    };
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all assets',
    description: 'Get list of assets with optional filtering by type and active status'
  })
  @ApiQuery({ 
    name: 'activeOnly', 
    required: false, 
    type: Boolean,
    description: 'Filter active assets only'
  })
  @ApiQuery({ 
    name: 'type', 
    required: false, 
    enum: ['forex', 'stock', 'commodity', 'crypto', 'index'],
    description: 'Filter by asset type'
  })
  @ApiResponse({ status: 200, description: 'Returns list of assets' })
  getAllAssets(
    @Query('activeOnly') activeOnly: boolean = false,
    @Query('type') type?: string,
  ) {
    return this.assetsService.getAllAssets(activeOnly, type);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get asset by ID',
    description: 'Get detailed asset information including type and settings'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, description: 'Returns asset details' })
  getAssetById(@Param('id') assetId: string) {
    return this.assetsService.getAssetById(assetId);
  }

  @Post(':id/icon')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Upload asset icon (Super Admin only)',
    description: 'Upload or update icon/logo for asset'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, description: 'Icon uploaded successfully' })
  async uploadIcon(
    @Param('id') assetId: string,
    @Body() body: { iconUrl: string },
  ) {
    return this.assetsService.updateAssetIcon(assetId, body.iconUrl);
  }

  @Get(':id/price')
  @ApiOperation({ 
    summary: 'Get current price for asset',
    description: 'Fetches real-time price with timeout and cache optimization'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  @ApiResponse({ status: 200, description: 'Returns current price data' })
  getCurrentPrice(@Param('id') assetId: string) {
    return this.assetsService.getCurrentPrice(assetId);
  }

  @Get('stats/performance')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get asset service performance stats (Admin only)',
    description: 'Returns cache statistics, asset distribution, and performance metrics'
  })
  @ApiResponse({ status: 200, description: 'Performance stats retrieved successfully' })
  getPerformanceStats() {
    return {
      success: true,
      data: this.assetsService.getPerformanceStats(),
    };
  }
}