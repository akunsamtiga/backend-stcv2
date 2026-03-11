// src/auth/dto/autotrade-login.dto.ts

import { IsEmail, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AutotradeLoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  password: string;

  @ApiPropertyOptional({
    example: 'AFFAB12CD34',
    description: `Kode affiliate (opsional). Jika diisi, sistem akan memverifikasi bahwa 
    user ID terdaftar di whitelist autotrade affiliator tersebut.
    Jika tidak diisi, sistem akan mencari whitelist dari semua affiliator.`,
  })
  @IsOptional()
  @IsString()
  affiliateCode?: string;
}