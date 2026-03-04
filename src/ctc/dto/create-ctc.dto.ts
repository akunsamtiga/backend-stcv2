// src/ctc/dto/create-ctc.dto.ts

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

// ── Account type ───────────────────────────────────────────────────────────
export enum CtcAccountType {
  DEMO = 'demo',
  REAL = 'real',
}

// ── CTC is always 1m timeframe — fixed constant ───────────────────────────
export const CTC_TIMEFRAME    = '1m';
export const CTC_TIMEFRAME_SECONDS = 60;   // 1 candle = 60 seconds
export const CTC_ORDER_DURATION    = 1;    // duration value for binary order (1 minute)

// ── Martingale sub-DTO ─────────────────────────────────────────────────────
export class CtcMartingaleDto {
  @ApiProperty({ example: true, description: 'Aktifkan martingale saat kalah' })
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
export class CreateCtcDto {
  @ApiProperty({
    example: 'abc123xyz',
    description: 'ID aset dari Firestore. Harus punya realtimeDbPath dan data OHLC 1m.',
  })
  @IsString()
  @IsNotEmpty()
  assetId: string;

  @ApiProperty({
    enum: CtcAccountType,
    example: CtcAccountType.DEMO,
    description: 'Tipe akun trading (demo / real)',
  })
  @IsEnum(CtcAccountType)
  accountType: CtcAccountType;

  @ApiProperty({
    example: 50000,
    minimum: 10000,
    description:
      'Amount dasar per order (IDR). Minimum Rp 10.000. ' +
      'Dengan martingale, amount bisa bertambah hingga amount × multiplier^maxStep.',
  })
  @IsNumber()
  @Min(10000)
  amount: number;

  @ApiProperty({
    type: CtcMartingaleDto,
    description:
      'Pengaturan martingale. Saat kalah, amount dilipatkan dan arah ' +
      'mengikuti candle yang kalah (berlawanan dengan bet yang kalah).',
  })
  @ValidateNested()
  @Type(() => CtcMartingaleDto)
  martingale: CtcMartingaleDto;

  @ApiPropertyOptional({
    example: 500000,
    description: 'Stop otomatis bila total profit (kumulatif) mencapai nilai ini (IDR)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  stopProfit?: number;

  @ApiPropertyOptional({
    example: 200000,
    description: 'Stop otomatis bila total loss (kumulatif) mencapai nilai ini (IDR)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  stopLoss?: number;
}