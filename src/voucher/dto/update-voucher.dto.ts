// src/vouchers/dto/update-voucher.dto.ts
// ✅ COMPLETE UPDATE VOUCHER DTO

import { 
  IsNumber, 
  IsArray, 
  IsOptional, 
  IsBoolean, 
  IsDateString,
  IsString,
  Min,
  MaxLength,
  IsPositive
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVoucherDto {
  // Note: Code cannot be updated for consistency

  @ApiPropertyOptional({ 
    example: 15,
    description: 'Update bonus value'
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  value?: number;

  @ApiPropertyOptional({ 
    example: 50000,
    description: 'Update minimum deposit amount'
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minDeposit?: number;

  @ApiPropertyOptional({ 
    example: ['gold', 'vip'],
    description: 'Update eligible user statuses'
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleStatuses?: string[];

  @ApiPropertyOptional({ 
    example: 200,
    description: 'Update maximum uses'
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ 
    example: 2,
    description: 'Update max uses per user'
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiPropertyOptional({ 
    example: 200000,
    description: 'Update maximum bonus amount'
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxBonusAmount?: number;

  @ApiPropertyOptional({ 
    example: false,
    description: 'Update active status'
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ 
    example: '2024-02-01T00:00:00.000Z',
    description: 'Update valid from date'
  })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ 
    example: '2024-12-31T23:59:59.000Z',
    description: 'Update valid until date'
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ 
    example: 'Updated description',
    description: 'Update voucher description'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}