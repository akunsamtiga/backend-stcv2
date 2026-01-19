// src/balance/balance.controller.ts

import { Controller, Post, Get, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { BalanceService } from './balance.service';
import { CreateBalanceDto, RequestWithdrawalDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';
import { BALANCE_ACCOUNT_TYPE } from '../common/constants';

@ApiTags('balance')
@Controller('balance')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BalanceController {
  constructor(private balanceService: BalanceService) {}

  // ============================================
  // WITHDRAWAL REQUEST ENDPOINTS (NEW)
  // ============================================

  @Post('withdrawal/request')
  @ApiOperation({ 
    summary: 'Request withdrawal (Real account only)',
    description: `Submit withdrawal request with validation:
    • Minimum amount: Rp 100,000
    • KTP must be verified
    • Selfie must be verified
    • Bank account must be added
    • Sufficient balance required
    • Only one pending request allowed at a time`
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Withdrawal request submitted successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Withdrawal request submitted successfully. Waiting for admin approval.',
          request: {
            id: 'withdrawal_req_123',
            amount: 500000,
            status: 'pending',
            bankAccount: {
              bankName: 'Bank Mandiri',
              accountNumber: '******7890',
              accountHolderName: 'John Doe'
            },
            estimatedProcess: '1-2 business days',
            requirements: {
              minAmount: 'Rp 100,000',
              ktpVerified: '✅ Verified',
              selfieVerified: '✅ Verified',
              bankAccount: '✅ Added'
            },
            createdAt: '2024-01-01T00:00:00.000Z'
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Validation failed - insufficient balance, missing verification, pending request exists, etc.'
  })
  async requestWithdrawal(
    @CurrentUser('sub') userId: string,
    @Body() requestWithdrawalDto: RequestWithdrawalDto,
  ) {
    return this.balanceService.requestWithdrawal(
      userId, 
      requestWithdrawalDto.amount,
      requestWithdrawalDto.description
    );
  }

  @Get('withdrawal/my-requests')
  @ApiOperation({ 
    summary: 'Get my withdrawal requests',
    description: 'Get all withdrawal requests made by current user with status summary'
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
                accountNumber: '******7890',
                accountHolderName: 'John Doe'
              },
              ktpVerified: true,
              selfieVerified: true,
              currentBalance: 1000000,
              createdAt: '2024-01-01T00:00:00.000Z'
            }
          ],
          summary: {
            total: 5,
            pending: 1,
            approved: 0,
            rejected: 1,
            completed: 3
          }
        }
      }
    }
  })
  getMyWithdrawalRequests(@CurrentUser('sub') userId: string) {
    return this.balanceService.getMyWithdrawalRequests(userId);
  }

  @Delete('withdrawal/cancel/:id')
  @ApiOperation({ 
    summary: 'Cancel pending withdrawal request',
    description: 'Cancel your own pending withdrawal request. Only pending requests can be cancelled.'
  })
  @ApiParam({ name: 'id', description: 'Withdrawal request ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Withdrawal request cancelled successfully'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Cannot cancel - request not found, already processed, or unauthorized'
  })
  cancelWithdrawalRequest(
    @CurrentUser('sub') userId: string,
    @Param('id') requestId: string,
  ) {
    return this.balanceService.cancelWithdrawalRequest(userId, requestId);
  }

  // ============================================
  // GENERAL BALANCE OPERATIONS
  // ============================================

  @Post()
  @ApiOperation({ 
    summary: 'Create balance transaction',
    description: `Deposit or withdrawal for real or demo account.
    
    ⚠️ IMPORTANT: Direct withdrawal for REAL account is blocked. 
    Use POST /balance/withdrawal/request instead.
    
    Direct withdrawal is only allowed for DEMO account.`
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Balance transaction created successfully'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Direct withdrawal not allowed for real account - use withdrawal request'
  })
  createBalanceEntry(
    @CurrentUser('sub') userId: string,
    @Body() createBalanceDto: CreateBalanceDto,
  ) {
    return this.balanceService.createBalanceEntry(userId, createBalanceDto);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get balance history',
    description: 'Get all transactions or filter by account type'
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ 
    name: 'accountType', 
    required: false, 
    enum: ['real', 'demo'],
    description: 'Filter by account type (optional)'
  })
  getBalanceHistory(
    @CurrentUser('sub') userId: string,
    @Query() queryDto: QueryBalanceDto,
    @Query('accountType') accountType?: 'real' | 'demo',
  ) {
    return this.balanceService.getBalanceHistory(userId, queryDto, accountType);
  }

  @Get('summary')
  @ApiOperation({ 
    summary: 'Get complete balance summary',
    description: 'Get summary for both real and demo accounts including transaction statistics'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Balance summary retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          real: {
            currentBalance: 1000000,
            totalDeposits: 2000000,
            totalWithdrawals: 500000,
            totalOrderDebits: 300000,
            totalOrderProfits: 200000,
            totalAffiliateCommissions: 100000,
            transactionCount: 25
          },
          demo: {
            currentBalance: 9500000,
            totalDeposits: 10000000,
            totalWithdrawals: 0,
            totalOrderDebits: 300000,
            totalOrderProfits: 200000,
            transactionCount: 15
          },
          total: {
            transactionCount: 40,
            combinedBalance: 10500000
          }
        }
      }
    }
  })
  getBalanceSummary(@CurrentUser('sub') userId: string) {
    return this.balanceService.getBalanceSummary(userId);
  }

  // ============================================
  // SPECIFIC ACCOUNT TYPE ENDPOINTS
  // ============================================

  @Get('real')
  @ApiOperation({ 
    summary: 'Get REAL account balance',
    description: 'Get current real balance only'
  })
  async getRealBalance(@CurrentUser('sub') userId: string) {
    const balance = await this.balanceService.getCurrentBalance(
      userId, 
      BALANCE_ACCOUNT_TYPE.REAL
    );
    return { 
      accountType: 'real',
      balance 
    };
  }

  @Get('demo')
  @ApiOperation({ 
    summary: 'Get DEMO account balance',
    description: 'Get current demo balance only'
  })
  async getDemoBalance(@CurrentUser('sub') userId: string) {
    const balance = await this.balanceService.getCurrentBalance(
      userId, 
      BALANCE_ACCOUNT_TYPE.DEMO
    );
    return { 
      accountType: 'demo',
      balance 
    };
  }

  @Get('both')
  @ApiOperation({ 
    summary: 'Get both REAL and DEMO balances',
    description: 'Get both account balances in one request'
  })
  async getBothBalances(@CurrentUser('sub') userId: string) {
    return this.balanceService.getBothBalances(userId);
  }

  @Get('real/history')
  @ApiOperation({ 
    summary: 'Get REAL account transaction history'
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getRealBalanceHistory(
    @CurrentUser('sub') userId: string,
    @Query() queryDto: QueryBalanceDto,
  ) {
    return this.balanceService.getBalanceHistory(
      userId, 
      queryDto, 
      BALANCE_ACCOUNT_TYPE.REAL
    );
  }

  @Get('demo/history')
  @ApiOperation({ 
    summary: 'Get DEMO account transaction history'
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getDemoBalanceHistory(
    @CurrentUser('sub') userId: string,
    @Query() queryDto: QueryBalanceDto,
  ) {
    return this.balanceService.getBalanceHistory(
      userId, 
      queryDto, 
      BALANCE_ACCOUNT_TYPE.DEMO
    );
  }

  // ============================================
  // LEGACY ENDPOINT (backward compatibility)
  // ============================================

  @Get('current')
  @ApiOperation({ 
    summary: '[DEPRECATED] Get current balance',
    description: 'Returns both balances. Use /both instead.'
  })
  async getCurrentBalance(@CurrentUser('sub') userId: string) {
    const summary = await this.balanceService.getBothBalances(userId);
    return {
      deprecated: true,
      message: 'Use /balance/both for better clarity',
      ...summary
    };
  }
}