// src/affiliate-program/affiliate-program.controller.ts

import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { AffiliateProgramService } from './affiliate-program.service';
import { RequestCommissionWithdrawalDto } from './dto/affiliate-commission-withdrawal.dto';

@ApiTags('affiliate-program')
@Controller('affiliate-program')
export class AffiliateProgramController {
  constructor(private affiliateProgramService: AffiliateProgramService) {}

  // ── Public (no auth) ──────────────────────────────────────────────────────

  @Get('public/:code')
  @ApiOperation({
    summary: 'Get affiliator display name by affiliate code (public)',
    description: 'Digunakan halaman registrasi untuk menampilkan nama pengundang. Tidak memerlukan autentikasi.',
  })
  @ApiParam({ name: 'code', description: 'Affiliate code' })
  @ApiResponse({
    status: 200,
    description: 'Nama affiliator',
    schema: { example: { success: true, data: { name: 'John Doe' } } },
  })
  @ApiResponse({ status: 404, description: 'Kode affiliate tidak ditemukan' })
  getAffiliatorPublicInfo(@Param('code') code: string) {
    return this.affiliateProgramService.getAffiliatorPublicInfo(code);
  }

  // ── Dashboard (auth required) ─────────────────────────────────────────────

  @Get('my-program')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get my affiliator program dashboard',
    description: `Returns the current user's affiliator program info, including:
    - Unique affiliate code to share
    - Commission balance (locked/unlocked status)
    - Unlock progress (how many invited depositors are needed)
    - Summary statistics
    
    ⚠️ Only accessible to users with an active affiliator program assigned by the Super Admin.`,
  })
  @ApiResponse({
    status: 200,
    description: 'Affiliator dashboard',
    schema: {
      example: {
        success: true,
        data: {
          affiliateCode: 'AFFAB12CD34',
          isCommissionUnlocked: false,
          revenueSharePercentage: 50,
          balances: {
            commissionBalance: 0,
            lockedCommissionBalance: 0,
            isLocked: true,
          },
          unlockProgress: {
            current: 3,
            required: 5,
            percentage: 60,
            isUnlocked: false,
            message: 'Invite 2 more user(s) who complete a deposit to unlock your commission balance.',
          },
          stats: {
            totalInvited: 5,
            depositedInvites: 3,
            pendingInvites: 2,
            totalCommissionEarned: 0,
            totalCommissionWithdrawn: 0,
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Not an affiliator' })
  getMyProgram(@CurrentUser('sub') userId: string) {
    return this.affiliateProgramService.getMyProgram(userId);
  }

  // ── Invites ───────────────────────────────────────────────────────────────

  @Get('my-invites')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get list of users I invited',
    description: 'Returns all users who registered using your affiliate code, with deposit status. Email addresses are masked for privacy.',
  })
  @ApiResponse({
    status: 200,
    description: 'Invited users list',
    schema: {
      example: {
        success: true,
        data: {
          invites: [
            {
              id: 'invite_123',
              inviteeId: 'user_789',
              inviteeEmail: 'j***e@gmail.com',
              hasDeposited: true,
              firstDepositAt: '2024-01-15T08:00:00.000Z',
              isCountedForUnlock: true,
              createdAt: '2024-01-10T10:00:00.000Z',
            },
          ],
          total: 12,
          deposited: 8,
          pending: 4,
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Not an affiliator' })
  getMyInvites(@CurrentUser('sub') userId: string) {
    return this.affiliateProgramService.getMyInvites(userId);
  }

  // ── Commission Balance ────────────────────────────────────────────────────

  @Get('my-commissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get my commission balance and history',
    description: `Returns detailed commission information:
    - Current available commission balance
    - Locked commission balance (released once unlock threshold is met)
    - Commission calculation log per user loss event
    
    ⚠️ Commissions are calculated from trading losses of your post-unlock invited users (real account only).
    You do NOT earn commission when they win trades.`,
  })
  @ApiResponse({
    status: 200,
    description: 'Commission balance and history',
    schema: {
      example: {
        success: true,
        data: {
          commissionBalance: 450000,
          lockedCommissionBalance: 0,
          isCommissionUnlocked: true,
          totalEarned: 1200000,
          totalWithdrawn: 750000,
          revenueSharePercentage: 50,
          commissionLogs: [
            {
              id: 'log_123',
              orderAmount: 100000,
              lossAmount: 100000,
              commissionPercentage: 50,
              commissionAmount: 50000,
              createdAt: '2024-02-01T14:30:00.000Z',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Not an affiliator' })
  getMyCommissions(@CurrentUser('sub') userId: string) {
    return this.affiliateProgramService.getMyCommissions(userId);
  }

  // ── Commission Withdrawal ─────────────────────────────────────────────────

  @Post('commission-withdrawals')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request commission withdrawal',
    description: `Submit a withdrawal request for your affiliate commission balance.

    **Syarat:**
    - Commission balance harus sudah terbuka (minimal ${5} user undangan sudah deposit)
    - Minimal penarikan Rp 50.000
    - Tidak boleh ada request pending lain yang belum diproses
    - Harus sudah mendaftarkan rekening bank di profil
    
    ⚠️ Jumlah yang diminta langsung di-reserve dari commission balance selama request pending.
    Saldo akan dikembalikan jika request ditolak atau dibatalkan.`,
  })
  @ApiResponse({
    status: 201,
    description: 'Withdrawal request submitted successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Commission withdrawal request submitted successfully',
          withdrawal: {
            id: 'acw_abc123',
            amount: 150000,
            status: 'pending',
            bankAccount: {
              bankName: 'Bank BCA',
              accountNumber: '1234567890',
              accountHolderName: 'John Doe',
            },
            commissionBalanceRemaining: 300000,
            createdAt: '2024-02-01T10:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Saldo tidak cukup, commission terkunci, atau nominal di bawah minimum' })
  @ApiResponse({ status: 403, description: 'Bukan affiliator atau program tidak aktif' })
  @ApiResponse({ status: 404, description: 'Rekening bank belum terdaftar di profil' })
  @ApiResponse({ status: 409, description: 'Sudah ada request pending yang belum diproses' })
  requestCommissionWithdrawal(
    @CurrentUser('sub') userId: string,
    @Body() dto: RequestCommissionWithdrawalDto,
  ) {
    return this.affiliateProgramService.requestCommissionWithdrawal(userId, dto);
  }

  @Get('commission-withdrawals')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get my commission withdrawal history',
    description: 'Menampilkan semua riwayat request penarikan komisi beserta status terkini.',
  })
  @ApiResponse({
    status: 200,
    description: 'Commission withdrawal history',
    schema: {
      example: {
        success: true,
        data: {
          commissionBalance: 300000,
          isCommissionUnlocked: true,
          totalWithdrawn: 150000,
          withdrawals: [
            {
              id: 'acw_abc123',
              amount: 150000,
              status: 'completed',
              bankAccount: {
                bankName: 'Bank BCA',
                accountNumber: '1234567890',
                accountHolderName: 'John Doe',
              },
              note: 'Penarikan bulan Januari',
              adminNotes: 'Approved and processed',
              reviewedAt: '2024-02-02T09:00:00.000Z',
              createdAt: '2024-02-01T10:00:00.000Z',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Bukan affiliator' })
  getMyCommissionWithdrawals(@CurrentUser('sub') userId: string) {
    return this.affiliateProgramService.getMyCommissionWithdrawals(userId);
  }

  @Delete('commission-withdrawals/:withdrawalId/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel a pending commission withdrawal request',
    description: `Batalkan request penarikan komisi yang masih berstatus pending.
    
    ⚠️ Hanya request dengan status **pending** yang dapat dibatalkan.
    Saldo yang sudah di-reserve akan dikembalikan ke commission balance.`,
  })
  @ApiParam({ name: 'withdrawalId', description: 'Commission withdrawal request ID' })
  @ApiResponse({ status: 200, description: 'Withdrawal request cancelled successfully' })
  @ApiResponse({ status: 400, description: 'Request tidak bisa dibatalkan — statusnya bukan pending' })
  @ApiResponse({ status: 403, description: 'Request ini bukan milik Anda' })
  @ApiResponse({ status: 404, description: 'Request tidak ditemukan' })
  cancelCommissionWithdrawal(
    @CurrentUser('sub') userId: string,
    @Param('withdrawalId') withdrawalId: string,
  ) {
    return this.affiliateProgramService.cancelCommissionWithdrawal(userId, withdrawalId);
  }
}