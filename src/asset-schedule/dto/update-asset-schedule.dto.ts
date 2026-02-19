// src/asset-schedule/dto/update-asset-schedule.dto.ts

import { IsString, IsEnum, IsDateString, IsBoolean, IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAssetScheduleDto {
  @ApiPropertyOptional({ example: 'BTCUSD', description: 'Asset symbol to schedule' })
  @IsOptional()
  @IsString()
  assetSymbol?: string;

  @ApiPropertyOptional({ example: '2024-02-01T12:14:00.000Z', description: 'Scheduled execution time (ISO 8601 format)' })
  @IsOptional()
  @IsDateString()
  scheduledTime?: string;

  @ApiPropertyOptional({ example: 'sell', enum: ['buy', 'sell'], description: 'Trend direction: buy (naik) or sell (turun)' })
  @IsOptional()
  @IsEnum(['buy', 'sell'])
  trend?: string;

  @ApiPropertyOptional({ example: '1m', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'], description: 'Timeframe for the trend' })
  @IsOptional()
  @IsIn(['1m', '5m', '15m', '30m', '1h', '4h', '1d'])
  timeframe?: string;

  @ApiPropertyOptional({ example: 'Updated schedule notes', description: 'Optional notes about this schedule' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: true, description: 'Whether this schedule is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}