// src/order-schedule/dto/query-order-schedule.dto.ts

import { IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType, ScheduleStatus } from './create-order-schedule.dto';

export class QueryOrderScheduleDto {
  @ApiPropertyOptional({ 
    enum: AccountType,
    description: 'Filter berdasarkan tipe akun'
  })
  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  @ApiPropertyOptional({ 
    enum: ScheduleStatus,
    description: 'Filter berdasarkan status'
  })
  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @ApiPropertyOptional({ 
    description: 'Filter berdasarkan asset symbol'
  })
  @IsOptional()
  assetSymbol?: string;

  @ApiPropertyOptional({ 
    description: 'Filter dari tanggal (ISO format)'
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ 
    description: 'Filter sampai tanggal (ISO format)'
  })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}