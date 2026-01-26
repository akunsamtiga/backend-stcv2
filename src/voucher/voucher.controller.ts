import { 
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards 
} from '@nestjs/common';
import { 
  ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse 
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
    description: 'Create deposit bonus voucher with percentage or fixed amount'
  })
  @ApiResponse({ status: 201, description: 'Voucher created successfully' })
  @ApiResponse({ status: 409, description: 'Voucher code already exists' })
  createVoucher(
    @Body() createVoucherDto: CreateVoucherDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.voucherService.createVoucher(createVoucherDto, adminId);
  }

  @Get()
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get all vouchers (Admin only)',
    description: 'List all vouchers with pagination and optional active filter'
  })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getAllVouchers(
    @Query('isActive') isActive?: boolean,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.voucherService.getAllVouchers({ isActive, page, limit });
  }

  @Get(':id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Get voucher details (Admin only)' })
  @ApiParam({ name: 'id', description: 'Voucher ID' })
  getVoucherById(@Param('id') voucherId: string) {
    return this.voucherService.getVoucherById(voucherId);
  }

  @Get(':id/statistics')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get voucher usage statistics (Admin only)',
    description: 'Get detailed statistics about voucher usage'
  })
  @ApiParam({ name: 'id', description: 'Voucher ID' })
  getVoucherStatistics(@Param('id') voucherId: string) {
    return this.voucherService.getVoucherStatistics(voucherId);
  }

  @Put(':id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Update voucher (Admin only)' })
  @ApiParam({ name: 'id', description: 'Voucher ID' })
  updateVoucher(
    @Param('id') voucherId: string,
    @Body() updateVoucherDto: UpdateVoucherDto,
  ) {
    return this.voucherService.updateVoucher(voucherId, updateVoucherDto);
  }

  @Delete(':id')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete voucher (Super Admin only)' })
  @ApiParam({ name: 'id', description: 'Voucher ID' })
  deleteVoucher(@Param('id') voucherId: string) {
    return this.voucherService.deleteVoucher(voucherId);
  }

  // ============================================
  // USER ENDPOINTS
  // ============================================

  @Post('validate')
  @ApiOperation({ 
    summary: 'Validate voucher code',
    description: 'Check if voucher is valid for current user with specific deposit amount'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Validation result',
    schema: {
      example: {
        valid: true,
        bonusAmount: 10000,
        message: 'Voucher valid! You will receive Rp 10,000 bonus'
      }
    }
  })
  validateVoucher(
    @CurrentUser('sub') userId: string,
    @Body() validateDto: ValidateVoucherDto,
  ) {
    return this.voucherService.validateVoucher(userId, validateDto);
  }

  @Get('my/history')
  @ApiOperation({ 
    summary: 'Get my voucher usage history',
    description: 'Get all vouchers used by current user'
  })
  getMyVoucherHistory(@CurrentUser('sub') userId: string) {
    return this.voucherService.getUserVoucherHistory(userId);
  }
}