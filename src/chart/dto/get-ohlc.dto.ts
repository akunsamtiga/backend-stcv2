// src/chart/dto/get-ohlc.dto.ts
import { IsNumber, IsOptional, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TimeframeEnum {
  '1s' = '1s',
  '1m' = '1m',
  '5m' = '5m',
  '15m' = '15m',
  '30m' = '30m',
  '1h' = '1h',
  '4h' = '4h',
  '1d' = '1d',
}

export class GetOhlcDto {
  @ApiProperty({ enum: TimeframeEnum, example: '1m' })
  @IsEnum(TimeframeEnum)
  timeframe: string;

  @ApiPropertyOptional({ 
    description: 'Limit jumlah candle (default: 240, max: 1000)',
    default: 240 
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 240;

  @ApiPropertyOptional({ 
    description: 'Timestamp mulai (unix seconds)',
    example: 1704067200 
  })
  @IsOptional()
  @IsNumber()
  from?: number;

  @ApiPropertyOptional({ 
    description: 'Timestamp akhir (unix seconds). Default: now',
    example: 1706659200 
  })
  @IsOptional()
  @IsNumber()
  to?: number;
}