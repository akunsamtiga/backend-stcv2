// src/balance/dto/create-balance.dto.ts

import { IsEnum, IsNumber, IsPositive, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BALANCE_TYPES, BALANCE_ACCOUNT_TYPE } from '../../common/constants';

export class CreateBalanceDto {
  @ApiProperty({ 
    enum: BALANCE_ACCOUNT_TYPE, 
    example: 'real',
    description: 'Account type: real or demo'
  })
  @IsEnum(BALANCE_ACCOUNT_TYPE)
  accountType: string;

  @ApiProperty({ 
    enum: BALANCE_TYPES, 
    example: 'deposit',
    description: 'Type of balance transaction'
  })
  @IsEnum(BALANCE_TYPES)
  type: string;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ 
    required: false, 
    example: 'Monthly deposit' 
  })
  @IsOptional()
  @IsString()
  description?: string;
}