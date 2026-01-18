// ============================================
// FILE: src/user/user.service.ts - FIXED VERSION
// ============================================

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { UserStatusService } from './user-status.service';
import { 
  UpdateProfileDto, ChangePasswordDto, VerifyPhoneDto, 
  UploadAvatarDto, UploadKTPDto, UploadSelfieDto 
} from './dto/update-profile.dto';
import { COLLECTIONS, BALANCE_ACCOUNT_TYPE, AFFILIATE_STATUS } from '../common/constants';
import { User, Balance, BinaryOrder, Affiliate, AffiliateStats, UserProfile } from '../common/interfaces';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
    private userStatusService: UserStatusService,
  ) {}

  // ============================================
  // PROFILE UPDATE - FIXED
  // ============================================

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    try {
      const db = this.firebaseService.getFirestore();

      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      const currentProfile = user.profile || {};
      const timestamp = new Date().toISOString();

      // ✅ FIXED: Properly handle identityDocument with photos
      let updatedIdentityDocument = currentProfile.identityDocument;
      
      if (updateProfileDto.identityDocument) {
        updatedIdentityDocument = {
          ...currentProfile.identityDocument,
          type: (updateProfileDto.identityDocument.type as 'ktp' | 'passport' | 'sim') || currentProfile.identityDocument?.type,
          number: updateProfileDto.identityDocument.number || currentProfile.identityDocument?.number,
          issuedDate: updateProfileDto.identityDocument.issuedDate || currentProfile.identityDocument?.issuedDate,
          expiryDate: updateProfileDto.identityDocument.expiryDate || currentProfile.identityDocument?.expiryDate,
          isVerified: currentProfile.identityDocument?.isVerified,
          verifiedAt: currentProfile.identityDocument?.verifiedAt,
          // ✅ FIXED: Add uploadedAt if photoFront is provided
          photoFront: updateProfileDto.identityDocument.photoFront ? {
            url: updateProfileDto.identityDocument.photoFront.url,
            uploadedAt: timestamp,
            fileSize: updateProfileDto.identityDocument.photoFront.fileSize,
            mimeType: updateProfileDto.identityDocument.photoFront.mimeType,
          } : currentProfile.identityDocument?.photoFront,
          // ✅ FIXED: Add uploadedAt if photoBack is provided
          photoBack: updateProfileDto.identityDocument.photoBack ? {
            url: updateProfileDto.identityDocument.photoBack.url,
            uploadedAt: timestamp,
            fileSize: updateProfileDto.identityDocument.photoBack.fileSize,
            mimeType: updateProfileDto.identityDocument.photoBack.mimeType,
          } : currentProfile.identityDocument?.photoBack,
        };
      }

      const updatedProfile: UserProfile = {
        ...currentProfile,
        fullName: updateProfileDto.fullName || currentProfile.fullName,
        phoneNumber: updateProfileDto.phoneNumber || currentProfile.phoneNumber,
        dateOfBirth: updateProfileDto.dateOfBirth || currentProfile.dateOfBirth,
        gender: (updateProfileDto.gender as 'male' | 'female' | 'other') || currentProfile.gender,
        nationality: updateProfileDto.nationality || currentProfile.nationality,
        
        address: updateProfileDto.address 
          ? { ...currentProfile.address, ...updateProfileDto.address }
          : currentProfile.address,
        
        identityDocument: updatedIdentityDocument,
        
        bankAccount: updateProfileDto.bankAccount
          ? { ...currentProfile.bankAccount, ...updateProfileDto.bankAccount }
          : currentProfile.bankAccount,
        
        settings: updateProfileDto.settings
          ? { ...currentProfile.settings, ...updateProfileDto.settings }
          : currentProfile.settings,
      };

      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        profile: updatedProfile,
        updatedAt: timestamp,
      });

      await this.logProfileUpdate(userId, updateProfileDto);

      this.logger.log(`✅ Profile updated for user ${userId}`);

      const profileCompletion = this.calculateProfileCompletion(updatedProfile);

      return {
        message: 'Profile updated successfully',
        profile: updatedProfile,
        profileCompletion,
      };

    } catch (error) {
      this.logger.error(`updateProfile error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // PHOTO UPLOAD METHODS
  // ============================================

  async uploadAvatar(userId: string, uploadAvatarDto: UploadAvatarDto) {
  try {
    // ✅ UPDATE: 4MB limit
    this.validatePhotoUpload(uploadAvatarDto, 4194304, 'Avatar'); // 4MB

    const db = this.firebaseService.getFirestore();
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const user = userDoc.data() as User;
    const currentProfile = user.profile || {};
    const timestamp = new Date().toISOString();

    const updatedProfile: UserProfile = {
      ...currentProfile,
      avatar: {
        url: uploadAvatarDto.url,
        uploadedAt: timestamp,
        fileSize: uploadAvatarDto.fileSize,
        mimeType: uploadAvatarDto.mimeType,
      },
    };

    await db.collection(COLLECTIONS.USERS).doc(userId).update({
      profile: updatedProfile,
      updatedAt: timestamp,
    });

    this.logger.log(`✅ Avatar uploaded and validated for user ${userId}`);

    return {
      message: 'Avatar uploaded successfully',
      avatar: updatedProfile.avatar,
      profileCompletion: this.calculateProfileCompletion(updatedProfile),
    };

  } catch (error) {
    this.logger.error(`uploadAvatar error: ${error.message}`, error.stack);
    throw error;
  }
}


  async uploadKTPPhotos(userId: string, uploadKTPDto: UploadKTPDto) {
  try {
    // ✅ UPDATE: 4MB limit for both photos
    this.validatePhotoUpload(uploadKTPDto.photoFront, 4194304, 'KTP Front'); // 4MB
    
    if (uploadKTPDto.photoBack) {
      this.validatePhotoUpload(uploadKTPDto.photoBack, 4194304, 'KTP Back'); // 4MB
    }

    const db = this.firebaseService.getFirestore();
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const user = userDoc.data() as User;
    const currentProfile = user.profile || {};
    const timestamp = new Date().toISOString();

    const updatedProfile: UserProfile = {
      ...currentProfile,
      identityDocument: {
        ...currentProfile.identityDocument,
        type: currentProfile.identityDocument?.type || 'ktp',
        number: currentProfile.identityDocument?.number,
        issuedDate: currentProfile.identityDocument?.issuedDate,
        expiryDate: currentProfile.identityDocument?.expiryDate,
        photoFront: {
          url: uploadKTPDto.photoFront.url,
          uploadedAt: timestamp,
          fileSize: uploadKTPDto.photoFront.fileSize,
          mimeType: uploadKTPDto.photoFront.mimeType,
        },
        photoBack: uploadKTPDto.photoBack ? {
          url: uploadKTPDto.photoBack.url,
          uploadedAt: timestamp,
          fileSize: uploadKTPDto.photoBack.fileSize,
          mimeType: uploadKTPDto.photoBack.mimeType,
        } : currentProfile.identityDocument?.photoBack,
        isVerified: false,
        verifiedAt: undefined,
      },
      verification: {
        ...currentProfile.verification,
        identityVerified: false,
        verificationLevel: this.calculateVerificationLevel({
          ...currentProfile.verification,
          identityVerified: false,
        }),
      },
    };

    await db.collection(COLLECTIONS.USERS).doc(userId).update({
      profile: updatedProfile,
      updatedAt: timestamp,
    });

    this.logger.log(`✅ KTP photos uploaded for user ${userId} - pending verification`);

    return {
      message: 'KTP photos uploaded successfully. Waiting for admin verification.',
      identityDocument: updatedProfile.identityDocument,
      verificationLevel: updatedProfile.verification?.verificationLevel,
      profileCompletion: this.calculateProfileCompletion(updatedProfile),
      note: 'Your identity document will be reviewed by our team. Verification usually takes 1-2 business days.',
    };

  } catch (error) {
    this.logger.error(`uploadKTPPhotos error: ${error.message}`, error.stack);
    throw error;
  }
}



  async uploadSelfie(userId: string, uploadSelfieDto: UploadSelfieDto) {
  try {
    // ✅ UPDATE: 4MB limit
    this.validatePhotoUpload(uploadSelfieDto, 4194304, 'Selfie'); // 4MB

    const db = this.firebaseService.getFirestore();
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const user = userDoc.data() as User;
    const currentProfile = user.profile || {};
    const timestamp = new Date().toISOString();

    const updatedProfile: UserProfile = {
      ...currentProfile,
      selfieVerification: {
        photoUrl: uploadSelfieDto.url,
        uploadedAt: timestamp,
        isVerified: false,
        verifiedAt: undefined,
        fileSize: uploadSelfieDto.fileSize,
        mimeType: uploadSelfieDto.mimeType,
      },
      verification: {
        ...currentProfile.verification,
        selfieVerified: false,
        verificationLevel: this.calculateVerificationLevel({
          ...currentProfile.verification,
          selfieVerified: false,
        }),
      },
    };

    await db.collection(COLLECTIONS.USERS).doc(userId).update({
      profile: updatedProfile,
      updatedAt: timestamp,
    });

    this.logger.log(`✅ Selfie uploaded for user ${userId} - pending verification`);

    return {
      message: 'Selfie uploaded successfully. Waiting for admin verification.',
      selfieVerification: updatedProfile.selfieVerification,
      verificationLevel: updatedProfile.verification?.verificationLevel,
      profileCompletion: this.calculateProfileCompletion(updatedProfile),
      note: 'Your selfie will be reviewed by our team. Verification usually takes 1-2 business days.',
    };

  } catch (error) {
    this.logger.error(`uploadSelfie error: ${error.message}`, error.stack);
    throw error;
  }
}



  async getVerificationStatus(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      const profile = user.profile || {};
      const verification = profile.verification || this.getDefaultVerification();

      const nextSteps: string[] = [];
      
      if (!verification.emailVerified) nextSteps.push('Verify your email address');
      if (!verification.phoneVerified) nextSteps.push('Verify your phone number');
      if (!verification.identityVerified) nextSteps.push('Upload KTP photos');
      if (!verification.selfieVerified) nextSteps.push('Upload selfie photo');
      if (!verification.bankVerified) nextSteps.push('Add bank account details');
      
      if (nextSteps.length === 0) {
        nextSteps.push('All verification steps completed! 🎉');
        nextSteps.push('You can now access all features');
      }

      return {
        verificationLevel: verification.verificationLevel,
        profileCompletion: this.calculateProfileCompletion(profile),
        verification: {
          emailVerified: verification.emailVerified,
          phoneVerified: verification.phoneVerified,
          identityVerified: verification.identityVerified,
          selfieVerified: verification.selfieVerified,
          bankVerified: verification.bankVerified,
        },
        uploadedPhotos: {
          avatar: profile.avatar ? {
            url: profile.avatar.url,
            uploadedAt: profile.avatar.uploadedAt,
          } : null,
          ktpFront: profile.identityDocument?.photoFront ? {
            url: profile.identityDocument.photoFront.url,
            uploadedAt: profile.identityDocument.photoFront.uploadedAt,
          } : null,
          ktpBack: profile.identityDocument?.photoBack ? {
            url: profile.identityDocument.photoBack.url,
            uploadedAt: profile.identityDocument.photoBack.uploadedAt,
          } : null,
          selfie: profile.selfieVerification ? {
            url: profile.selfieVerification.photoUrl,
            uploadedAt: profile.selfieVerification.uploadedAt,
          } : null,
        },
        nextSteps,
      };

    } catch (error) {
      this.logger.error(`getVerificationStatus error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // PROFILE RETRIEVAL
  // ============================================

  async getProfile(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();

      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      const { password, ...userWithoutPassword } = user;

      let balances;
      try {
        balances = await this.balanceService.getBothBalances(userId);
      } catch (error) {
        this.logger.error(`Balance fetch error: ${error.message}`);
        balances = {
          realBalance: 0,
          demoBalance: 10000000,
          realTransactions: 0,
          demoTransactions: 1,
        };
      }

      let statusInfo;
      try {
        statusInfo = await this.userStatusService.getUserStatusInfo(userId);
      } catch (error) {
        this.logger.error(`Status info error: ${error.message}`);
        statusInfo = {
          status: user.status || 'standard',
          totalDeposit: 0,
          profitBonus: 0,
          progress: 0,
        };
      }

      let balanceHistory;
      try {
        balanceHistory = await this.balanceService.getBalanceHistory(userId, { 
          page: 1, 
          limit: 20 
        });
      } catch (error) {
        this.logger.error(`Balance history error: ${error.message}`);
        balanceHistory = {
          transactions: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        };
      }

      let orders: BinaryOrder[] = [];
      try {
        orders = await this.getOrders(userId, db);
      } catch (error) {
        this.logger.error(`Orders fetch error: ${error.message}`);
        orders = [];
      }

      let affiliateStats;
      try {
        affiliateStats = await this.getAffiliateStats(userId);
      } catch (error) {
        this.logger.error(`Affiliate stats error: ${error.message}`);
        affiliateStats = {
          totalReferrals: 0,
          completedReferrals: 0,
          pendingReferrals: 0,
          totalCommission: 0,
          referrals: [],
        };
      }

      const realTransactions = (balanceHistory.transactions || []).filter(
        (t: Balance) => t.accountType === BALANCE_ACCOUNT_TYPE.REAL
      );
      
      const demoTransactions = (balanceHistory.transactions || []).filter(
        (t: Balance) => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO
      );

      const realOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
      const demoOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

      const profileCompletion = this.calculateProfileCompletion(user.profile);

      return {
        user: {
          ...userWithoutPassword,
          status: user.status || 'standard',
        },

        profileInfo: {
          completion: profileCompletion,
          personal: {
            fullName: user.profile?.fullName || null,
            email: user.email,
            phoneNumber: user.profile?.phoneNumber || null,
            dateOfBirth: user.profile?.dateOfBirth || null,
            gender: user.profile?.gender || null,
            nationality: user.profile?.nationality || null,
          },
          address: user.profile?.address || null,
          identity: user.profile?.identityDocument 
            ? {
                type: user.profile.identityDocument.type,
                number: this.maskSensitiveData(user.profile.identityDocument.number),
                isVerified: user.profile.identityDocument.isVerified || false,
                verifiedAt: user.profile.identityDocument.verifiedAt || null,
                photoFront: user.profile.identityDocument.photoFront ? {
                  url: user.profile.identityDocument.photoFront.url,
                  uploadedAt: user.profile.identityDocument.photoFront.uploadedAt,
                } : null,
                photoBack: user.profile.identityDocument.photoBack ? {
                  url: user.profile.identityDocument.photoBack.url,
                  uploadedAt: user.profile.identityDocument.photoBack.uploadedAt,
                } : null,
              }
            : null,
          bankAccount: user.profile?.bankAccount
            ? {
                bankName: user.profile.bankAccount.bankName,
                accountNumber: this.maskBankAccount(user.profile.bankAccount.accountNumber),
                accountHolderName: user.profile.bankAccount.accountHolderName,
                isVerified: user.profile.bankAccount.isVerified || false,
                verifiedAt: user.profile.bankAccount.verifiedAt || null,
              }
            : null,
          avatar: user.profile?.avatar || null,
          selfie: user.profile?.selfieVerification ? {
            url: user.profile.selfieVerification.photoUrl,
            uploadedAt: user.profile.selfieVerification.uploadedAt,
            isVerified: user.profile.selfieVerification.isVerified,
          } : null,
          settings: user.profile?.settings || this.getDefaultSettings(),
          verification: user.profile?.verification || this.getDefaultVerification(),
        },
        
        statusInfo: {
          current: statusInfo.status,
          totalDeposit: statusInfo.totalDeposit || 0,
          profitBonus: `+${statusInfo.profitBonus || 0}%`,
          nextStatus: statusInfo.nextStatus || 'Max Level',
          progress: Math.round(statusInfo.progress || 100),
          depositNeeded: statusInfo.nextStatusAt 
            ? Math.max(0, statusInfo.nextStatusAt - (statusInfo.totalDeposit || 0))
            : 0,
        },
        
        affiliate: {
          referralCode: user.referralCode || 'N/A',
          totalReferrals: affiliateStats.totalReferrals,
          completedReferrals: affiliateStats.completedReferrals,
          pendingReferrals: affiliateStats.pendingReferrals,
          totalCommission: affiliateStats.totalCommission,
        },
        
        balances: {
          real: balances.realBalance,
          demo: balances.demoBalance,
          combined: balances.realBalance + balances.demoBalance,
        },

        recentActivity: {
          real: {
            transactions: realTransactions.slice(0, 5),
            orders: realOrders.slice(0, 5),
          },
          demo: {
            transactions: demoTransactions.slice(0, 5),
            orders: demoOrders.slice(0, 5),
          },
        },

        statistics: {
          real: {
            totalOrders: realOrders.length,
            activeOrders: realOrders.filter(o => o.status === 'ACTIVE').length,
            wonOrders: realOrders.filter(o => o.status === 'WON').length,
            lostOrders: realOrders.filter(o => o.status === 'LOST').length,
            winRate: this.calculateWinRate(realOrders),
            totalProfit: realOrders.reduce((sum, o) => sum + (o.profit || 0), 0),
          },
          demo: {
            totalOrders: demoOrders.length,
            activeOrders: demoOrders.filter(o => o.status === 'ACTIVE').length,
            wonOrders: demoOrders.filter(o => o.status === 'WON').length,
            lostOrders: demoOrders.filter(o => o.status === 'LOST').length,
            winRate: this.calculateWinRate(demoOrders),
            totalProfit: demoOrders.reduce((sum, o) => sum + (o.profit || 0), 0),
          },
          combined: {
            totalOrders: orders.length,
            activeOrders: orders.filter(o => o.status === 'ACTIVE').length,
            wonOrders: orders.filter(o => o.status === 'WON').length,
            lostOrders: orders.filter(o => o.status === 'LOST').length,
            winRate: this.calculateWinRate(orders),
            totalProfit: orders.reduce((sum, o) => sum + (o.profit || 0), 0),
          },
        },

        accountInfo: {
          memberSince: user.createdAt,
          lastLogin: user.lastLoginAt || user.createdAt,
          loginCount: user.loginCount || 0,
          accountAge: this.calculateAccountAge(user.createdAt),
        },
      };

    } catch (error) {
      this.logger.error(`getProfile error: ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }

  // ============================================
  // TUTORIAL MANAGEMENT
  // ============================================

  async completeTutorial(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();
      
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        tutorialCompleted: true,
        isNewUser: false,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(`✅ Tutorial completed for user ${userId}`);

      return {
        message: 'Tutorial completed successfully',
        tutorialCompleted: true,
        isNewUser: false,
      };
    } catch (error) {
      this.logger.error(`completeTutorial error: ${error.message}`);
      throw error;
    }
  }

  async resetTutorial(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();
      
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        tutorialCompleted: false,
        isNewUser: true,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(`🔄 Tutorial reset for user ${userId}`);

      return {
        message: 'Tutorial reset successfully. Reload the page to see tutorial again.',
        tutorialCompleted: false,
        isNewUser: true,
      };
    } catch (error) {
      this.logger.error(`resetTutorial error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // USER PREFERENCES
  // ============================================

  async getUserPreferences(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();
      
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;

      return {
        preferences: user.profile?.settings || this.getDefaultSettings(),
        notifications: {
          email: user.profile?.settings?.emailNotifications ?? true,
          sms: user.profile?.settings?.smsNotifications ?? true,
          trading: user.profile?.settings?.tradingAlerts ?? true,
        },
        display: {
          language: user.profile?.settings?.language || 'id',
          timezone: user.profile?.settings?.timezone || 'Asia/Jakarta',
        }
      };
    } catch (error) {
      this.logger.error(`getUserPreferences error: ${error.message}`);
      throw error;
    }
  }

  async updateUserPreferences(userId: string, preferences: any) {
    try {
      const db = this.firebaseService.getFirestore();
      
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      const currentProfile = user.profile || {};

      const updatedProfile: UserProfile = {
        ...currentProfile,
        settings: {
          ...currentProfile.settings,
          ...preferences,
        }
      };

      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        profile: updatedProfile,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(`✅ Preferences updated for user ${userId}`);

      return {
        message: 'Preferences updated successfully',
        preferences: updatedProfile.settings,
      };
    } catch (error) {
      this.logger.error(`updateUserPreferences error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // PASSWORD & VERIFICATION
  // ============================================

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    try {
      const { currentPassword, newPassword, confirmPassword } = changePasswordDto;

      if (newPassword !== confirmPassword) {
        throw new BadRequestException('New passwords do not match');
      }

      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;

      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        throw new BadRequestException('Current password is incorrect');
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        password: hashedPassword,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(`✅ Password changed for user ${userId}`);

      return {
        message: 'Password changed successfully',
      };

    } catch (error) {
      this.logger.error(`changePassword error: ${error.message}`);
      throw error;
    }
  }

  async verifyPhone(userId: string, verifyPhoneDto: VerifyPhoneDto) {
    try {
      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      const currentProfile = user.profile || {};

      const updatedProfile: UserProfile = {
        ...currentProfile,
        phoneNumber: verifyPhoneDto.phoneNumber,
        verification: {
          ...currentProfile.verification,
          phoneVerified: true,
        },
      };

      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        profile: updatedProfile,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(`✅ Phone verified for user ${userId}`);

      return {
        message: 'Phone number verified successfully',
        phoneNumber: verifyPhoneDto.phoneNumber,
      };

    } catch (error) {
      this.logger.error(`verifyPhone error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // AFFILIATE METHODS
  // ============================================

  async getAffiliateStats(userId: string): Promise<AffiliateStats> {
    try {
      const db = this.firebaseService.getFirestore();

      const affiliatesSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
        .where('referrer_id', '==', userId)
        .get();

      const referrals = affiliatesSnapshot.docs.map(doc => doc.data() as Affiliate);

      const completedReferrals = referrals.filter(r => r.status === AFFILIATE_STATUS.COMPLETED);
      const pendingReferrals = referrals.filter(r => r.status === AFFILIATE_STATUS.PENDING);

      const totalCommission = completedReferrals.reduce((sum, r) => sum + r.commission_amount, 0);

      return {
        totalReferrals: referrals.length,
        completedReferrals: completedReferrals.length,
        pendingReferrals: pendingReferrals.length,
        totalCommission,
        referrals: referrals.slice(0, 10),
      };

    } catch (error) {
      this.logger.error(`getAffiliateStats error: ${error.message}`);
      
      return {
        totalReferrals: 0,
        completedReferrals: 0,
        pendingReferrals: 0,
        totalCommission: 0,
        referrals: [],
      };
    }
  }

  async getDetailedAffiliateStats(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();

      const affiliatesSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
        .where('referrer_id', '==', userId)
        .get();

      const referrals = affiliatesSnapshot.docs.map(doc => doc.data() as Affiliate);

      const referralsWithDetails = await Promise.all(
        referrals.map(async (referral) => {
          try {
            const refereeDoc = await db.collection(COLLECTIONS.USERS).doc(referral.referee_id).get();
            const refereeData = refereeDoc.exists ? refereeDoc.data() : null;

            return {
              ...referral,
              refereeEmail: refereeData?.email || 'Unknown',
              refereeStatus: referral.referee_status || refereeData?.status || 'standard',
              commissionEarned: referral.commission_amount || 0,
            };
          } catch (error) {
            return {
              ...referral,
              refereeEmail: 'Unknown',
              refereeStatus: 'standard',
              commissionEarned: 0,
            };
          }
        })
      );

      const completedReferrals = referralsWithDetails.filter(r => r.status === AFFILIATE_STATUS.COMPLETED);
      const pendingReferrals = referralsWithDetails.filter(r => r.status === AFFILIATE_STATUS.PENDING);
      const totalCommission = completedReferrals.reduce((sum, r) => sum + r.commissionEarned, 0);

      return {
        summary: {
          totalReferrals: referrals.length,
          completedReferrals: completedReferrals.length,
          pendingReferrals: pendingReferrals.length,
          totalCommission,
          commissionBreakdown: {
            fromStandard: completedReferrals
              .filter(r => r.refereeStatus === 'standard')
              .reduce((sum, r) => sum + r.commissionEarned, 0),
            fromGold: completedReferrals
              .filter(r => r.refereeStatus === 'gold')
              .reduce((sum, r) => sum + r.commissionEarned, 0),
            fromVIP: completedReferrals
              .filter(r => r.refereeStatus === 'vip')
              .reduce((sum, r) => sum + r.commissionEarned, 0),
          },
        },
        referrals: referralsWithDetails,
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
          ],
        },
      };

    } catch (error) {
      this.logger.error(`getDetailedAffiliateStats error: ${error.message}`);
      
      return {
        summary: {
          totalReferrals: 0,
          completedReferrals: 0,
          pendingReferrals: 0,
          totalCommission: 0,
          commissionBreakdown: {
            fromStandard: 0,
            fromGold: 0,
            fromVIP: 0,
          },
        },
        referrals: [],
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
          ],
        },
      };
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private async getOrders(userId: string, db: FirebaseFirestore.Firestore): Promise<BinaryOrder[]> {
    try {
      const snapshot = await db.collection(COLLECTIONS.ORDERS)
        .where('user_id', '==', userId)
        .limit(20)
        .get();

      return snapshot.docs.map(doc => doc.data() as BinaryOrder);

    } catch (error) {
      this.logger.error(`getOrders error: ${error.message}`);
      return [];
    }
  }

  private calculateWinRate(orders: BinaryOrder[]): number {
    const closedOrders = orders.filter(o => o.status === 'WON' || o.status === 'LOST');
    if (closedOrders.length === 0) return 0;

    const wins = closedOrders.filter(o => o.status === 'WON').length;
    return Math.round((wins / closedOrders.length) * 100);
  }

  private calculateProfileCompletion(profile?: UserProfile): number {
    if (!profile) return 10;

    let completion = 10;

    if (profile.fullName) completion += 5;
    if (profile.phoneNumber) completion += 5;
    if (profile.dateOfBirth) completion += 5;
    if (profile.gender) completion += 5;

    if (profile.address?.street) completion += 3;
    if (profile.address?.city) completion += 3;
    if (profile.address?.province) completion += 2;
    if (profile.address?.postalCode) completion += 2;

    if (profile.identityDocument?.number) completion += 5;
    if (profile.identityDocument?.photoFront) completion += 10;
    if (profile.identityDocument?.photoBack) completion += 5;
    if (profile.identityDocument?.isVerified) completion += 5;

    if (profile.bankAccount?.accountNumber) completion += 5;
    if (profile.bankAccount?.isVerified) completion += 5;

    if (profile.avatar?.url) completion += 10;

    if (profile.selfieVerification?.photoUrl) completion += 10;
    if (profile.selfieVerification?.isVerified) completion += 5;

    return Math.min(100, completion);
  }

  private calculateVerificationLevel(verification: any): 'unverified' | 'basic' | 'intermediate' | 'advanced' {
    const scores = {
      emailVerified: verification.emailVerified ? 1 : 0,
      phoneVerified: verification.phoneVerified ? 1 : 0,
      identityVerified: verification.identityVerified ? 1 : 0,
      selfieVerified: verification.selfieVerified ? 1 : 0,
      bankVerified: verification.bankVerified ? 1 : 0,
    };

    const totalScore = Object.values(scores).reduce((sum: number, val) => sum + val, 0);

    if (totalScore >= 4) return 'advanced';
    if (totalScore >= 3) return 'intermediate';
    if (totalScore >= 1) return 'basic';
    return 'unverified';
  }

  private maskSensitiveData(data?: string): string {
    if (!data) return '****';
    if (data.length <= 4) return '****';
    
    const visible = data.slice(-4);
    const masked = '*'.repeat(data.length - 4);
    return masked + visible;
  }

  private maskBankAccount(accountNumber?: string): string {
    if (!accountNumber) return '****';
    if (accountNumber.length <= 4) return '****';
    
    const visible = accountNumber.slice(-4);
    const masked = '*'.repeat(accountNumber.length - 4);
    return masked + visible;
  }

  private getDefaultSettings() {
    return {
      emailNotifications: true,
      smsNotifications: true,
      tradingAlerts: true,
      twoFactorEnabled: false,
      language: 'id',
      timezone: 'Asia/Jakarta',
    };
  }

  private getDefaultVerification() {
    return {
      emailVerified: true,
      phoneVerified: false,
      identityVerified: false,
      selfieVerified: false,
      bankVerified: false,
      verificationLevel: 'unverified' as const,
    };
  }

  private calculateAccountAge(createdAt: string): string {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now.getTime() - created.getTime();
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) return `${years} year${years > 1 ? 's' : ''}`;
    if (months > 0) return `${months} month${months > 1 ? 's' : ''}`;
    return `${days} day${days !== 1 ? 's' : ''}`;
  }

  private validatePhotoUpload(photo: any, maxSize: number, photoType: string): void {
  // ✅ FIXED: Allow both base64 data URLs and HTTPS URLs
  const isBase64 = photo.url.startsWith('data:image/');
  const isHttpsUrl = photo.url.startsWith('https://');
  
  if (!isBase64 && !isHttpsUrl) {
    throw new BadRequestException(
      `${photoType} must be either a base64 data URL or HTTPS URL`
    );
  }

  // Validate base64 format if it's a data URL
  if (isBase64) {
    const base64Regex = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
    if (!base64Regex.test(photo.url)) {
      throw new BadRequestException(
        `${photoType} must be a valid base64 image (JPEG, PNG, or WEBP)`
      );
    }
  }
  
  // Validate HTTPS URL format if it's a URL
  if (isHttpsUrl) {
    try {
      new URL(photo.url);
    } catch (error) {
      throw new BadRequestException(`Invalid ${photoType} URL format`);
    }
  }

  // Validate file size
  if (photo.fileSize && photo.fileSize > maxSize) {
    const maxSizeMB = maxSize / (1024 * 1024);
    throw new BadRequestException(
      `${photoType} file size exceeds limit of ${maxSizeMB}MB`
    );
  }

  // Validate MIME type
  const validMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (photo.mimeType && !validMimeTypes.includes(photo.mimeType.toLowerCase())) {
    throw new BadRequestException(
      `${photoType} must be JPEG, PNG, or WEBP format`
    );
  }
}

  private async logProfileUpdate(userId: string, updateData: UpdateProfileDto) {
    try {
      const db = this.firebaseService.getFirestore();
      const logId = await this.firebaseService.generateId('profile_update_history');

      await db.collection('profile_update_history').doc(logId).set({
        id: logId,
        user_id: userId,
        updates: updateData,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(`Failed to log profile update: ${error.message}`);
    }
  }
}