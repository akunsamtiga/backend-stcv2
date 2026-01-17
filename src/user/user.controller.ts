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
  UpdateProfileDto, ChangePasswordDto, VerifyPhoneDto, 
  UploadAvatarDto, UploadKTPDto, UploadSelfieDto 
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
    description: 'Returns user profile with balance, statistics, and all personal information including uploaded photos'
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
            completion: 85,
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
              verifiedAt: '2024-01-01T00:00:00.000Z',
              photoFront: {
                url: 'https://storage.example.com/ktp/user123_front.jpg',
                uploadedAt: '2024-01-01T00:00:00.000Z'
              },
              photoBack: {
                url: 'https://storage.example.com/ktp/user123_back.jpg',
                uploadedAt: '2024-01-01T00:00:00.000Z'
              }
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
            selfie: {
              url: 'https://storage.example.com/selfies/user123.jpg',
              uploadedAt: '2024-01-01T00:00:00.000Z',
              isVerified: true
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
              selfieVerified: true,
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
          }
        }
      }
    }
  })
  getProfile(@CurrentUser('sub') userId: string) {
    return this.userService.getProfile(userId);
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
    return this.userService.updateProfile(userId, updateProfileDto);
  }

  // ============================================
  // PHOTO UPLOAD ENDPOINTS
  // ============================================

  @Post('avatar')
  @ApiOperation({ 
    summary: 'Upload user avatar/profile photo',
    description: 'Upload or update user profile picture. Recommended: Max 2MB, JPG/PNG/WEBP format. Frontend should upload file to storage first, then send URL to this endpoint.'
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
            uploadedAt: '2024-01-01T00:00:00.000Z',
            fileSize: 512000,
            mimeType: 'image/jpeg'
          },
          profileCompletion: 45
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid URL or file size too large' 
  })
  uploadAvatar(
    @CurrentUser('sub') userId: string,
    @Body() uploadAvatarDto: UploadAvatarDto,
  ) {
    return this.userService.uploadAvatar(userId, uploadAvatarDto);
  }

  @Post('ktp')
  @ApiOperation({ 
    summary: 'Upload KTP/Identity Card photos (front & back)',
    description: 'Upload identity document photos for verification. Auto-verify after upload. Recommended: Max 2MB per photo, JPG/PNG format. Backend validates and marks as verified immediately.'
  })
  @ApiBody({ type: UploadKTPDto })
  @ApiResponse({ 
    status: 200, 
    description: 'KTP photos uploaded and verified successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'KTP photos uploaded and verified successfully',
          identityDocument: {
            type: 'ktp',
            photoFront: {
              url: 'https://storage.example.com/ktp/user123_front.jpg',
              uploadedAt: '2024-01-01T00:00:00.000Z',
              fileSize: 2048576,
              mimeType: 'image/jpeg'
            },
            photoBack: {
              url: 'https://storage.example.com/ktp/user123_back.jpg',
              uploadedAt: '2024-01-01T00:00:00.000Z',
              fileSize: 1948576,
              mimeType: 'image/jpeg'
            },
            isVerified: true,
            verifiedAt: '2024-01-01T00:00:00.000Z'
          },
          verificationLevel: 'intermediate',
          profileCompletion: 85
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid photo URL or missing required fields' 
  })
  uploadKTP(
    @CurrentUser('sub') userId: string,
    @Body() uploadKTPDto: UploadKTPDto,
  ) {
    return this.userService.uploadKTPPhotos(userId, uploadKTPDto);
  }

  @Post('selfie')
  @ApiOperation({ 
    summary: 'Upload selfie photo for verification',
    description: 'Upload selfie photo for identity verification. Auto-verify after upload. Recommended: Max 1MB, JPG/PNG format, clear face photo. Marks selfie as verified immediately.'
  })
  @ApiBody({ type: UploadSelfieDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Selfie uploaded and verified successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Selfie uploaded and verified successfully',
          selfieVerification: {
            photoUrl: 'https://storage.example.com/selfies/user123.jpg',
            uploadedAt: '2024-01-01T00:00:00.000Z',
            isVerified: true,
            verifiedAt: '2024-01-01T00:00:00.000Z',
            fileSize: 1024000,
            mimeType: 'image/jpeg'
          },
          verificationLevel: 'advanced',
          profileCompletion: 95
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid selfie URL or file size too large' 
  })
  uploadSelfie(
    @CurrentUser('sub') userId: string,
    @Body() uploadSelfieDto: UploadSelfieDto,
  ) {
    return this.userService.uploadSelfie(userId, uploadSelfieDto);
  }

  // ============================================
  // VERIFICATION STATUS
  // ============================================

  @Get('verification-status')
  @ApiOperation({ 
    summary: 'Get complete verification status',
    description: 'Get detailed verification status including all uploaded photos, verification level, and next steps to complete profile'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Verification status retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          verificationLevel: 'advanced',
          profileCompletion: 95,
          verification: {
            emailVerified: true,
            phoneVerified: true,
            identityVerified: true,
            selfieVerified: true,
            bankVerified: true
          },
          uploadedPhotos: {
            avatar: {
              url: 'https://storage.example.com/avatars/user123.jpg',
              uploadedAt: '2024-01-01T00:00:00.000Z'
            },
            ktpFront: {
              url: 'https://storage.example.com/ktp/user123_front.jpg',
              uploadedAt: '2024-01-01T00:00:00.000Z'
            },
            ktpBack: {
              url: 'https://storage.example.com/ktp/user123_back.jpg',
              uploadedAt: '2024-01-01T00:00:00.000Z'
            },
            selfie: {
              url: 'https://storage.example.com/selfies/user123.jpg',
              uploadedAt: '2024-01-01T00:00:00.000Z'
            }
          },
          nextSteps: [
            'All verification steps completed! 🎉',
            'You can now access all features'
          ]
        }
      }
    }
  })
  getVerificationStatus(@CurrentUser('sub') userId: string) {
    return this.userService.getVerificationStatus(userId);
  }

  // ============================================
  // SECURITY MANAGEMENT
  // ============================================

  @Post('change-password')
  @ApiOperation({ 
    summary: 'Change user password',
    description: 'Change current password to new password with validation. Requires current password for security.'
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Password changed successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Password changed successfully'
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid current password or passwords do not match' 
  })
  changePassword(
    @CurrentUser('sub') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(userId, changePasswordDto);
  }

  @Post('verify-phone')
  @ApiOperation({ 
    summary: 'Verify phone number',
    description: 'Verify user phone number with verification code sent via SMS'
  })
  @ApiBody({ type: VerifyPhoneDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Phone number verified successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Phone number verified successfully',
          phoneNumber: '+6281234567890'
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid verification code' 
  })
  verifyPhone(
    @CurrentUser('sub') userId: string,
    @Body() verifyPhoneDto: VerifyPhoneDto,
  ) {
    return this.userService.verifyPhone(userId, verifyPhoneDto);
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
    return this.userService.completeTutorial(userId);
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
    return this.userService.resetTutorial(userId);
  }

  // ============================================
  // AFFILIATE INFORMATION
  // ============================================

  @Get('affiliate')
  @ApiOperation({ 
    summary: 'Get detailed affiliate statistics',
    description: 'Get complete affiliate information with referral details, commission breakdown, and earning tips'
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
              'You receive commission based on their status'
            ]
          }
        }
      }
    }
  })
  getAffiliateStats(@CurrentUser('sub') userId: string) {
    return this.userService.getDetailedAffiliateStats(userId);
  }

  // ============================================
  // USER PREFERENCES
  // ============================================

  @Get('preferences')
  @ApiOperation({ 
    summary: 'Get user preferences and settings',
    description: 'Get user notification preferences, display settings, and trading alerts configuration'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Preferences retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          preferences: {
            emailNotifications: true,
            smsNotifications: true,
            tradingAlerts: true,
            twoFactorEnabled: false,
            language: 'id',
            timezone: 'Asia/Jakarta'
          },
          notifications: {
            email: true,
            sms: true,
            trading: true
          },
          display: {
            language: 'id',
            timezone: 'Asia/Jakarta'
          }
        }
      }
    }
  })
  getPreferences(@CurrentUser('sub') userId: string) {
    return this.userService.getUserPreferences(userId);
  }

  @Put('preferences')
  @ApiOperation({ 
    summary: 'Update user preferences',
    description: 'Update user settings and preferences including notifications and display options'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Preferences updated successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Preferences updated successfully',
          preferences: {
            emailNotifications: true,
            smsNotifications: false,
            tradingAlerts: true,
            twoFactorEnabled: false,
            language: 'en',
            timezone: 'Asia/Jakarta'
          }
        }
      }
    }
  })
  updatePreferences(
    @CurrentUser('sub') userId: string,
    @Body() preferences: any,
  ) {
    return this.userService.updateUserPreferences(userId, preferences);
  }
}