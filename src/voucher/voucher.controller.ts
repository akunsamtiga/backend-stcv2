// src/voucher/voucher.controller.ts

import { 
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpStatus 
} from '@nestjs/common';
import { 
  ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse, ApiParam 
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { USER_ROLES } from '../common/constants';
import { VoucherService } from './voucher.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { ValidateVoucherDto } from './dto/validate-voucher.dto';
import { Voucher, VoucherUsage, ApiResponse as ApiResponseType } from '../common/interfaces';

@ApiTags('vouchers')
@Controller('vouchers')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VoucherController {
  constructor(private voucherService: VoucherService) {}

  // ============================================
  // ADMIN ENDPOINTS
  // ============================================

  @Post()
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Create new voucher (Admin only)',
    description: 'Create a new deposit voucher with bonus settings'
  })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Voucher created successfully',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Voucher code already exists' })
  async createVoucher(
    @Body() createVoucherDto: CreateVoucherDto, 
    @CurrentUser() user: any
  ) {
    const voucher = await this.voucherService.createVoucher(createVoucherDto, user.id);
    return {
      success: true,
      message: 'Voucher created successfully',
      data: voucher,
      timestamp: new Date().toISOString(),
      path: '/vouchers',
    };
  }

  @Get()
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get all vouchers (Admin only)',
    description: 'Retrieve all vouchers with optional filters and pagination'
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20)' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: 'Filter by active status' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Vouchers retrieved successfully',
  })
  async getAllVouchers(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('isActive') isActive?: string,
  ) {
    const isActiveBoolean = isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    
    const result = await this.voucherService.getAllVouchers({ 
      page: Number(page), 
      limit: Number(limit), 
      isActive: isActiveBoolean 
    });
    
    return {
      success: true,
      message: 'Vouchers retrieved successfully',
      data: result,
      timestamp: new Date().toISOString(),
      path: '/vouchers',
    };
  }

  @Get(':id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get voucher by ID (Admin only)',
    description: 'Retrieve detailed information about a specific voucher'
  })
  @ApiParam({ name: 'id', description: 'Voucher ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Voucher retrieved successfully'
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Voucher not found' })
  async getVoucherById(@Param('id') id: string) {
    const voucher = await this.voucherService.getVoucherById(id);
    return {
      success: true,
      message: 'Voucher retrieved successfully',
      data: voucher,
      timestamp: new Date().toISOString(),
      path: `/vouchers/${id}`,
    };
  }

  @Get(':id/statistics')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get voucher statistics (Admin only)',
    description: 'Get usage statistics and analytics for a specific voucher'
  })
  @ApiParam({ name: 'id', description: 'Voucher ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Statistics retrieved successfully',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Voucher not found' })
  async getVoucherStatistics(@Param('id') id: string) {
    const statistics = await this.voucherService.getVoucherStatistics(id);
    return {
      success: true,
      message: 'Statistics retrieved successfully',
      data: statistics,
      timestamp: new Date().toISOString(),
      path: `/vouchers/${id}/statistics`,
    };
  }

  @Put(':id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Update voucher (Admin only)',
    description: 'Update voucher settings (cannot change code)'
  })
  @ApiParam({ name: 'id', description: 'Voucher ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Voucher updated successfully'
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Voucher not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  async updateVoucher(
    @Param('id') id: string,
    @Body() updateVoucherDto: UpdateVoucherDto,
  ) {
    const voucher = await this.voucherService.updateVoucher(id, updateVoucherDto);
    return {
      success: true,
      message: 'Voucher updated successfully',
      data: voucher,
      timestamp: new Date().toISOString(),
      path: `/vouchers/${id}`,
    };
  }

  @Delete(':id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Delete voucher (Admin only)',
    description: 'Soft delete a voucher (marks as inactive)'
  })
  @ApiParam({ name: 'id', description: 'Voucher ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Voucher deleted successfully'
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Voucher not found' })
  async deleteVoucher(@Param('id') id: string) {
    await this.voucherService.deleteVoucher(id);
    return {
      success: true,
      message: 'Voucher deleted successfully',
      timestamp: new Date().toISOString(),
      path: `/vouchers/${id}`,
    };
  }

  // ============================================
  // USER ENDPOINTS
  // ============================================

  @Post('validate')
  @ApiOperation({ 
    summary: 'Validate voucher code',
    description: 'Check if a voucher is valid and calculate bonus amount'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Voucher validation result',
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid voucher',
  })
  async validateVoucher(
    @Body() validateVoucherDto: ValidateVoucherDto,
    @CurrentUser() user: any,
  ) {
    const result = await this.voucherService.validateVoucher(
      validateVoucherDto.code,
      validateVoucherDto.depositAmount,
      user,
    );
    
    return {
      success: true,
      message: result.message || 'Voucher validation completed',
      data: result,
      timestamp: new Date().toISOString(),
      path: '/vouchers/validate',
    };
  }

  @Get('my/history')
  @ApiOperation({ 
    summary: 'Get my voucher usage history',
    description: 'Retrieve all vouchers used by the current user'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Voucher history retrieved successfully',
  })
  async getMyVoucherHistory(@CurrentUser() user: any) {
    const history = await this.voucherService.getMyVoucherHistory(user.id);
    return {
      success: true,
      message: 'Voucher history retrieved successfully',
      data: history,
      timestamp: new Date().toISOString(),
      path: '/vouchers/my/history',
    };
  }
}