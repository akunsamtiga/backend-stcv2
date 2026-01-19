// src/balance/dto/create-balance.dto.ts

import { IsEnum, IsNumber, IsPositive, IsOptional, IsString, Min, IsBoolean } from 'class-validator';
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

// ============================================
// WITHDRAWAL REQUEST DTO
// ============================================

export class RequestWithdrawalDto {
  @ApiProperty({ 
    example: 500000,
    description: 'Withdrawal amount (minimum Rp 100,000)'
  })
  @IsNumber()
  @IsPositive()
  @Min(100000, { message: 'Minimum withdrawal amount is Rp 100,000' })
  amount: number;

  @ApiPropertyOptional({ 
    example: 'Monthly withdrawal',
    description: 'Withdrawal description/notes (optional)'
  })
  @IsOptional()
  @IsString()
  description?: string;
}

// ============================================
// ADMIN APPROVAL DTO
// ============================================

export class ApproveWithdrawalDto {
  @ApiProperty({ 
    example: true,
    description: 'Approve (true) or reject (false) withdrawal'
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ 
    example: 'Withdrawal approved and processed',
    description: 'Admin notes (optional)'
  })
  @IsOptional()
  @IsString()
  adminNotes?: string;

  @ApiPropertyOptional({ 
    example: 'Insufficient documents or suspicious activity',
    description: 'Rejection reason (required if approve = false)'
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}