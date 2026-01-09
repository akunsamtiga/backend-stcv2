// src/binary-orders/dto/create-binary-order.dto.ts
// ✅ UPDATED: Support for 1 second (0.0167 minutes)

import { IsString, IsEnum, IsNumber, IsPositive, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ORDER_DIRECTION, ALL_DURATIONS, BALANCE_ACCOUNT_TYPE } from '../../common/constants';

export class CreateBinaryOrderDto {
  @ApiProperty({ 
    enum: BALANCE_ACCOUNT_TYPE, 
    example: 'demo',
    description: 'Account type to use: real or demo'
  })
  @IsEnum(BALANCE_ACCOUNT_TYPE)
  accountType: string;

  @ApiProperty({ example: 'asset_id_here' })
  @IsString()
  asset_id: string;

  @ApiProperty({ enum: ORDER_DIRECTION, example: 'CALL' })
  @IsEnum(ORDER_DIRECTION)
  direction: string;

  @ApiProperty({ example: 1000 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ 
    example: 1, 
    description: 'Duration in minutes. Use 0.0167 for 1 second, or standard values: 1,2,3,4,5,15,30,45,60 minutes. Frontend will display 0.0167 as "1s"' 
  })
  @IsNumber()
  @Min(0.0167) // ✅ Allow 1 second = 0.0167 minutes
  duration: number;
}