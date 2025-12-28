// src/binary-orders/dto/query-binary-order.dto.ts
// ✅ FIXED: Added accountType parameter

import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ORDER_STATUS, BALANCE_ACCOUNT_TYPE } from '../../common/constants';

export class QueryBinaryOrderDto {
  @ApiPropertyOptional({ 
    enum: ORDER_STATUS,
    description: 'Filter by order status'
  })
  @IsOptional()
  @IsEnum(ORDER_STATUS)
  status?: string;

  // ✅ NEW: Account type filter
  @ApiPropertyOptional({ 
    enum: BALANCE_ACCOUNT_TYPE,
    description: 'Filter by account type (real or demo)',
    example: 'demo'
  })
  @IsOptional()
  @IsEnum(BALANCE_ACCOUNT_TYPE)
  accountType?: string;

  @ApiPropertyOptional({ 
    default: 1,
    description: 'Page number',
    minimum: 1
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ 
    default: 20,
    description: 'Items per page',
    minimum: 1,
    maximum: 100
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}