// src/assets/dto/create-asset.dto.ts

import { 
  IsString, IsNumber, IsBoolean, IsEnum, IsOptional, 
  Min, Max, IsArray, ValidateNested, IsInt, IsUrl 
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ASSET_CATEGORY, ASSET_DATA_SOURCE } from '../../common/constants';

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
    description: 'Minimum daily volatility (percentage)' 
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
    description: 'Minimum allowed price (optional)' 
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ 
    example: 80.0, 
    description: 'Maximum allowed price (optional)' 
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;
}

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
    description: 'Allowed durations in minutes. Use 0.0167 for 1 second',
    type: [Number]
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0.0167, { each: true })
  allowedDurations: number[];
}

export class CryptoConfigDto {
  @ApiProperty({ 
    example: 'BTC',
    description: 'Base currency (e.g., BTC, ETH, BNB)'
  })
  @IsString()
  baseCurrency: string;

  @ApiProperty({ 
    example: 'USD',
    description: 'Quote currency (e.g., USD, USDT, EUR)'
  })
  @IsString()
  quoteCurrency: string;

  @ApiPropertyOptional({ 
    example: 'Binance',
    description: 'Optional: Specific exchange to use'
  })
  @IsOptional()
  @IsString()
  exchange?: string;
}

export class CreateAssetDto {
  @ApiProperty({ 
    example: 'Bitcoin',
    description: 'Asset display name' 
  })
  @IsString()
  name: string;

  @ApiProperty({ 
    example: 'BTC/USD',
    description: 'Asset symbol (unique identifier)' 
  })
  @IsString()
  symbol: string;

  // ✅ TAMBAHKAN ICON
  @ApiPropertyOptional({ 
    example: 'https://example.com/icons/btc.png OR data:image/png;base64,...',
    description: 'Asset icon - URL or base64 image (max 2MB)' 
  })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ 
    enum: ASSET_CATEGORY,
    example: 'crypto',
    description: 'Asset category: normal or crypto'
  })
  @IsEnum(ASSET_CATEGORY)
  category: string;

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
    enum: ASSET_DATA_SOURCE,
    example: 'binance',
    description: 'Data source: realtime_db, api, mock, or binance (for crypto)'
  })
  @IsEnum(ASSET_DATA_SOURCE)
  dataSource: string;

  @ApiPropertyOptional({ 
    example: '/crypto/btc_usd',
    description: 'Firebase Realtime DB path'
  })
  @IsOptional()
  @IsString()
  realtimeDbPath?: string;

  @ApiPropertyOptional({ 
    example: 'https://api.example.com/price',
    description: 'API endpoint URL (for api data source only, not for crypto)'
  })
  @IsOptional()
  @IsString()
  apiEndpoint?: string;

  @ApiPropertyOptional({ 
    type: CryptoConfigDto,
    description: 'Crypto configuration (required for crypto category)'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CryptoConfigDto)
  cryptoConfig?: CryptoConfigDto;

  @ApiPropertyOptional({ 
    example: 'Bitcoin - Leading cryptocurrency',
    description: 'Asset description'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ 
    type: SimulatorSettingsDto,
    description: 'Simulator settings (for normal assets only)'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SimulatorSettingsDto)
  simulatorSettings?: SimulatorSettingsDto;

  @ApiPropertyOptional({ 
    type: TradingSettingsDto,
    description: 'Trading constraints and allowed durations'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TradingSettingsDto)
  tradingSettings?: TradingSettingsDto;
}