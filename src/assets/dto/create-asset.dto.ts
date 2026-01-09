// src/assets/dto/create-asset.dto.ts
// ✅ UPDATED: Support for 1 second duration

import { 
  IsString, IsNumber, IsBoolean, IsEnum, IsOptional, 
  Min, Max, IsArray, ValidateNested, IsInt 
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ✅ Simulator Settings DTO
export class SimulatorSettingsDto {
  @ApiProperty({ 
    example: 40.022, 
    description: 'Initial price for simulator' 
  })
  @IsNumber()
  @Min(0.001)
  initialPrice: number;

  @ApiProperty({ 
    example: 0.001, 
    description: 'Minimum daily volatility (percentage, e.g., 0.001 = 0.1%)' 
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  dailyVolatilityMin: number;

  @ApiProperty({ 
    example: 0.005, 
    description: 'Maximum daily volatility (percentage)' 
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  dailyVolatilityMax: number;

  @ApiProperty({ 
    example: 0.00001, 
    description: 'Minimum second volatility (percentage)' 
  })
  @IsNumber()
  @Min(0)
  @Max(0.01)
  secondVolatilityMin: number;

  @ApiProperty({ 
    example: 0.00008, 
    description: 'Maximum second volatility (percentage)' 
  })
  @IsNumber()
  @Min(0)
  @Max(0.01)
  secondVolatilityMax: number;

  @ApiPropertyOptional({ 
    example: 20.0, 
    description: 'Minimum allowed price (optional, default: 50% of initial)' 
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ 
    example: 80.0, 
    description: 'Maximum allowed price (optional, default: 200% of initial)' 
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;
}

// ✅ UPDATED: Trading Settings with 1 second support
export class TradingSettingsDto {
  @ApiProperty({ 
    example: 1000, 
    description: 'Minimum order amount in currency' 
  })
  @IsNumber()
  @Min(100)
  minOrderAmount: number;

  @ApiProperty({ 
    example: 1000000, 
    description: 'Maximum order amount in currency' 
  })
  @IsNumber()
  @Min(1000)
  maxOrderAmount: number;

  @ApiProperty({ 
    example: [0.0167, 1, 2, 3, 4, 5, 15, 30, 45, 60], 
    description: 'Allowed durations in minutes. Use 0.0167 for 1 second (will be displayed as "1s" in frontend)',
    type: [Number]
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0.0167, { each: true })
  allowedDurations: number[];
}

// ✅ MAIN: Create Asset DTO
export class CreateAssetDto {
  @ApiProperty({ 
    example: 'IDX STC', 
    description: 'Asset display name' 
  })
  @IsString()
  name: string;

  @ApiProperty({ 
    example: 'IDX_STC', 
    description: 'Asset symbol (unique identifier)' 
  })
  @IsString()
  symbol: string;

  @ApiProperty({ 
    example: 85, 
    description: 'Profit rate percentage (0-100)' 
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  profitRate: number;

  @ApiProperty({ 
    example: true, 
    description: 'Is asset active for trading' 
  })
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({ 
    enum: ['realtime_db', 'api', 'mock'], 
    example: 'realtime_db',
    description: 'Data source for price feeds'
  })
  @IsEnum(['realtime_db', 'api', 'mock'])
  dataSource: string;

  @ApiPropertyOptional({ 
    example: '/idx_stc',
    description: 'Firebase Realtime DB path (required if dataSource is realtime_db). Do NOT include /current_price suffix.'
  })
  @IsOptional()
  @IsString()
  realtimeDbPath?: string;

  @ApiPropertyOptional({ 
    example: 'https://api.example.com/price',
    description: 'API endpoint URL (required if dataSource is api)'
  })
  @IsOptional()
  @IsString()
  apiEndpoint?: string;

  @ApiPropertyOptional({ 
    example: 'Indonesian stock index with 1 second trading support',
    description: 'Asset description'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ 
    type: SimulatorSettingsDto,
    description: 'Simulator settings - controls price generation behavior'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SimulatorSettingsDto)
  simulatorSettings?: SimulatorSettingsDto;

  @ApiPropertyOptional({ 
    type: TradingSettingsDto,
    description: 'Trading constraints and allowed durations (including 1 second support with 0.0167 value)'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TradingSettingsDto)
  tradingSettings?: TradingSettingsDto;
}