// src/ctc/ctc.controller.ts

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
  ParseBoolPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CtcService } from './ctc.service';
import { CtcExecutorService } from './ctc-executor.service';
import { CreateCtcDto } from './dto/create-ctc.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('CTC (Copy The Candle)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ctc')
export class CtcController {
  constructor(
    private readonly ctcService: CtcService,
    private readonly ctcExecutorService: CtcExecutorService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // CREATE — Start sesi CTC baru
  // ══════════════════════════════════════════════════════════════════════════

  @Post()
  @ApiOperation({
    summary: 'Start sesi CTC baru',
    description: `
Memulai sesi **CTC (Copy The Candle)**. Sesi akan otomatis:

1. **Membaca** candle 1 menit terakhir dari Realtime DB
2. **Memasang order** sesuai arah candle (bullish → CALL, bearish → PUT)
3. **WIN** → langsung lanjutkan arah yang sama tanpa menunggu candle baru
4. **LOSE** → martingale: arah mengikuti candle yang kalah (berlawanan dengan bet yang kalah)
5. **LOSE maxStep** → reset amount, baca candle baru

Setiap menit selalu ada tepat satu order aktif.
    `.trim(),
  })
  @ApiResponse({
    status: 201,
    description: 'Sesi CTC berhasil dibuat dan aktif',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid-session-id',
          userId: 'user123',
          assetSymbol: 'EUR/USD',
          accountType: 'demo',
          baseAmount: 50000,
          martingaleEnabled: true,
          martingaleMaxStep: 3,
          martingaleMultiplier: 2,
          stopProfit: 500000,
          stopLoss: 200000,
          status: 'waiting',
          currentStep: 0,
          currentAmount: 50000,
          nextDirection: null,
          totalPnL: 0,
          wins: 0,
          losses: 0,
          totalOrders: 0,
          nextCandleAt: 1700000060,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Aset tidak valid / tidak punya data OHLC 1m' })
  @ApiResponse({ status: 409, description: 'Sudah ada sesi CTC aktif — stop dulu' })
  async create(@Request() req: any, @Body() dto: CreateCtcDto) {
    return this.ctcService.createSession(req.user.sub, req.user.email, dto);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET ALL — Riwayat sesi user
  // ══════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'Daftar sesi CTC milik user',
    description: 'Mendapatkan semua sesi CTC (history + aktif). Gunakan ?activeOnly=true untuk sesi aktif saja.',
  })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Daftar sesi' })
  async findAll(
    @Request() req: any,
    @Query('activeOnly', new DefaultValuePipe(false), ParseBoolPipe) activeOnly: boolean,
  ) {
    return this.ctcService.getUserSessions(req.user.sub, activeOnly);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET ACTIVE — Sesi yang sedang berjalan
  // ══════════════════════════════════════════════════════════════════════════

  @Get('active')
  @ApiOperation({
    summary: 'Sesi CTC yang sedang aktif',
    description: 'Mendapatkan sesi CTC yang sedang berjalan (null jika tidak ada).',
  })
  @ApiResponse({ status: 200, description: 'Sesi aktif atau null' })
  async getActive(@Request() req: any) {
    return this.ctcService.getUserActiveSession(req.user.sub);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET ONE — Detail sesi
  // ══════════════════════════════════════════════════════════════════════════

  @Get(':id')
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiOperation({ summary: 'Detail sesi CTC' })
  @ApiResponse({ status: 200, description: 'Detail sesi' })
  @ApiResponse({ status: 404, description: 'Sesi tidak ditemukan' })
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.ctcService.getSession(req.user.sub, id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STOP — Hentikan sesi
  // ══════════════════════════════════════════════════════════════════════════

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiOperation({
    summary: 'Stop sesi CTC',
    description:
      'Menghentikan sesi CTC. Order yang sedang berjalan akan tetap diselesaikan, ' +
      'tetapi tidak ada order baru yang akan dipasang.',
  })
  @ApiResponse({ status: 200, description: 'Sesi berhasil dihentikan' })
  @ApiResponse({ status: 400, description: 'Sesi sudah berhenti' })
  @ApiResponse({ status: 404, description: 'Sesi tidak ditemukan' })
  async stop(@Request() req: any, @Param('id') id: string) {
    return this.ctcService.stopSession(req.user.sub, id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET EXECUTIONS — Riwayat order per sesi
  // ══════════════════════════════════════════════════════════════════════════

  @Get(':id/executions')
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Default: 50, Max: 200' })
  @ApiOperation({
    summary: 'Riwayat order CTC',
    description:
      'Mendapatkan semua order yang sudah dieksekusi dalam sesi ini, ' +
      'termasuk flag isMartingaleRetry dan isWinContinue.',
  })
  @ApiResponse({ status: 200, description: 'Daftar eksekusi' })
  @ApiResponse({ status: 404, description: 'Sesi tidak ditemukan' })
  async getExecutions(
    @Request() req: any,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.ctcService.getExecutions(req.user.sub, id, limit);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET OHLC — Data candle 1m untuk chart / preview arah
  // ══════════════════════════════════════════════════════════════════════════

  @Get('ohlc/:assetId')
  @ApiParam({ name: 'assetId', description: 'Asset ID (Firestore doc ID)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Jumlah candle (default: 20, max: 100)' })
  @ApiOperation({
    summary: 'Data OHLC 1m untuk aset',
    description:
      'Mengambil candle 1 menit terbaru dari Realtime DB. ' +
      'Response menyertakan arah candle terakhir yang selesai ' +
      '(lastCompleted + direction) — inilah yang akan diikuti oleh CTC.',
  })
  @ApiResponse({
    status: 200,
    description: 'Data candle 1m',
    schema: {
      example: {
        success: true,
        data: {
          assetId: 'abc123',
          timeframe: '1m',
          candles: [
            { t: 1700000000, o: 1.0950, h: 1.0955, l: 1.0945, c: 1.0952, v: 5234 },
          ],
          lastCompleted: { t: 1700000000, o: 1.0950, h: 1.0955, l: 1.0945, c: 1.0952, v: 5234 },
          direction: 'bullish',
        },
      },
    },
  })
  async getOhlc(
    @Param('assetId') assetId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.ctcService.getOhlcData(assetId, limit);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — Stats executor
  // ══════════════════════════════════════════════════════════════════════════

  @Get('admin/stats')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiOperation({
    summary: '[Admin] Statistik CTC executor',
    description: 'Menampilkan total order, win/loss rate, dan lock status executor.',
  })
  @ApiResponse({ status: 200, description: 'Executor stats' })
  async getStats() {
    return this.ctcExecutorService.getStats();
  }
}