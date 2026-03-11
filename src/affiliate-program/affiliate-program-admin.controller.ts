// src/affiliate-program/affiliate-program-admin.controller.ts

import {
  Controller, Post, Put, Delete, Get,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiParam, ApiResponse, ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { USER_ROLES } from '../common/constants';
import { AffiliateProgramService } from './affiliate-program.service';
import {
  AssignAffiliatorDto,
  UpdateAffiliatorConfigDto,
  GetAffiliatorsQueryDto,
} from './dto/affiliate-program.dto';
import {
  ApproveCommissionWithdrawalDto,
  GetCommissionWithdrawalsQueryDto,
} from './dto/affiliate-commission-withdrawal.dto';

@ApiTags('admin/affiliate-program')
@Controller('admin/affiliate-program')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AffiliateProgramAdminController {
  constructor(private affiliateProgramService: AffiliateProgramService) {}

  // ── Affiliator Management ─────────────────────────────────────────────────

  @Post('affiliators/:userId')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Assign affiliator status to a user (Super Admin only)',
    description: `Grants a user the Affiliator role with a unique affiliate code.
    
    **Fitur Autotrade (opsional):**
    Jika \`enableAutotrade: true\` dikirim di body:
    - Affiliator mendapatkan akses ke endpoint whitelist autotrade (\`/affiliate-program/autotrade/whitelist\`)
    - Affiliator dapat menambahkan/menghapus User ID yang boleh menggunakan bot autotrade miliknya
    - Bot autotrade hanya bisa login jika User ID-nya ada di whitelist affiliator tersebut
    - Setiap penarikan komisi akan dikenakan **fee 5%** sebagai biaya layanan autotrade
    
    **Optional:** Jika \`initialRealBalance\` diisi, saldo sejumlah tersebut akan langsung 
    ditambahkan ke akun real user pada saat assign.`,
  })
  @ApiParam({ name: 'userId', description: 'ID of the user to make an affiliator' })
  @ApiResponse({
    status: 201,
    description: 'User successfully assigned as affiliator',
    schema: {
      example: {
        success: true,
        data: {
          message: 'User berhasil dijadikan affiliator',
          program: {
            id: 'prog_123',
            userId: 'user_456',
            userEmail: 'user@example.com',
            affiliateCode: 'AFFAB12CD34',
            unlockThreshold: 5,
            isActive: true,
            isCommissionUnlocked: false,
            assignedAt: '2024-01-01T00:00:00.000Z',
            shareLink: 'https://stouch.id/ref/AFFAB12CD34',
            autotradeEnabled: true,
            autotradeWithdrawalFee: 5,
            autotradeInfo: {
              message: 'Fitur autotrade aktif. Kelola whitelist user di endpoint /affiliate-program/autotrade/whitelist',
              withdrawalFeeNote: 'Setiap penarikan komisi akan dikenakan fee 5% karena autotrade aktif.',
            },
            commissionSystem: {
              currentPhase: 'new',
              description: 'Fase Baru: 80% flat dari semua loss selama 2 bulan pertama.',
              afterNewPhase: 'Fase Lama: komisi berbasis jumlah user aktif per bulan (50%–80%).',
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User is already an affiliator' })
  assignAffiliator(
    @Param('userId') userId: string,
    @Body() dto: AssignAffiliatorDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.affiliateProgramService.assignAffiliator(userId, dto, adminId);
  }

  @Delete('affiliators/:userId/revoke')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Revoke affiliator status (Super Admin only)',
    description: 'Deactivates an affiliator program. The commission balance is preserved but no new commissions will be earned.',
  })
  @ApiParam({ name: 'userId', description: 'User ID of the affiliator to revoke' })
  @ApiResponse({ status: 200, description: 'Affiliator status revoked' })
  @ApiResponse({ status: 404, description: 'Affiliator program not found for user' })
  revokeAffiliator(
    @Param('userId') userId: string,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.affiliateProgramService.revokeAffiliator(userId, adminId);
  }

  @Put('programs/:programId')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update affiliator program configuration (Super Admin only)',
    description: `Modify revenue share percentage, unlock threshold, active status, atau toggle autotrade.
    
    **Toggle Autotrade:**
    Kirim \`enableAutotrade: true\` untuk mengaktifkan, atau \`enableAutotrade: false\` untuk menonaktifkan.
    Mengaktifkan autotrade akan otomatis set \`autotradeWithdrawalFee = 5\`.`,
  })
  @ApiParam({ name: 'programId', description: 'Affiliator program ID' })
  @ApiResponse({ status: 200, description: 'Configuration updated' })
  @ApiResponse({ status: 404, description: 'Program not found' })
  updateAffiliatorConfig(
    @Param('programId') programId: string,
    @Body() dto: UpdateAffiliatorConfigDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.affiliateProgramService.updateAffiliatorConfig(programId, dto, adminId);
  }

  @Get('affiliators')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Get all affiliators (Admin only)',
    description: 'Returns a paginated list of all affiliator programs with summary statistics. Includes autotradeEnabledCount.',
  })
  @ApiResponse({
    status: 200,
    description: 'Affiliators list with summary',
    schema: {
      example: {
        success: true,
        data: {
          affiliators: [
            {
              id: 'prog_123',
              userId: 'user_456',
              userEmail: 'affiliator@example.com',
              affiliateCode: 'AFFAB12CD34',
              isActive: true,
              autotradeEnabled: true,
              autotradeWithdrawalFee: 5,
              revenueSharePercentage: 50,
              unlockThreshold: 5,
              isCommissionUnlocked: true,
              totalInvited: 12,
              totalInvitedDeposited: 8,
              commissionBalance: 450000,
              totalCommissionEarned: 1200000,
              totalCommissionWithdrawn: 750000,
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          ],
          pagination: { page: 1, limit: 20, total: 5, totalPages: 1 },
          summary: {
            totalAffiliators: 5,
            activeAffiliators: 4,
            unlockedPrograms: 3,
            autotradeEnabledCount: 2,
            totalCommissionPaid: 5400000,
          },
        },
      },
    },
  })
  getAllAffiliators(@Query() query: GetAffiliatorsQueryDto) {
    return this.affiliateProgramService.getAllAffiliators(query);
  }

  @Get('affiliators/:userId')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Get affiliator detail with full stats (Admin only)',
    description: 'Returns program config, invite list, commission logs, earnings breakdown, dan autotrade whitelist stats.',
  })
  @ApiParam({ name: 'userId', description: 'User ID of the affiliator' })
  @ApiResponse({ status: 200, description: 'Affiliator detail' })
  @ApiResponse({ status: 404, description: 'No affiliator program found for user' })
  getAffiliatorDetail(@Param('userId') userId: string) {
    return this.affiliateProgramService.getAffiliatorDetail(userId);
  }

  // ── Commission Withdrawal Management ─────────────────────────────────────

  @Get('commission-withdrawals')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Get all commission withdrawal requests (Admin only)',
    description: 'Returns paginated list of all affiliate commission withdrawal requests with summary statistics.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    description: 'Filter by status',
  })
  getAllCommissionWithdrawals(@Query() query: GetCommissionWithdrawalsQueryDto) {
    return this.affiliateProgramService.getAllCommissionWithdrawals(query);
  }

  @Post('commission-withdrawals/:withdrawalId/approve')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Approve or reject commission withdrawal (Super Admin only)',
    description: `Proses request penarikan komisi affiliate.

    **APPROVE (approve: true):**
    - Jika affiliator memiliki autotrade aktif, **fee ${5}% otomatis dipotong dari amount**
    - Balance entry dibuat dengan \`netAmountAfterFee\` (amount setelah fee)
    - Real balance affiliator bertambah sejumlah \`netAmountAfterFee\`
    - Status withdrawal diubah menjadi **completed**
    
    **REJECT (approve: false):**
    - Wajib menyertakan \`rejectionReason\`
    - Saldo dikembalikan ke commission balance affiliator
    - Status diubah menjadi **rejected**`,
  })
  @ApiParam({ name: 'withdrawalId', description: 'Commission withdrawal request ID' })
  @ApiResponse({
    status: 200,
    description: 'Withdrawal processed successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Penarikan komisi disetujui dan berhasil diproses',
          withdrawal: {
            id: 'acw_abc123',
            requestedAmount: 150000,
            feeAmount: 7500,
            netAmount: 142500,
            status: 'completed',
            affiliatorEmail: 'affiliator@example.com',
            bankAccount: {
              bankName: 'Bank BCA',
              accountNumber: '1234567890',
              accountHolderName: 'John Doe',
            },
            reviewedBy: 'superadmin_001',
            reviewedAt: '2024-02-02T09:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Request sudah diproses atau rejectionReason tidak diisi' })
  @ApiResponse({ status: 404, description: 'Request tidak ditemukan' })
  approveCommissionWithdrawal(
    @Param('withdrawalId') withdrawalId: string,
    @Body() dto: ApproveCommissionWithdrawalDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.affiliateProgramService.approveCommissionWithdrawal(
      withdrawalId,
      dto,
      adminId,
    );
  }
}