// src/affiliate-program/autotrade-whitelist.controller.ts

import {
  Controller, Get, Post, Delete,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiParam, ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { AffiliateProgramService } from './affiliate-program.service';
import {
  AddAutotradeWhitelistDto,
  GetAutotradeWhitelistQueryDto,
} from './dto/autotrade-whitelist.dto';

@ApiTags('autotrade-whitelist')
@Controller('affiliate-program/autotrade')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AutotradeWhitelistController {
  constructor(private affiliateProgramService: AffiliateProgramService) {}

  // ── GET whitelist milik affiliator yang sedang login ──────────────────────

  @Get('whitelist')
  @ApiOperation({
    summary: 'Get daftar whitelist autotrade saya',
    description: `Menampilkan semua user ID yang sudah diwhitelist oleh affiliator ini.
    
    ⚠️ Hanya bisa diakses oleh user yang memiliki program affiliator aktif dengan fitur autotrade diaktifkan.`,
  })
  @ApiResponse({
    status: 200,
    description: 'Daftar whitelist',
    schema: {
      example: {
        success: true,
        data: {
          autotradeEnabled: true,
          withdrawalFeePercent: 5,
          whitelist: [
            {
              id: 'wl_001',
              userId: '12345',
              userEmail: 'user@example.com',
              note: 'Bot client saya',
              addedAt: '2024-01-01T00:00:00.000Z',
              isActive: true,
            },
          ],
          pagination: { page: 1, limit: 20, total: 3 },
          totalWhitelisted: 3,
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Bukan affiliator atau autotrade tidak diaktifkan' })
  getMyWhitelist(
    @CurrentUser('sub') userId: string,
    @Query() query: GetAutotradeWhitelistQueryDto,
  ) {
    return this.affiliateProgramService.getAutotradeWhitelist(userId, query);
  }

  // ── POST tambah user ke whitelist ─────────────────────────────────────────

  @Post('whitelist')
  @ApiOperation({
    summary: 'Tambah user ke whitelist autotrade',
    description: `Menambahkan user ID ke whitelist autotrade. User tersebut harus terdaftar di sistem.
    
    ⚠️ Dengan mengaktifkan autotrade, setiap penarikan komisi dikenakan **fee 5%**.`,
  })
  @ApiResponse({
    status: 201,
    description: 'User berhasil ditambahkan ke whitelist',
    schema: {
      example: {
        success: true,
        data: {
          message: 'User 12345 berhasil ditambahkan ke whitelist autotrade',
          entry: {
            id: 'wl_001',
            userId: '12345',
            userEmail: 'user@example.com',
            note: 'Bot client saya',
            addedAt: '2024-01-01T00:00:00.000Z',
            isActive: true,
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'User tidak ditemukan atau sudah ada di whitelist' })
  @ApiResponse({ status: 403, description: 'Bukan affiliator atau autotrade tidak diaktifkan' })
  addToWhitelist(
    @CurrentUser('sub') userId: string,
    @Body() dto: AddAutotradeWhitelistDto,
  ) {
    return this.affiliateProgramService.addToAutotradeWhitelist(userId, dto);
  }

  // ── DELETE hapus user dari whitelist ─────────────────────────────────────

  @Delete('whitelist/:targetUserId')
  @ApiOperation({
    summary: 'Hapus user dari whitelist autotrade',
    description: 'Menghapus user ID dari whitelist. User tersebut tidak bisa lagi menggunakan autotrade bot ini.',
  })
  @ApiParam({ name: 'targetUserId', description: 'User ID yang ingin dihapus dari whitelist' })
  @ApiResponse({ status: 200, description: 'User berhasil dihapus dari whitelist' })
  @ApiResponse({ status: 404, description: 'User tidak ditemukan di whitelist' })
  removeFromWhitelist(
    @CurrentUser('sub') userId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.affiliateProgramService.removeFromAutotradeWhitelist(userId, targetUserId);
  }

  // ── GET check apakah user ID diperbolehkan login autotrade ───────────────

  @Get('whitelist/check/:targetUserId')
  @ApiOperation({
    summary: 'Cek apakah user ID ada di whitelist',
    description: 'Endpoint untuk memeriksa apakah satu user ID sudah diwhitelist di program autotrade ini.',
  })
  @ApiParam({ name: 'targetUserId', description: 'User ID yang akan dicek' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        success: true,
        data: { userId: '12345', isWhitelisted: true },
      },
    },
  })
  checkWhitelist(
    @CurrentUser('sub') userId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.affiliateProgramService.checkAutotradeWhitelist(userId, targetUserId);
  }
}