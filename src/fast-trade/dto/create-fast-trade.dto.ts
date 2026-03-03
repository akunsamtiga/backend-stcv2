// src/fast-trade/dto/create-fast-trade.dto.ts

import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsBoolean,
  IsOptional,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Timeframe ──────────────────────────────────────────────────────────────
export enum FastTradeTimeframe {
  ONE_MIN     = '1m',
  FIVE_MIN    = '5m',
  FIFTEEN_MIN = '15m',
  THIRTY_MIN  = '30m',
  ONE_HOUR    = '1h',
}

/** Timeframe → order duration in minutes (matched to ALL_DURATIONS) */
export const TIMEFRAME_DURATION_MAP: Record<FastTradeTimeframe, number> = {
  '1m':  1,
  '5m':  5,
  '15m': 15,
  '30m': 30,
  '1h':  60,
};

/** Timeframe → candle interval in seconds */
export const TIMEFRAME_SECONDS_MAP: Record<FastTradeTimeframe, number> = {
  '1m':  60,
  '5m':  300,
  '15m': 900,
  '30m': 1800,
  '1h':  3600,
};

// ── Account type ───────────────────────────────────────────────────────────
export enum FastTradeAccountType {
  DEMO = 'demo',
  REAL = 'real',
}

// ── Martingale sub-DTO ─────────────────────────────────────────────────────
export class FastTradeMartingaleDto {
  @ApiProperty({ example: false, description: 'Aktifkan martingale' })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    example: 3,
    minimum: 1,
    maximum: 10,
    description: 'Maksimum step martingale (1–10)',
  })
  @IsNumber()
  @Min(1)
  @Max(10)
  maxStep: number;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: 5,
    description: 'Multiplier amount per step (mis. 2 = 2× lipat)',
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  multiplier: number;
}

// ── Main create DTO ────────────────────────────────────────────────────────
export class CreateFastTradeDto {
  @ApiProperty({
    example: 'abc123xyz',
    description: 'ID aset dari Firestore (bukan symbol)',
  })
  @IsString()
  @IsNotEmpty()
  assetId: string;

  @ApiProperty({
    enum: FastTradeTimeframe,
    example: FastTradeTimeframe.ONE_MIN,
    description: 'Timeframe candle. Order dipasang di awal setiap candle.',
  })
  @IsEnum(FastTradeTimeframe)
  timeframe: FastTradeTimeframe;

  @ApiProperty({
    enum: FastTradeAccountType,
    example: FastTradeAccountType.DEMO,
    description: 'Tipe akun trading',
  })
  @IsEnum(FastTradeAccountType)
  accountType: FastTradeAccountType;

  @ApiProperty({
    example: 50000,
    minimum: 10000,
    description: 'Amount dasar per order (IDR). Min: Rp 10.000',
  })
  @IsNumber()
  @Min(10000)
  amount: number;

  @ApiProperty({
    type: FastTradeMartingaleDto,
    description: 'Pengaturan martingale',
  })
  @ValidateNested()
  @Type(() => FastTradeMartingaleDto)
  martingale: FastTradeMartingaleDto;

  @ApiPropertyOptional({
    example: 500000,
    description: 'Stop otomatis bila total profit mencapai nilai ini (IDR)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  stopProfit?: number;

  @ApiPropertyOptional({
    example: 200000,
    description: 'Stop otomatis bila total loss mencapai nilai ini (IDR)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  stopLoss?: number;
}