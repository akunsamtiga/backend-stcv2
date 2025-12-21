import { IsString, IsEnum, IsNumber, IsPositive, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ORDER_DIRECTION, ALL_DURATIONS } from '../../common/constants';

export class CreateBinaryOrderDto {
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

  @ApiProperty({ example: 1, description: 'Duration in minutes (1,2,3,4,5,15,30,45,60)' })
  @IsInt()
  @Min(1)
  duration: number;
}
