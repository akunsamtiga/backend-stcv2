// src/vouchers/dto/validate-voucher.dto.ts
import { IsString, IsNumber, IsPositive, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateVoucherDto {
  @ApiProperty({ 
    example: 'BONUS10',
    description: 'Voucher code to validate',
    minLength: 3,
    maxLength: 20
  })
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  code: string;

  @ApiProperty({ 
    example: 100000,
    description: 'Deposit amount in IDR'
  })
  @IsNumber()
  @IsPositive()
  depositAmount: number;
}