// src/fast-trade/fast-trade.controller.ts

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
import { FastTradeService } from './fast-trade.service';
import { FastTradeExecutorService } from './fast-trade-executor.service';
import { CreateFastTradeDto } from './dto/create-fast-trade.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('FastTrade')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fast-trade')
export class FastTradeController {
  constructor(
    private readonly fastTradeService: FastTradeService,
    private readonly fastTradeExecutorService: FastTradeExecutorService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // CREATE — Start a new FastTrade session
  // ══════════════════════════════════════════════════════════════════════════

  @Post()
  @ApiOperation({
    summary: 'Start sesi FastTrade baru',
    description:
      'Memulai sesi FastTrade. Sesi akan langsung aktif dan menunggu candle ' +
      'berikutnya berdasarkan timeframe yang dipilih, lalu otomatis memasang ' +
      'order sesuai arah candle terakhir.',
  })
  @ApiResponse({ status: 201, description: 'Sesi berhasil dibuat dan aktif' })
  @ApiResponse({ status: 400, description: 'Validasi gagal / aset tidak valid' })
  @ApiResponse({ status: 409, description: 'Sudah ada sesi aktif — stop dulu' })
  async create(@Request() req: any, @Body() dto: CreateFastTradeDto) {
    const userId    = req.user.sub;
    const userEmail = req.user.email;
    return this.fastTradeService.createSession(userId, userEmail, dto);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET ALL — User's sessions (history)
  // ══════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'Daftar sesi FastTrade',
    description: 'Mendapatkan semua sesi FastTrade milik user (dengan filter opsional).',
  })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    type: Boolean,
    description: 'Jika true, hanya tampilkan sesi yang masih aktif',
  })
  @ApiResponse({ status: 200, description: 'Daftar sesi' })
  async findAll(
    @Request() req: any,
    @Query('activeOnly', new DefaultValuePipe(false), ParseBoolPipe) activeOnly: boolean,
  ) {
    const userId = req.user.sub;
    return this.fastTradeService.getUserSessions(userId, activeOnly);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET ACTIVE — Current active session
  // ══════════════════════════════════════════════════════════════════════════

  @Get('active')
  @ApiOperation({
    summary: 'Sesi FastTrade yang sedang aktif',
    description: 'Mendapatkan sesi FastTrade yang sedang berjalan (jika ada).',
  })
  @ApiResponse({ status: 200, description: 'Sesi aktif atau null' })
  async getActive(@Request() req: any) {
    const userId = req.user.sub;
    return this.fastTradeService.getUserActiveSession(userId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET ONE — Session detail
  // ══════════════════════════════════════════════════════════════════════════

  @Get(':id')
  @ApiOperation({
    summary: 'Detail sesi FastTrade',
    description: 'Mendapatkan detail lengkap satu sesi FastTrade.',
  })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Detail sesi' })
  @ApiResponse({ status: 404, description: 'Sesi tidak ditemukan' })
  async findOne(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.fastTradeService.getSession(userId, id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STOP — Stop the session
  // ══════════════════════════════════════════════════════════════════════════

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop sesi FastTrade',
    description:
      'Menghentikan sesi FastTrade. Order yang sedang berjalan tetap akan ' +
      'diselesaikan, tetapi tidak akan ada order baru yang dipasang.',
  })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Sesi berhasil dihentikan' })
  @ApiResponse({ status: 400, description: 'Sesi sudah berhenti' })
  @ApiResponse({ status: 404, description: 'Sesi tidak ditemukan' })
  async stop(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.fastTradeService.stopSession(userId, id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET EXECUTIONS — Trade history for a session
  // ══════════════════════════════════════════════════════════════════════════

  @Get(':id/executions')
  @ApiOperation({
    summary: 'Riwayat order FastTrade',
    description: 'Mendapatkan daftar semua order yang sudah dieksekusi dalam sesi ini.',
  })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Jumlah data (default: 50, max: 200)',
  })
  @ApiResponse({ status: 200, description: 'Daftar eksekusi' })
  @ApiResponse({ status: 404, description: 'Sesi tidak ditemukan' })
  async getExecutions(
    @Request() req: any,
    @Param('id') id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const userId = req.user.sub;
    return this.fastTradeService.getExecutions(userId, id, limit);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET OHLC — For frontend chart / candle direction display
  // ══════════════════════════════════════════════════════════════════════════

  @Get('ohlc/:assetId')
  @ApiOperation({
    summary: 'Ambil data OHLC candle',
    description:
      'Mengambil data candle terbaru untuk aset dan timeframe tertentu. ' +
      'Respons menyertakan arah candle terakhir yang selesai.',
  })
  @ApiParam({ name: 'assetId', description: 'Asset ID (Firestore doc ID)' })
  @ApiQuery({ name: 'timeframe', required: false, example: '1m', description: '1s, 1m, 5m, 15m, 30m, 1h, 4h, 1d' })
  @ApiQuery({ name: 'limit',     required: false, type: Number, example: 10 })
  @ApiResponse({ status: 200, description: 'Data OHLC candle' })
  async getOhlc(
    @Param('assetId') assetId: string,
    @Query('timeframe') timeframe: string = '1m',
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.fastTradeService.getOhlcData(assetId, timeframe, limit);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — Executor stats
  // ══════════════════════════════════════════════════════════════════════════

  @Get('admin/stats')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: '[Admin] Statistik FastTrade executor' })
  @ApiResponse({ status: 200, description: 'Stats' })
  async getStats() {
    return this.fastTradeExecutorService.getStats();
  }
}