// src/asset-schedule/dto/get-asset-schedules-query.dto.ts

import { IsOptional, IsInt, Min, Max, IsEnum, IsBoolean, IsString, IsDateString } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetAssetSchedulesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({ 
    example: 'BTCUSD',
    description: 'Filter by asset symbol' 
  })
  @IsOptional()
  @IsString()
  assetSymbol?: string;

  @ApiPropertyOptional({ 
    example: 'buy',
    enum: ['buy', 'sell'],
    description: 'Filter by trend direction' 
  })
  @IsOptional()
  @IsEnum(['buy', 'sell'])
  trend?: string;

  @ApiPropertyOptional({ 
    example: '1m',
    description: 'Filter by timeframe' 
  })
  @IsOptional()
  @IsString()
  timeframe?: string;

  @ApiPropertyOptional({ 
    example: 'pending',
    enum: ['pending', 'executed', 'failed', 'cancelled'],
    description: 'Filter by execution status' 
  })
  @IsOptional()
  @IsEnum(['pending', 'executed', 'failed', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ 
    example: true,
    description: 'Filter by active status' 
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ 
    example: '2024-02-01T00:00:00.000Z',
    description: 'Filter schedules from this date' 
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ 
    example: '2024-02-29T23:59:59.000Z',
    description: 'Filter schedules until this date' 
  })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}