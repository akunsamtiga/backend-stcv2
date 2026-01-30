// src/asset-schedule/dto/create-asset-schedule.dto.ts

import { IsString, IsEnum, IsDateString, IsBoolean, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAssetScheduleDto {
  @ApiProperty({ 
    example: 'BTCUSD',
    description: 'Asset symbol to schedule'
  })
  @IsString()
  assetSymbol: string;

  @ApiProperty({ 
    example: '2024-02-01T12:14:00.000Z',
    description: 'Scheduled execution time (ISO 8601 format)'
  })
  @IsDateString()
  scheduledTime: string;

  @ApiProperty({ 
    example: 'sell',
    enum: ['buy', 'sell'],
    description: 'Trend direction: buy (naik) or sell (turun)'
  })
  @IsEnum(['buy', 'sell'])
  trend: string;

  @ApiProperty({ 
    example: '1m',
    enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
    description: 'Timeframe for the trend'
  })
  @IsIn(['1m', '5m', '15m', '30m', '1h', '4h', '1d'])
  timeframe: string;

  @ApiPropertyOptional({ 
    example: 'Schedule untuk manipulasi market saat news release',
    description: 'Optional notes about this schedule'
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ 
    example: true,
    description: 'Whether this schedule is active',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}