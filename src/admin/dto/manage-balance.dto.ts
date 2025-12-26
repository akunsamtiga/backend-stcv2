// src/admin/dto/manage-balance.dto.ts
import { IsNumber, IsPositive, IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ManageBalanceDto {
  @ApiProperty({ example: 'deposit', enum: ['deposit', 'withdrawal'] })
  @IsEnum(['deposit', 'withdrawal'])
  type: string;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 'Admin adjustment' })
  @IsString()
  description: string;
}