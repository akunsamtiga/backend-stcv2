// src/payment/dto/create-deposit.dto.ts
import { IsNumber, IsPositive, IsString, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepositDto {
  @ApiProperty({ 
    example: 100000,
    description: 'Deposit amount in IDR (minimum Rp 10,000)'
  })
  @IsNumber()
  @IsPositive()
  @Min(10000, { message: 'Minimum deposit amount is Rp 10,000' })
  amount: number;

  @ApiPropertyOptional({ 
    example: 'Deposit for trading',
    description: 'Deposit description (optional)'
  })
  @IsOptional()
  @IsString()
  description?: string;
}