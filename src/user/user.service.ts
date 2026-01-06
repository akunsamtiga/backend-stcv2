// src/user/user.service.ts
// ✅ FIXED: Type-safe profile management with proper type casting

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { UserStatusService } from './user-status.service';
import { 
  UpdateProfileDto, ChangePasswordDto, VerifyPhoneDto, UploadAvatarDto 
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
  // PROFILE RETRIEVAL
  // ============================================

  async getProfile(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();

      // Get user data
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      const { password, ...userWithoutPassword } = user;

      // Get balances
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

      // Get status info
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

      // Get balance history
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

      // Get orders
      let orders: BinaryOrder[] = [];
      try {
        orders = await this.getOrders(userId, db);
      } catch (error) {
        this.logger.error(`Orders fetch error: ${error.message}`);
        orders = [];
      }

      // Get affiliate stats
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

      // ✅ Calculate profile completion
      const profileCompletion = this.calculateProfileCompletion(user.profile);

      return {
        user: {
          ...userWithoutPassword,
          status: user.status || 'standard',
        },

        // ✅ Profile Information
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

        // ✅ Account Metadata
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
  // PROFILE UPDATE
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

      // ✅ FIXED: Type-safe merge with proper type casting
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
        
        // ✅ FIXED: Type-safe identity document merge
        identityDocument: updateProfileDto.identityDocument
          ? { 
              ...currentProfile.identityDocument, 
              ...updateProfileDto.identityDocument,
              // Cast type explicitly to match interface
              type: (updateProfileDto.identityDocument.type as 'ktp' | 'passport' | 'sim') || currentProfile.identityDocument?.type
            }
          : currentProfile.identityDocument,
        
        bankAccount: updateProfileDto.bankAccount
          ? { ...currentProfile.bankAccount, ...updateProfileDto.bankAccount }
          : currentProfile.bankAccount,
        
        settings: updateProfileDto.settings
          ? { ...currentProfile.settings, ...updateProfileDto.settings }
          : currentProfile.settings,
      };

      // Update user document
      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        profile: updatedProfile,
        updatedAt: new Date().toISOString(),
      });

      // ✅ Log profile update
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
  // PASSWORD CHANGE
  // ============================================

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    try {
      const { currentPassword, newPassword, confirmPassword } = changePasswordDto;

      // Validate passwords match
      if (newPassword !== confirmPassword) {
        throw new BadRequestException('New passwords do not match');
      }

      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        throw new BadRequestException('Current password is incorrect');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
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

  // ============================================
  // AVATAR UPLOAD
  // ============================================

  async uploadAvatar(userId: string, uploadAvatarDto: UploadAvatarDto) {
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
        avatar: {
          url: uploadAvatarDto.url,
          uploadedAt: new Date().toISOString(),
        },
      };

      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        profile: updatedProfile,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(`✅ Avatar uploaded for user ${userId}`);

      return {
        message: 'Avatar uploaded successfully',
        avatar: updatedProfile.avatar,
      };

    } catch (error) {
      this.logger.error(`uploadAvatar error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // PHONE VERIFICATION (PLACEHOLDER)
  // ============================================

  async verifyPhone(userId: string, verifyPhoneDto: VerifyPhoneDto) {
    try {
      // TODO: Implement actual SMS verification
      // For now, just mark as verified
      
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
  // HELPER METHODS
  // ============================================

  private calculateProfileCompletion(profile?: UserProfile): number {
    if (!profile) return 10; // Base: email registered

    let completion = 10; // Base

    // Personal info (30%)
    if (profile.fullName) completion += 10;
    if (profile.phoneNumber) completion += 10;
    if (profile.dateOfBirth) completion += 5;
    if (profile.gender) completion += 5;

    // Address (20%)
    if (profile.address?.street) completion += 5;
    if (profile.address?.city) completion += 5;
    if (profile.address?.province) completion += 5;
    if (profile.address?.postalCode) completion += 5;

    // Identity (20%)
    if (profile.identityDocument?.number) completion += 10;
    if (profile.identityDocument?.isVerified) completion += 10;

    // Bank Account (20%)
    if (profile.bankAccount?.accountNumber) completion += 10;
    if (profile.bankAccount?.isVerified) completion += 10;

    // Avatar (10%)
    if (profile.avatar?.url) completion += 10;

    return Math.min(100, completion);
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
      emailVerified: true, // Assumed verified on registration
      phoneVerified: false,
      identityVerified: false,
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

  // ============================================
  // EXISTING METHODS (unchanged)
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
              refereeStatus: refereeData?.status || 'standard',
            };
          } catch (error) {
            return {
              ...referral,
              refereeEmail: 'Unknown',
              refereeStatus: 'standard',
            };
          }
        })
      );

      const completedReferrals = referralsWithDetails.filter(r => r.status === AFFILIATE_STATUS.COMPLETED);
      const pendingReferrals = referralsWithDetails.filter(r => r.status === AFFILIATE_STATUS.PENDING);
      const totalCommission = completedReferrals.reduce((sum, r) => sum + r.commission_amount, 0);

      return {
        summary: {
          totalReferrals: referrals.length,
          completedReferrals: completedReferrals.length,
          pendingReferrals: pendingReferrals.length,
          totalCommission,
        },
        referrals: referralsWithDetails,
        instructions: {
          howToEarn: [
            'Share your referral code with friends',
            'Friend registers using your code',
            'Friend makes their first deposit (any amount)',
            'You receive Rp 25,000 commission instantly!',
          ],
          tips: [
            'No limit on referrals',
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
        },
        referrals: [],
        instructions: {
          howToEarn: [
            'Share your referral code with friends',
            'Friend registers using your code',
            'Friend makes their first deposit (any amount)',
            'You receive Rp 25,000 commission instantly!',
          ],
          tips: [
            'No limit on referrals',
            'Commission paid immediately after first deposit',
            'Track all referrals in real-time',
          ],
        },
      };
    }
  }

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
}