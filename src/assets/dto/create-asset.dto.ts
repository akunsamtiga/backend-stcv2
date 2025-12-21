import { IsString, IsNumber, IsBoolean, IsEnum, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAssetDto {
  @ApiProperty({ example: 'IDX STC' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'IDX_STC' })
  @IsString()
  symbol: string;

  @ApiProperty({ example: 85, description: 'Profit rate percentage (0-100)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  profitRate: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({ enum: ['realtime_db', 'api', 'mock'], example: 'realtime_db' })
  @IsEnum(['realtime_db', 'api', 'mock'])
  dataSource: string;

  @ApiPropertyOptional({ example: '/idx_stc/current_price' })
  @IsOptional()
  @IsString()
  realtimeDbPath?: string;

  @ApiPropertyOptional({ example: 'https://api.example.com/price' })
  @IsOptional()
  @IsString()
  apiEndpoint?: string;

  @ApiPropertyOptional({ example: 'Indonesian stock index' })
  @IsOptional()
  @IsString()
  description?: string;
}
