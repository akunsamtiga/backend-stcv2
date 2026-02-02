// src/chart/dto/subscribe-chart.dto.ts
import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TimeframeEnum } from './get-ohlc.dto';

export class SubscribeChartDto {
  @ApiProperty({ example: 'asset_id_123' })
  @IsString()
  assetId: string;

  @ApiProperty({ enum: TimeframeEnum, example: '1m' })
  @IsEnum(TimeframeEnum)
  timeframe: string;
}