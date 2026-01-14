// src/admin/dto/manage-balance.dto.ts

import { IsNumber, IsPositive, IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BALANCE_ACCOUNT_TYPE } from '../../common/constants';

export class ManageBalanceDto {
  @ApiProperty({ 
    enum: BALANCE_ACCOUNT_TYPE,
    example: 'demo',
    description: 'Account type: real or demo'
  })
  @IsEnum(BALANCE_ACCOUNT_TYPE)
  accountType: string;

  @ApiProperty({ 
    example: 'deposit', 
    enum: ['deposit', 'withdrawal'],
    description: 'Transaction type'
  })
  @IsEnum(['deposit', 'withdrawal'])
  type: string;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 'Admin adjustment for demo account' })
  @IsString()
  description: string;
}