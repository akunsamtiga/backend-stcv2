// src/admin/admin.controller.ts
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
import { AdminService } from './admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ManageBalanceDto } from './dto/manage-balance.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private adminService: AdminService) {}

  // ============================================
  // USER MANAGEMENT
  // ============================================

  @Post('users')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Create new user (Admin only)' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  createUser(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.adminService.createUser(createUserDto, adminId);
  }

  @Put('users/:id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Update user (Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  updateUser(
    @Param('id') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(userId, updateUserDto);
  }

  @Get('users')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Get all users (Admin only)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'withBalance', required: false, type: Boolean })
  getAllUsers(@Query() queryDto: GetUsersQueryDto) {
    return this.adminService.getAllUsers(queryDto);
  }

  @Get('users/with-balance')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all users with balance summary (Super Admin only)' })
  @ApiResponse({ status: 200, description: 'Returns all users with their balances' })
  getAllUsersWithBalance() {
    return this.adminService.getAllUsersWithBalance();
  }

  @Get('users/:id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ summary: 'Get user by ID (Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  getUserById(@Param('id') userId: string) {
    return this.adminService.getUserById(userId);
  }

  @Delete('users/:id')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete user (Super Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  deleteUser(@Param('id') userId: string) {
    return this.adminService.deleteUser(userId);
  }

  // ============================================
  // BALANCE MANAGEMENT (NEW)
  // ============================================

  @Post('users/:id/balance')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Manage user balance - Add or subtract (Super Admin only)',
    description: 'Add or subtract balance from user account'
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Balance updated successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient balance for withdrawal' })
  manageUserBalance(
    @Param('id') userId: string,
    @Body() manageBalanceDto: ManageBalanceDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.adminService.manageUserBalance(userId, manageBalanceDto, adminId);
  }

  @Get('users/:id/balance')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get user balance detail (Admin only)',
    description: 'Get current balance, summary, and recent transactions'
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Returns user balance details' })
  getUserBalance(@Param('id') userId: string) {
    return this.adminService.getUserBalance(userId);
  }

  // ============================================
  // USER HISTORY (NEW)
  // ============================================

  @Get('users/:id/history')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get user complete history (Admin only)',
    description: 'Get all balance transactions and trading history'
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Returns complete user history' })
  getUserHistory(@Param('id') userId: string) {
    return this.adminService.getUserHistory(userId);
  }

  @Get('users/:id/trading-stats')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get user trading statistics (Admin only)',
    description: 'Get detailed trading performance by asset and direction'
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Returns trading statistics' })
  getUserTradingStats(@Param('id') userId: string) {
    return this.adminService.getUserTradingStats(userId);
  }

  // ============================================
  // SYSTEM STATISTICS (NEW)
  // ============================================

  @Get('statistics')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Get system-wide statistics (Super Admin only)',
    description: 'Get overall system statistics including users, trading, and financial data'
  })
  @ApiResponse({ status: 200, description: 'Returns system statistics' })
  getSystemStatistics() {
    return this.adminService.getSystemStatistics();
  }
}