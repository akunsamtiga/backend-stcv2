// src/order-schedule/dto/create-order-schedule.dto.ts

import { 
  IsString, 
  IsNotEmpty, 
  IsNumber, 
  IsEnum, 
  IsArray, 
  ValidateNested, 
  Min, 
  Max,
  IsBoolean,
  IsOptional,
  ArrayMinSize
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AccountType {
  DEMO = 'demo',
  REAL = 'real'
}

export enum TrendType {
  BUY = 'buy',
  SELL = 'sell'
}

export enum ScheduleStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

export class ScheduleTimeDto {
  @ApiProperty({ 
    example: '12:20',
    description: 'Waktu eksekusi dalam format HH:mm (24 jam)'
  })
  @IsString()
  @IsNotEmpty()
  time: string; // Format: "HH:mm"

  @ApiProperty({ 
    enum: TrendType,
    example: TrendType.BUY,
    description: 'Tipe trend: buy atau sell'
  })
  @IsEnum(TrendType)
  trend: TrendType; // 'buy' atau 'sell'
}

export class MartingaleSettingDto {
  @ApiProperty({ 
    example: 3,
    description: 'Maksimum langkah martingale (0 = tidak ada martingale)',
    minimum: 0,
    maximum: 10
  })
  @IsNumber()
  @Min(0)
  @Max(10)
  maxStep: number;

  @ApiProperty({ 
    example: 2,
    description: 'Multiplier untuk setiap step martingale',
    minimum: 1.1,
    maximum: 5
  })
  @IsNumber()
  @Min(1.1)
  @Max(5)
  multiplier: number;
}

export class StopLossProfitDto {
  @ApiPropertyOptional({ 
    example: 1000000,
    description: 'Stop profit - berhenti jika profit mencapai jumlah ini (IDR)',
    minimum: 0,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stopProfit?: number;

  @ApiPropertyOptional({ 
    example: 500000,
    description: 'Stop loss - berhenti jika loss mencapai jumlah ini (IDR)',
    minimum: 0,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stopLoss?: number;
}

export class CreateOrderScheduleDto {
  @ApiProperty({ 
    example: 'EURUSD',
    description: 'Symbol aset yang dipilih'
  })
  @IsString()
  @IsNotEmpty()
  assetSymbol: string;

  @ApiProperty({ 
    enum: AccountType,
    example: AccountType.DEMO,
    description: 'Tipe akun: demo atau real'
  })
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiProperty({ 
    example: 60,
    description: 'Durasi order dalam detik (misal: 60 untuk 1 menit)',
    minimum: 30,
    maximum: 3600
  })
  @IsNumber()
  @Min(30)
  @Max(3600)
  duration: number; // dalam detik

  @ApiProperty({ 
    example: 10000,
    description: 'Jumlah/amount untuk setiap order (IDR)',
    minimum: 10000
  })
  @IsNumber()
  @Min(10000)
  amount: number;

  @ApiProperty({ 
    type: [ScheduleTimeDto],
    example: [
      { time: '12:20', trend: 'buy' },
      { time: '14:30', trend: 'sell' },
      { time: '16:45', trend: 'buy' }
    ],
    description: 'Array jadwal eksekusi order'
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Minimal harus ada 1 jadwal' })
  @ValidateNested({ each: true })
  @Type(() => ScheduleTimeDto)
  schedules: ScheduleTimeDto[];

  @ApiProperty({ 
    type: MartingaleSettingDto,
    example: { maxStep: 3, multiplier: 2 },
    description: 'Pengaturan martingale'
  })
  @ValidateNested()
  @Type(() => MartingaleSettingDto)
  martingaleSetting: MartingaleSettingDto;

  @ApiProperty({ 
    type: StopLossProfitDto,
    example: { stopProfit: 1000000, stopLoss: 500000 },
    description: 'Pengaturan stop loss dan stop profit'
  })
  @ValidateNested()
  @Type(() => StopLossProfitDto)
  stopLossProfit: StopLossProfitDto;

  @ApiPropertyOptional({ 
    example: true,
    description: 'Apakah schedule ini aktif (default: true)',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ 
    example: 'Schedule untuk trading harian',
    description: 'Catatan atau deskripsi schedule (opsional)'
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

