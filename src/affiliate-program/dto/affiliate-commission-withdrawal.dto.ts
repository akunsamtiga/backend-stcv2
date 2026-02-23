// src/affiliate-program/dto/affiliate-commission-withdrawal.dto.ts

import {
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** Affiliator: Request withdrawal of commission balance */
export class RequestCommissionWithdrawalDto {
  @ApiProperty({
    example: 150000,
    description: 'Amount to withdraw from commission balance (minimum Rp 50,000)',
  })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({
    example: 'Penarikan komisi bulan Januari',
    description: 'Optional note for this withdrawal request',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

/** Super Admin: Approve or reject a commission withdrawal */
export class ApproveCommissionWithdrawalDto {
  @ApiProperty({
    example: true,
    description: 'Approve (true) or reject (false) the withdrawal request',
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({
    example: 'Approved and transferred to bank account',
    description: 'Admin notes (optional)',
  })
  @IsOptional()
  @IsString()
  adminNotes?: string;

  @ApiPropertyOptional({
    example: 'Insufficient verification documents',
    description: 'Rejection reason — REQUIRED when approve is false',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

/** Query params for listing commission withdrawals */
export class GetCommissionWithdrawalsQueryDto {
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

  @ApiPropertyOptional({
    enum: ['pending', 'approved', 'rejected', 'completed'],
    description: 'Filter by status',
  })
  @IsOptional()
  @IsString()
  status?: string;
}