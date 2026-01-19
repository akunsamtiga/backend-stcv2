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
import { ManageBalanceDto, ApproveWithdrawalDto } from './dto/manage-balance.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private adminService: AdminService) {}

  // ============================================
  // WITHDRAWAL MANAGEMENT (NEW)
  // ============================================

  @Get('withdrawals')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get all withdrawal requests (Admin only)',
    description: 'Get all withdrawal requests with optional status filter. Returns summary and detailed list.'
  })
  @ApiQuery({ 
    name: 'status', 
    required: false, 
    enum: ['pending', 'approved', 'rejected', 'completed'],
    description: 'Filter by status (optional)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Withdrawal requests retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          requests: [
            {
              id: 'withdrawal_req_123',
              user_id: 'user_123',
              amount: 500000,
              status: 'pending',
              description: 'Monthly withdrawal',
              userEmail: 'user@example.com',
              userName: 'John Doe',
              bankAccount: {
                bankName: 'Bank Mandiri',
                accountNumber: '1234567890',
                accountHolderName: 'John Doe'
              },
              ktpVerified: true,
              selfieVerified: true,
              currentBalance: 1000000,
              createdAt: '2024-01-01T00:00:00.000Z'
            }
          ],
          summary: {
            total: 10,
            pending: 3,
            approved: 0,
            rejected: 2,
            completed: 5
          }
        }
      }
    }
  })
  getAllWithdrawalRequests(@Query('status') status?: string) {
    return this.adminService.getAllWithdrawalRequests(status);
  }

  @Get('withdrawals/:id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Get withdrawal request detail (Admin only)',
    description: 'Get detailed information about specific withdrawal request including user details'
  })
  @ApiParam({ name: 'id', description: 'Withdrawal request ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Withdrawal request detail retrieved successfully'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Withdrawal request not found'
  })
  getWithdrawalRequestById(@Param('id') requestId: string) {
    return this.adminService.getWithdrawalRequestById(requestId);
  }

  @Post('withdrawals/:id/approve')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({ 
    summary: 'Approve or reject withdrawal request (Admin only)',
    description: `Process withdrawal request:
    
    **APPROVE (approve: true):**
    • Validates current balance is still sufficient
    • Creates withdrawal balance entry
    • Updates request status to COMPLETED
    • User balance is automatically deducted
    
    **REJECT (approve: false):**
    • Requires rejection reason
    • Updates request status to REJECTED
    • User balance remains unchanged
    • User can submit new request`
  })
  @ApiParam({ name: 'id', description: 'Withdrawal request ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Withdrawal processed successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Withdrawal approved and processed successfully',
          request: {
            id: 'withdrawal_req_123',
            amount: 500000,
            status: 'completed',
            user: {
              email: 'user@example.com',
              name: 'John Doe'
            },
            bankAccount: {
              bankName: 'Bank Mandiri',
              accountNumber: '1234567890',
              accountHolderName: 'John Doe'
            },
            reviewedBy: 'admin_123',
            reviewedAt: '2024-01-01T00:00:00.000Z',
            newBalance: 500000
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid request - already processed, insufficient balance, or missing rejection reason'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Withdrawal request not found'
  })
  approveWithdrawal(
    @Param('id') requestId: string,
    @Body() approveDto: ApproveWithdrawalDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.adminService.approveWithdrawal(requestId, approveDto, adminId);
  }

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
  // BALANCE MANAGEMENT
  // ============================================

  @Post('users/:id/balance')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Manage user balance - Add or subtract (Super Admin only)',
    description: `Add or subtract balance from user account.
    
    ⚠️ NOTE: For REAL account withdrawals via admin, this bypasses the withdrawal request system.
    Normal users must use the withdrawal request system.`
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
  // USER HISTORY
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
  // SYSTEM STATISTICS
  // ============================================

  @Get('statistics')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Get system-wide statistics (Super Admin only)',
    description: 'Get overall system statistics including users, trading, financial data, and withdrawal requests'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns system statistics',
    schema: {
      example: {
        success: true,
        data: {
          users: {
            total: 100,
            active: 85,
            admins: 5,
            statusDistribution: {
              standard: 70,
              gold: 20,
              vip: 10
            }
          },
          affiliate: {
            totalReferrals: 50,
            completedReferrals: 30,
            pendingReferrals: 20,
            totalCommissionsPaid: 1500000,
            commissionRate: 25000,
            conversionRate: 60
          },
          withdrawal: {
            totalRequests: 25,
            pending: 5,
            approved: 0,
            rejected: 3,
            completed: 17,
            totalAmount: 8500000
          },
          realAccount: {
            trading: {
              totalOrders: 500,
              activeOrders: 10,
              wonOrders: 280,
              lostOrders: 210,
              totalVolume: 50000000,
              totalProfit: 5000000,
              winRate: 57
            },
            financial: {
              totalDeposits: 100000000,
              totalWithdrawals: 8500000,
              affiliateCommissions: 1500000,
              netFlow: 90000000
            }
          },
          demoAccount: {
            trading: {
              totalOrders: 1200,
              activeOrders: 25,
              wonOrders: 650,
              lostOrders: 525,
              totalVolume: 120000000,
              totalProfit: 10000000,
              winRate: 55
            },
            financial: {
              totalDeposits: 1000000000,
              totalWithdrawals: 0,
              netFlow: 1000000000
            }
          },
          combined: {
            totalOrders: 1700,
            totalVolume: 170000000,
            totalProfit: 15000000
          },
          timestamp: '2024-01-01T00:00:00.000Z'
        }
      }
    }
  })
  getSystemStatistics() {
    return this.adminService.getSystemStatistics();
  }
}