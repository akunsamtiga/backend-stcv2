import { IsEnum, IsNumber, IsPositive, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BALANCE_TYPES } from '../../common/constants';

export class CreateBalanceDto {
  @ApiProperty({ enum: BALANCE_TYPES, example: 'deposit' })
  @IsEnum(BALANCE_TYPES)
  type: string;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ required: false, example: 'Monthly deposit' })
  @IsOptional()
  @IsString()
  description?: string;
}
