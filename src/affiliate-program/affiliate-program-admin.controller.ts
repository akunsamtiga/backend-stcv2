// src/affiliate-program/affiliate-program-admin.controller.ts

import {
  Controller, Post, Put, Delete, Get,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiParam, ApiResponse,
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

@ApiTags('admin/affiliate-program')
@Controller('admin/affiliate-program')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AffiliateProgramAdminController {
  constructor(private affiliateProgramService: AffiliateProgramService) {}

  @Post('affiliators/:userId')
  @Roles(USER_ROLES.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Assign affiliator status to a user (Super Admin only)',
    description: `Grants a user the Affiliator role with a unique affiliate code.
    
    The assigned user will:
    - Receive a unique affiliate code to share with new users
    - Start tracking invited users who register using that code
    - Have their commission balance locked until ${'{unlockThreshold}'} invited users deposit
    - Earn ${'{revenueSharePercentage}%'} of losses from post-unlock invited users`,
  })
  @ApiParam({ name: 'userId', description: 'ID of the user to make an affiliator' })
  @ApiResponse({
    status: 201,
    description: 'User successfully assigned as affiliator',
    schema: {
      example: {
        success: true,
        data: {
          message: 'User successfully assigned as affiliator',
          program: {
            id: 'prog_123',
            userId: 'user_456',
            userEmail: 'user@example.com',
            affiliateCode: 'AFFAB12CD34',
            revenueSharePercentage: 50,
            unlockThreshold: 5,
            isActive: true,
            isCommissionUnlocked: false,
            assignedAt: '2024-01-01T00:00:00.000Z',
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
    description: `Modify revenue share percentage, unlock threshold, or active status for a specific affiliator.
    
    ⚠️ Changing the revenue share percentage takes effect immediately for future commission calculations.`,
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
    description: 'Returns a paginated list of all affiliator programs with summary statistics.',
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
              revenueSharePercentage: 50,
              unlockThreshold: 5,
              isCommissionUnlocked: true,
              totalInvited: 12,
              totalInvitedDeposited: 8,
              commissionBalance: 450000,
              totalCommissionEarned: 1200000,
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          ],
          pagination: { page: 1, limit: 20, total: 5, totalPages: 1 },
          summary: {
            totalAffiliators: 5,
            activeAffiliators: 4,
            unlockedPrograms: 3,
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
    description: 'Returns program config, invite list, commission logs, and earnings breakdown.',
  })
  @ApiParam({ name: 'userId', description: 'User ID of the affiliator' })
  @ApiResponse({ status: 200, description: 'Affiliator detail' })
  @ApiResponse({ status: 404, description: 'No affiliator program found for user' })
  getAffiliatorDetail(@Param('userId') userId: string) {
    return this.affiliateProgramService.getAffiliatorDetail(userId);
  }
}