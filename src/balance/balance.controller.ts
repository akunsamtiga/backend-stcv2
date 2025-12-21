import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { BalanceService } from './balance.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';

@ApiTags('balance')
@Controller('balance')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BalanceController {
  constructor(private balanceService: BalanceService) {}

  @Post()
  @ApiOperation({ summary: 'Create balance transaction' })
  createBalanceEntry(
    @CurrentUser('sub') userId: string,
    @Body() createBalanceDto: CreateBalanceDto,
  ) {
    return this.balanceService.createBalanceEntry(userId, createBalanceDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get balance history with pagination' })
  getBalanceHistory(
    @CurrentUser('sub') userId: string,
    @Query() queryDto: QueryBalanceDto,
  ) {
    return this.balanceService.getBalanceHistory(userId, queryDto);
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current balance' })
  async getCurrentBalance(@CurrentUser('sub') userId: string) {
    const balance = await this.balanceService.getCurrentBalance(userId);
    return { balance };
  }
}
