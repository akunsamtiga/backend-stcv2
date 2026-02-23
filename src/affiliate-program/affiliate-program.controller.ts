// src/affiliate-program/affiliate-program.controller.ts

import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { AffiliateProgramService } from './affiliate-program.service';

@ApiTags('affiliate-program')
@Controller('affiliate-program')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AffiliateProgramController {
  constructor(private affiliateProgramService: AffiliateProgramService) {}

  @Get('my-program')
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
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Not an affiliator' })
  getMyProgram(@CurrentUser('sub') userId: string) {
    return this.affiliateProgramService.getMyProgram(userId);
  }

  @Get('my-invites')
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

  @Get('my-commissions')
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
}