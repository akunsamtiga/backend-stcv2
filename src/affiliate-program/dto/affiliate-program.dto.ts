// src/affiliate-program/dto/affiliate-program.dto.ts

import {
  IsString, IsNumber, IsOptional,
  Min, Max, IsBoolean, IsInt, Matches, Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** Super Admin: assign a user as affiliator */
export class AssignAffiliatorDto {
  @ApiPropertyOptional({
    example: 'JOHNDOE',
    description: `Kode affiliate kustom (opsional).
    Jika diisi: 3–20 karakter, hanya huruf/angka/tanda hubung/underscore, disimpan dalam huruf besar.
    Jika tidak diisi: kode otomatis digenerate (format: AFF + 8 karakter alfanumerik).`,
    minLength: 3,
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @Length(3, 20, { message: 'Kode kustom harus antara 3–20 karakter' })
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Kode kustom hanya boleh mengandung huruf, angka, tanda hubung, dan underscore',
  })
  customCode?: string;

  @ApiPropertyOptional({
    example: 50,
    description: 'Persentase revenue share untuk affiliator ini (default: 50)',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  revenueSharePercentage?: number = 50;

  @ApiPropertyOptional({
    example: 5,
    description: 'Jumlah undangan yang harus deposit untuk membuka komisi (default: 5)',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  unlockThreshold?: number = 5;
}

/** Super Admin: update global or per-affiliator config */
export class UpdateAffiliatorConfigDto {
  @ApiPropertyOptional({
    example: 50,
    description: 'Persentase revenue share (1-100)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  revenueSharePercentage?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Jumlah undangan yang harus deposit untuk membuka komisi',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  unlockThreshold?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Aktifkan atau nonaktifkan program affiliator ini',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Query parameters for listing affiliators */
export class GetAffiliatorsQueryDto {
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

  @ApiPropertyOptional({ description: 'Filter program aktif/tidak aktif' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}