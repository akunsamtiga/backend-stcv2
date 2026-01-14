// src/balance/balance.controller.ts

import { Controller, Post, Get, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { BalanceService } from './balance.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';
import { BALANCE_ACCOUNT_TYPE } from '../common/constants';

@ApiTags('balance')
@Controller('balance')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BalanceController {
  constructor(private balanceService: BalanceService) {}

  // ============================================
  // GENERAL BALANCE OPERATIONS
  // ============================================

  @Post()
  @ApiOperation({ 
    summary: 'Create balance transaction',
    description: 'Deposit or withdrawal for real or demo account'
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
    description: 'Get summary for both real and demo accounts'
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