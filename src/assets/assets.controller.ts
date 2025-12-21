import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, SetMetadata } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { USER_ROLES } from '../common/constants';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@ApiTags('assets')
@Controller('assets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AssetsController {
  constructor(private assetsService: AssetsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Create new asset (Admin only)' })
  createAsset(
    @Body() createAssetDto: CreateAssetDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.assetsService.createAsset(createAssetDto, userId);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Update asset (Admin only)' })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  updateAsset(
    @Param('id') assetId: string,
    @Body() updateAssetDto: UpdateAssetDto,
  ) {
    return this.assetsService.updateAsset(assetId, updateAssetDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete asset (Super Admin only)' })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  deleteAsset(@Param('id') assetId: string) {
    return this.assetsService.deleteAsset(assetId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all assets' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  getAllAssets(@Query('activeOnly') activeOnly: boolean = false) {
    return this.assetsService.getAllAssets(activeOnly);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get asset by ID' })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  getAssetById(@Param('id') assetId: string) {
    return this.assetsService.getAssetById(assetId);
  }

  @Get(':id/price')
  @ApiOperation({ 
    summary: 'Get current price for asset',
    description: 'Fetches real-time price with 5s timeout and cache'
  })
  @ApiParam({ name: 'id', description: 'Asset ID' })
  async getCurrentPrice(@Param('id') assetId: string) {
    // This endpoint has built-in timeout in service
    return this.assetsService.getCurrentPrice(assetId);
  }
}
