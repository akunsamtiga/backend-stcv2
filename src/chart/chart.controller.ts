// src/chart/chart.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChartService } from './chart.service';
import { GetOhlcDto, TimeframeEnum } from './dto/get-ohlc.dto';
import { OHLCResponse } from './interfaces/candle.interface';

@ApiTags('chart')
@Controller('chart')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChartController {
  constructor(private chartService: ChartService) {}

  @Get(':assetId/ohlc')
  @ApiOperation({ 
    summary: 'Get OHLC candlestick data',
    description: 'Mengambil data candlestick historis untuk chart. Format compatible dengan TradingView Lightweight Charts.'
  })
  @ApiParam({ name: 'assetId', description: 'Asset ID (bisa cek di /assets)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Data candlestick siap digunakan',
    schema: {
      example: {
        assetId: 'asset_123',
        symbol: 'EUR/USD',
        timeframe: '1m',
        timezone: 'Asia/Jakarta',
        lastUpdate: 1706659200000,
        data: [
          {
            time: 1706659200,
            open: 1.0850,
            high: 1.0860,
            low: 1.0845,
            close: 1.0855,
            volume: 1250
          }
        ]
      }
    }
  })
  async getOHLC(
    @Param('assetId') assetId: string,
    @Query() query: GetOhlcDto,
  ): Promise<OHLCResponse> {
    return this.chartService.getOHLC(
      assetId,
      query.timeframe,
      query.limit,
      query.from,
      query.to
    );
  }

  @Get(':assetId/ohlc/lightweight')
  @ApiOperation({ 
    summary: 'Get OHLC formatted for Lightweight Charts',
    description: 'Format khusus untuk library TradingView Lightweight Charts (tanpa volume, sorted asc)'
  })
  async getOhlcLightweight(
    @Param('assetId') assetId: string,
    @Query() query: GetOhlcDto,
  ) {
    const data = await this.chartService.getOHLC(
      assetId,
      query.timeframe,
      query.limit,
      query.from,
      query.to
    );
    
    return {
      ...data,
      data: this.chartService.formatForLightweightCharts(data.data),
      // Info tambahan untuk frontend
      chartConfig: {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      }
    };
  }

  @Get('timeframes')
  @ApiOperation({ summary: 'Get available timeframes' })
  getTimeframes() {
    return {
      timeframes: Object.keys(TimeframeEnum),
      default: '1m',
      descriptions: {
        '1s': '1 Second (Ultra Fast)',
        '1m': '1 Minute',
        '5m': '5 Minutes',
        '15m': '15 Minutes',
        '30m': '30 Minutes',
        '1h': '1 Hour',
        '4h': '4 Hours',
        '1d': '1 Day',
      }
    };
  }
}