// src/affiliate-program/dto/autotrade-whitelist.dto.ts

import {
  IsString, IsNotEmpty, IsOptional,
  IsInt, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** Affiliator: tambah user ID ke whitelist autotrade */
export class AddAutotradeWhitelistDto {
  @ApiProperty({
    example: '12345',
    description: 'ID user yang ingin diwhitelist (numerik string)',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    example: 'Bot client saya - Budi Santoso',
    description: 'Catatan opsional untuk user ini',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

/** Query untuk list whitelist */
export class GetAutotradeWhitelistQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}