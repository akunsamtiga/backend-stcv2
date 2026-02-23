// src/affiliate-program/dto/affiliate-program.dto.ts

import {
  IsString, IsNotEmpty, IsNumber, IsOptional,
  Min, Max, IsBoolean, IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** Super Admin: assign a user as affiliator */
export class AssignAffiliatorDto {
  @ApiPropertyOptional({
    example: 50,
    description: 'Revenue share percentage for this affiliator (default: 50)',
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
    description: 'Number of depositing invitees needed to unlock commission balance (default: 5)',
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
    description: 'Revenue share percentage (1-100)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  revenueSharePercentage?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Number of depositing invitees required to unlock commission',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  unlockThreshold?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Enable or disable this affiliator program',
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

  @ApiPropertyOptional({ description: 'Filter by active/inactive programs' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}