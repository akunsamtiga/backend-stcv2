// src/vouchers/dto/create-voucher.dto.ts

import { 
  IsString, 
  IsNumber, 
  IsEnum, 
  IsArray, 
  IsOptional, 
  IsBoolean, 
  IsDateString,
  Min,
  MinLength,
  MaxLength,
  IsPositive
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVoucherDto {
  @ApiProperty({ 
    example: 'BONUS10',
    description: 'Unique voucher code (will be converted to uppercase)',
    minLength: 3,
    maxLength: 20
  })
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  code: string;

  @ApiProperty({ 
    enum: ['percentage', 'fixed'],
    example: 'percentage',
    description: 'Type of bonus: percentage of deposit or fixed amount'
  })
  @IsEnum(['percentage', 'fixed'])
  type: 'percentage' | 'fixed';

  @ApiProperty({ 
    example: 10,
    description: 'Bonus value (percentage: 1-100, fixed: amount in IDR)'
  })
  @IsNumber()
  @IsPositive()
  value: number;

  @ApiProperty({ 
    example: 100000,
    description: 'Minimum deposit amount required to use voucher (in IDR)'
  })
  @IsNumber()
  @Min(0)
  minDeposit: number;

  @ApiPropertyOptional({ 
    example: ['standard', 'gold', 'vip'],
    description: 'User statuses eligible to use this voucher',
    default: ['standard', 'gold', 'vip']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleStatuses?: string[];

  @ApiPropertyOptional({ 
    example: 100,
    description: 'Maximum number of times voucher can be used (null = unlimited)',
    nullable: true
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ 
    example: 1,
    description: 'Maximum uses per user',
    default: 1
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiPropertyOptional({ 
    example: 100000,
    description: 'Maximum bonus amount (only for percentage type, null = no limit)',
    nullable: true
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxBonusAmount?: number;

  @ApiPropertyOptional({ 
    example: true,
    description: 'Whether voucher is active',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ 
    example: '2024-01-01T00:00:00.000Z',
    description: 'Start date of voucher validity (ISO 8601)'
  })
  @IsDateString()
  validFrom: string;

  @ApiProperty({ 
    example: '2024-12-31T23:59:59.000Z',
    description: 'End date of voucher validity (ISO 8601)'
  })
  @IsDateString()
  validUntil: string;

  @ApiPropertyOptional({ 
    example: 'Get 10% bonus on your deposits',
    description: 'Description of voucher for users'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}