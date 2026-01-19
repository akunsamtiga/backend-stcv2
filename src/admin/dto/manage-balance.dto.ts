// src/admin/dto/manage-balance.dto.ts

import { IsNumber, IsPositive, IsString, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BALANCE_ACCOUNT_TYPE } from '../../common/constants';

// ============================================
// MANAGE BALANCE DTO (Admin direct balance management)
// ============================================

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

// ============================================
// APPROVE WITHDRAWAL DTO (Admin withdrawal approval)
// ============================================

export class ApproveWithdrawalDto {
  @ApiProperty({ 
    example: true,
    description: 'Approve (true) or reject (false) withdrawal request'
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ 
    example: 'Withdrawal approved and processed successfully',
    description: 'Admin notes/comments (optional)'
  })
  @IsOptional()
  @IsString()
  adminNotes?: string;

  @ApiPropertyOptional({ 
    example: 'Insufficient documents or suspicious activity detected',
    description: 'Rejection reason - REQUIRED when approve is false'
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}