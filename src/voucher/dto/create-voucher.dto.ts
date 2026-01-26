import { IsString, IsEnum, IsNumber, IsBoolean, IsOptional, IsArray, Min, Max, Length, IsISO8601, ArrayNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVoucherDto {
  @ApiProperty({ 
    example: 'BONUS10',
    description: 'Unique voucher code (uppercase, alphanumeric)'
  })
  @IsString()
  @Length(3, 20, { message: 'Voucher code must be between 3 and 20 characters' })
  code: string;

  @ApiProperty({ 
    enum: ['percentage', 'fixed'],
    example: 'percentage',
    description: 'Type: percentage of deposit or fixed amount'
  })
  @IsEnum(['percentage', 'fixed'])
  type: 'percentage' | 'fixed';

  @ApiProperty({ 
    example: 10,
    description: 'Value: percentage (1-100) or fixed amount in IDR'
  })
  @IsNumber()
  @Min(1, { message: 'Value must be at least 1' })
  @Max(100, { message: 'Percentage cannot exceed 100%' })
  value: number;

  @ApiProperty({ 
    example: 100000,
    description: 'Minimum deposit amount required to use this voucher'
  })
  @IsNumber()
  @Min(0)
  minDeposit: number;

  @ApiProperty({ 
    example: ['standard', 'gold'],
    description: 'Eligible user statuses. Use ["all"] for all statuses',
    type: [String]
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one eligible status is required' })
  @IsString({ each: true })
  eligibleStatuses: string[];

  @ApiPropertyOptional({ 
    example: 100,
    description: 'Maximum total usage limit (optional, unlimited if empty)'
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ 
    example: 1,
    description: 'Maximum usage per user (default: 1)',
    default: 1
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUsesPerUser?: number = 1;

  @ApiPropertyOptional({ 
    example: 500000,
    description: 'Maximum bonus amount cap for percentage type (optional)'
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxBonusAmount?: number;

  @ApiPropertyOptional({ 
    example: true,
    description: 'Is voucher active',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;

  @ApiProperty({ 
    example: '2024-01-01T00:00:00.000Z',
    description: 'Valid from date (ISO 8601)'
  })
  @IsISO8601()
  validFrom: string;

  @ApiProperty({ 
    example: '2024-12-31T23:59:59.000Z',
    description: 'Valid until date (ISO 8601)'
  })
  @IsISO8601()
  validUntil: string;

  @ApiPropertyOptional({ 
    example: 'Bonus deposit 10% untuk user baru',
    description: 'Voucher description'
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;
}