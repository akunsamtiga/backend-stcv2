// src/auto-lose-system/dto/update-auto-lose-config.dto.ts

import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  Max,
  IsArray,
  ValidateIf,
  IsIn,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateAutoLoseConfigDto {
  @ApiPropertyOptional({
    description: 'Aktifkan/nonaktifkan sistem AutoLose',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Killer Mode: jika true SEMUA order akan LOSE tanpa peduli filter lainnya',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  killerMode?: boolean;

  @ApiPropertyOptional({
    description: 'Target akun yang akan di-affect: demo, real, atau both',
    enum: ['demo', 'real', 'both'],
    example: 'both',
  })
  @IsOptional()
  @IsEnum(['demo', 'real', 'both'])
  targetAccountType?: 'demo' | 'real' | 'both';

  @ApiPropertyOptional({
    description: 'Target user berdasarkan status',
    type: [String],
    example: ['standard', 'gold'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(['standard', 'gold', 'vip'], { each: true })
  targetUserStatus?: ('standard' | 'gold' | 'vip')[];

  @ApiPropertyOptional({
    description: 'Jumlah minimum order (Rp) yang akan di-target. null = tidak ada minimum',
    example: 10000,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o) => o.minOrderAmount !== null)
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minOrderAmount?: number | null;

  @ApiPropertyOptional({
    description: 'Jumlah maksimum order (Rp) yang akan di-target. null = tidak ada batas',
    example: 5000000,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o) => o.maxOrderAmount !== null)
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxOrderAmount?: number | null;

  @ApiPropertyOptional({
    description:
      'Mode prioritas: highest_amount = urutan dari amount terbesar, all = semua langsung lose',
    enum: ['highest_amount', 'all'],
    example: 'highest_amount',
  })
  @IsOptional()
  @IsEnum(['highest_amount', 'all'])
  priorityMode?: 'highest_amount' | 'all';

  @ApiPropertyOptional({
    description:
      'Persentase order yang di-lose (dari yang paling besar). 100 = semua, 50 = 50% terbesar. Hanya relevan saat priorityMode=highest_amount',
    example: 100,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  losePercentage?: number;
}

export class ToggleAutoLoseDto {
  @ApiProperty({
    description: 'true = aktifkan, false = nonaktifkan',
    example: true,
  })
  @IsBoolean()
  isEnabled: boolean;
}

export class ToggleKillerModeDto {
  @ApiProperty({
    description: 'true = aktifkan killer mode (semua order lose), false = nonaktifkan',
    example: false,
  })
  @IsBoolean()
  killerMode: boolean;
}