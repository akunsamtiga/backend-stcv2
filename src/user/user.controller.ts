// src/user/user.controller.ts

import { 
  Controller, Get, Post, Put, Body, UseGuards, Param 
} from '@nestjs/common';
import { 
  ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody 
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { UserService } from './user.service';
import { 
  UpdateProfileDto, ChangePasswordDto, VerifyPhoneDto, UploadAvatarDto 
} from './dto/update-profile.dto';

@ApiTags('user')
@Controller('user')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private userService: UserService) {}

  // ============================================
  // PROFILE MANAGEMENT
  // ============================================

  @Get('profile')
  @ApiOperation({ 
    summary: 'Get complete user profile',
    description: 'Returns user profile with balance, statistics, and all personal information'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          user: {
            id: 'user_id',
            email: 'user@example.com',
            role: 'user',
            status: 'standard',
            isActive: true,
            referralCode: 'ABC123',
            isNewUser: false,
            tutorialCompleted: true,
            createdAt: '2024-01-01T00:00:00.000Z'
          },
          profileInfo: {
            completion: 75,
            personal: {
              fullName: 'John Doe',
              email: 'user@example.com',
              phoneNumber: '+6281234567890',
              dateOfBirth: '1990-01-01',
              gender: 'male',
              nationality: 'Indonesian'
            },
            address: {
              street: 'Jl. Merdeka No. 123',
              city: 'Jakarta',
              province: 'DKI Jakarta',
              postalCode: '12345',
              country: 'Indonesia'
            },
            identity: {
              type: 'ktp',
              number: '************0001',
              isVerified: true,
              verifiedAt: '2024-01-01T00:00:00.000Z'
            },
            bankAccount: {
              bankName: 'Bank Mandiri',
              accountNumber: '******7890',
              accountHolderName: 'John Doe',
              isVerified: true,
              verifiedAt: '2024-01-01T00:00:00.000Z'
            },
            avatar: {
              url: 'https://example.com/avatar.jpg',
              uploadedAt: '2024-01-01T00:00:00.000Z'
            },
            settings: {
              emailNotifications: true,
              smsNotifications: true,
              tradingAlerts: true,
              twoFactorEnabled: false,
              language: 'id',
              timezone: 'Asia/Jakarta'
            },
            verification: {
              emailVerified: true,
              phoneVerified: true,
              identityVerified: true,
              bankVerified: true,
              verificationLevel: 'advanced'
            }
          },
          statusInfo: {
            current: 'standard',
            totalDeposit: 0,
            profitBonus: '+0%',
            nextStatus: 'Gold',
            progress: 0,
            depositNeeded: 160000
          },
          affiliate: {
            referralCode: 'ABC123',
            totalReferrals: 0,
            completedReferrals: 0,
            pendingReferrals: 0,
            totalCommission: 0
          },
          balances: {
            real: 0,
            demo: 10000000,
            combined: 10000000
          },
          accountInfo: {
            memberSince: '2024-01-01T00:00:00.000Z',
            lastLogin: '2024-01-02T00:00:00.000Z',
            loginCount: 5,
            accountAge: '30 days'
          }
        }
      }
    }
  })
  getProfile(@CurrentUser('sub') userId: string) {
    return this.userService.getProfile(userId)
  }

  @Put('profile')
  @ApiOperation({ 
    summary: 'Update user profile',
    description: 'Update personal information, address, identity, bank account, and settings'
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile updated successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Profile updated successfully',
          profile: {
            fullName: 'John Doe',
            phoneNumber: '+6281234567890',
            dateOfBirth: '1990-01-01',
            gender: 'male',
            nationality: 'Indonesian',
            address: {
              street: 'Jl. Merdeka No. 123',
              city: 'Jakarta',
              province: 'DKI Jakarta',
              postalCode: '12345',
              country: 'Indonesia'
            }
          },
          profileCompletion: 75
        }
      }
    }
  })
  updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(userId, updateProfileDto)
  }

  // ============================================
  // SECURITY MANAGEMENT
  // ============================================

  @Post('change-password')
  @ApiOperation({ 
    summary: 'Change user password',
    description: 'Change current password to new password with validation'
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Password changed successfully' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid current password or passwords do not match' 
  })
  changePassword(
    @CurrentUser('sub') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(userId, changePasswordDto)
  }

  // ============================================
  // AVATAR MANAGEMENT
  // ============================================

  @Post('avatar')
  @ApiOperation({ 
    summary: 'Upload user avatar',
    description: 'Upload or update user profile picture'
  })
  @ApiBody({ type: UploadAvatarDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Avatar uploaded successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Avatar uploaded successfully',
          avatar: {
            url: 'https://storage.example.com/avatars/user123.jpg',
            uploadedAt: '2024-01-01T00:00:00.000Z'
          }
        }
      }
    }
  })
  uploadAvatar(
    @CurrentUser('sub') userId: string,
    @Body() uploadAvatarDto: UploadAvatarDto,
  ) {
    return this.userService.uploadAvatar(userId, uploadAvatarDto)
  }

  // ============================================
  // VERIFICATION
  // ============================================

  @Post('verify-phone')
  @ApiOperation({ 
    summary: 'Verify phone number',
    description: 'Verify user phone number with verification code'
  })
  @ApiBody({ type: VerifyPhoneDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Phone number verified successfully' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid verification code' 
  })
  verifyPhone(
    @CurrentUser('sub') userId: string,
    @Body() verifyPhoneDto: VerifyPhoneDto,
  ) {
    return this.userService.verifyPhone(userId, verifyPhoneDto)
  }

  // ============================================
  // TUTORIAL MANAGEMENT
  // ============================================

  @Post('complete-tutorial')
  @ApiOperation({ 
    summary: 'Mark tutorial as completed',
    description: 'Mark user tutorial as completed and set isNewUser to false'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Tutorial completed successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Tutorial completed successfully',
          tutorialCompleted: true,
          isNewUser: false
        }
      }
    }
  })
  completeTutorial(@CurrentUser('sub') userId: string) {
    return this.userService.completeTutorial(userId)
  }

  @Post('reset-tutorial')
  @ApiOperation({ 
    summary: 'Reset tutorial status',
    description: 'Reset tutorial status to allow user to see tutorial again'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Tutorial reset successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Tutorial reset successfully. Reload the page to see tutorial again.',
          tutorialCompleted: false,
          isNewUser: true
        }
      }
    }
  })
  resetTutorial(@CurrentUser('sub') userId: string) {
    return this.userService.resetTutorial(userId)
  }

  // ============================================
  // AFFILIATE INFORMATION
  // ============================================

  @Get('affiliate')
  @ApiOperation({ 
    summary: 'Get detailed affiliate statistics',
    description: 'Get complete affiliate information with referral details'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Affiliate statistics retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          summary: {
            totalReferrals: 5,
            completedReferrals: 3,
            pendingReferrals: 2,
            totalCommission: 75000,
            commissionBreakdown: {
              fromStandard: 25000,
              fromGold: 50000,
              fromVIP: 0
            }
          },
          referrals: [
            {
              id: 'affiliate_id',
              referrer_id: 'user_id',
              referee_id: 'referred_user_id',
              refereeEmail: 'friend@example.com',
              refereeStatus: 'standard',
              status: 'completed',
              commission_amount: 25000,
              completed_at: '2024-01-01T00:00:00.000Z',
              createdAt: '2024-01-01T00:00:00.000Z'
            }
          ],
          instructions: {
            howToEarn: [
              'Share your referral code with friends',
              'Friend registers using your code',
              'Friend makes their first deposit',
              'You receive commission based on their status:',
              '  • Standard: Rp 25,000',
              '  • Gold: Rp 100,000',
              '  • VIP: Rp 400,000',
            ],
            tips: [
              'No limit on referrals',
              'Higher commission for higher status friends',
              'Commission paid immediately after first deposit',
              'Track all referrals in real-time',
            ]
          }
        }
      }
    }
  })
  getAffiliateStats(@CurrentUser('sub') userId: string) {
    return this.userService.getDetailedAffiliateStats(userId)
  }

  // ============================================
  // USER PREFERENCES
  // ============================================

  @Get('preferences')
  @ApiOperation({ 
    summary: 'Get user preferences',
    description: 'Get user settings and preferences'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Preferences retrieved successfully'
  })
  getPreferences(@CurrentUser('sub') userId: string) {
    return this.userService.getUserPreferences(userId)
  }

  @Put('preferences')
  @ApiOperation({ 
    summary: 'Update user preferences',
    description: 'Update user settings and preferences'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Preferences updated successfully'
  })
  updatePreferences(
    @CurrentUser('sub') userId: string,
    @Body() preferences: any,
  ) {
    return this.userService.updateUserPreferences(userId, preferences)
  }
}