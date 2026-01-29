// src/assets/dto/create-asset.dto.ts
import { 
  IsString, 
  IsNumber, 
  IsBoolean, 
  IsEnum, 
  IsOptional,
  ValidateNested,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ASSET_CATEGORY, ASSET_DATA_SOURCE, ASSET_TYPE } from '../../common/constants';

export class SimulatorSettingsDto {
  @ApiProperty({ 
    example: 640.0225387, 
    description: 'Initial price for simulator (supports high precision up to 10 decimal places)' 
  })
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0.0000000001)
  initialPrice: number;

  @ApiProperty({ 
    example: 0.00001, 
    description: 'Minimum daily volatility (percentage, supports high precision)' 
  })
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  @Max(1)
  dailyVolatilityMin: number;

  @ApiProperty({ 
    example: 0.00002, 
    description: 'Maximum daily volatility (percentage, supports high precision)' 
  })
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  @Max(1)
  dailyVolatilityMax: number;

  @ApiProperty({ 
    example: 0.00000001, 
    description: 'Minimum second volatility (percentage, supports very high precision)' 
  })
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  @Max(0.01)
  secondVolatilityMin: number;

  @ApiProperty({ 
    example: 0.00000002, 
    description: 'Maximum second volatility (percentage, supports very high precision)' 
  })
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  @Max(0.01)
  secondVolatilityMax: number;

  @ApiPropertyOptional({ 
    example: 640.0220, 
    description: 'Minimum allowed price (optional, high precision supported)' 
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ 
    example: 640.0229, 
    description: 'Maximum allowed price (optional, high precision supported)' 
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 10 })
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
    example: 'Euro vs US Dollar',
    description: 'Asset display name'
  })
  @IsString()
  name: string;

  @ApiProperty({ 
    example: 'EUR/USD',
    description: 'Asset symbol (unique identifier)'
  })
  @IsString()
  symbol: string;

  @ApiPropertyOptional({ 
    example: 'https://example.com/icons/eur-usd.png OR data:image/png;base64,...',
    description: 'Asset icon - URL or base64 image (max 2MB)'
  })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ 
    enum: ASSET_TYPE,
    example: 'forex',
    description: 'Asset type: forex, stock, commodity, crypto, or index'
  })
  @IsEnum(ASSET_TYPE)
  type: string;

  @ApiProperty({ 
    enum: ASSET_CATEGORY,
    example: 'normal',
    description: 'Asset category: normal (simulated) or crypto (real-time)'
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
    example: 'realtime_db',
    description: 'Data source: realtime_db, api, mock, or binance (for crypto)'
  })
  @IsEnum(ASSET_DATA_SOURCE)
  dataSource: string;

  @ApiPropertyOptional({ 
    example: '/assets/EUR_USD',
    description: 'Firebase Realtime DB path (auto-generated if not provided for crypto)'
  })
  @IsOptional()
  @IsString()
  realtimeDbPath?: string;

  @ApiPropertyOptional({ 
    example: 'https://api.example.com/price',
    description: 'API endpoint URL (for api data source only)'
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
    type: SimulatorSettingsDto,
    description: 'Simulator settings (for normal assets only) - Supports high precision numbers'
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

  @ApiPropertyOptional({ 
    example: 'Euro vs US Dollar pair for forex trading',
    description: 'Asset description'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ 
    example: 1.0950,
    description: 'Initial price for candle generation (alternative to simulatorSettings.initialPrice). Used when auto-generating 240 historical candles.'
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0.0000000001)
  initialPrice?: number;

  @ApiPropertyOptional({ 
    example: 0.001,
    description: 'Price volatility for candle generation (alternative to simulatorSettings.secondVolatilityMax). Default: 0.001 (0.1%)',
    default: 0.001
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0.0001)
  @Max(0.1)
  volatility?: number;

  @ApiPropertyOptional({ 
    example: 1.0850,
    description: 'Minimum price limit (alternative to simulatorSettings.minPrice)'
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ 
    example: 1.1050,
    description: 'Maximum price limit (alternative to simulatorSettings.maxPrice)'
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 10 })
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ 
    example: 6,
    description: 'Number of decimal places for price display',
    default: 6
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  decimalPlaces?: number;
}