import { IsString, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateVoucherDto {
  @ApiProperty({ example: 'BONUS10' })
  @IsString()
  code: string;

  @ApiProperty({ example: 100000 })
  @IsNumber()
  @Min(0)
  depositAmount: number;
}