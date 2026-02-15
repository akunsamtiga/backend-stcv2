// src/binary-orders/dto/query-binary-order.dto.ts

import { IsOptional, IsEnum, IsInt, Min, Max, IsArray } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ORDER_STATUS, BALANCE_ACCOUNT_TYPE } from '../../common/constants';

export class QueryBinaryOrderDto {
  @ApiPropertyOptional({ 
    enum: ORDER_STATUS,
    description: 'Filter by order status. Bisa single (PENDING) atau multiple dipisah koma (PENDING,WON,LOST)',
    example: 'PENDING,WON,LOST'
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    // Kalau sudah array, langsung return
    if (Array.isArray(value)) return value.map((s: string) => s.trim());
    // Kalau string dengan koma, split jadi array
    if (typeof value === 'string' && value.includes(',')) {
      return value.split(',').map((s) => s.trim());
    }
    // Single value, bungkus jadi array supaya konsisten
    return [value.trim()];
  })
  @IsArray()
  @IsEnum(ORDER_STATUS, { each: true })
  status?: string[];

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