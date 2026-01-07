// src/auth/auth.service.google.ts
// ✅ Google Authentication Service Extension

import { Injectable, UnauthorizedException, Logger, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../firebase/firebase.service';
import { GoogleLoginDto } from './dto/google-login.dto';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE, USER_ROLES, USER_STATUS, AFFILIATE_STATUS, AFFILIATE_CONFIG } from '../common/constants';
import { User, UserProfile } from '../common/interfaces';

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private firebaseService: FirebaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * ✅ GOOGLE SIGN-IN - Main Method
   * Handles both login and registration via Google
   */
  async googleSignIn(googleLoginDto: GoogleLoginDto) {
    const startTime = Date.now();
    
    try {
      // 1. Verify Firebase ID Token
      this.logger.log('🔐 Verifying Google ID token...');
      const decodedToken = await this.verifyGoogleIdToken(googleLoginDto.idToken);

      if (!decodedToken.email) {
        throw new UnauthorizedException('Email not provided by Google');
      }

      if (!decodedToken.email_verified) {
        throw new UnauthorizedException('Google email not verified');
      }

      const email = decodedToken.email;
      const uid = decodedToken.uid;
      const displayName = googleLoginDto.displayName || decodedToken.name || '';
      const photoURL = googleLoginDto.photoURL || decodedToken.picture || '';

      this.logger.log(`✅ Google token verified: ${email}`);

      const db = this.firebaseService.getFirestore();

      // 2. Check if user exists
      const userSnapshot = await db.collection(COLLECTIONS.USERS)
        .where('email', '==', email)
        .limit(1)
        .get();

      let user: User;
      let isNewUser = false;

      if (userSnapshot.empty) {
        // 3. CREATE NEW USER (First time Google Sign-In)
        this.logger.log(`🆕 Creating new user from Google: ${email}`);
        user = await this.createGoogleUser(email, uid, displayName, photoURL, googleLoginDto.referralCode);
        isNewUser = true;

      } else {
        // 4. LOGIN EXISTING USER
        this.logger.log(`👤 Existing user logging in: ${email}`);
        const userDoc = userSnapshot.docs[0];
        user = userDoc.data() as User;

        if (!user.isActive) {
          throw new UnauthorizedException('Account is deactivated');
        }

        // Update login stats
        const loginCount = (user.loginCount || 0) + 1;
        const lastLoginAt = new Date().toISOString();

        await db.collection(COLLECTIONS.USERS).doc(user.id).update({
          lastLoginAt,
          loginCount,
          // Update profile picture if changed
          'profile.avatar.url': photoURL || user.profile?.avatar?.url,
          'profile.avatar.uploadedAt': photoURL ? new Date().toISOString() : user.profile?.avatar?.uploadedAt,
        });

        user.loginCount = loginCount;
        user.lastLoginAt = lastLoginAt;
      }

      // 5. Generate JWT Token
      const token = this.generateToken(user.id, user.email, user.role);

      const duration = Date.now() - startTime;
      
      this.logger.log(
        `✅ Google Sign-In completed in ${duration}ms: ${email} (${user.role}, ${user.status?.toUpperCase() || 'STANDARD'}${isNewUser ? ', NEW USER' : ''})`
      );

      return {
        message: isNewUser ? 'Google Sign-In successful - New account created' : 'Google Sign-In successful',
        isNewUser,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status || USER_STATUS.STANDARD,
          profile: {
            fullName: user.profile?.fullName,
            avatar: user.profile?.avatar?.url,
          },
          referralCode: user.referralCode,
          loginCount: user.loginCount,
          lastLoginAt: user.lastLoginAt,
        },
        initialBalances: isNewUser ? {
          real: 0,
          demo: 10000000,
        } : undefined,
        token,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Google Sign-In failed after ${duration}ms: ${error.message}`);
      
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      
      throw new BadRequestException(
        error.message || 'Google Sign-In failed. Please try again.'
      );
    }
  }

  /**
   * ✅ VERIFY GOOGLE ID TOKEN
   * Uses Firebase Admin SDK to verify token
   */
  private async verifyGoogleIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      return decodedToken;
    } catch (error) {
      this.logger.error(`❌ Invalid Google ID token: ${error.message}`);
      throw new UnauthorizedException('Invalid Google credentials');
    }
  }

  /**
   * ✅ CREATE NEW GOOGLE USER
   * Creates user with initial balances and processes referral
   */
  private async createGoogleUser(
    email: string,
    googleUid: string,
    displayName: string,
    photoURL: string,
    referralCode?: string,
  ): Promise<User> {
    const db = this.firebaseService.getFirestore();

    // Check referral code if provided
    let referrerUser = null;
    if (referralCode && referralCode.trim() !== '') {
      const referrerSnapshot = await db.collection(COLLECTIONS.USERS)
        .where('referralCode', '==', referralCode.trim())
        .limit(1)
        .get();

      if (!referrerSnapshot.empty) {
        referrerUser = referrerSnapshot.docs[0].data();
        this.logger.log(`✅ Valid referral code: ${referralCode} from user ${referrerUser.id}`);
      } else {
        this.logger.warn(`⚠️ Invalid referral code provided: ${referralCode}`);
      }
    }

    // Generate user data
    const userId = await this.firebaseService.generateId(COLLECTIONS.USERS);
    const timestamp = new Date().toISOString();
    const newUserReferralCode = this.generateReferralCode();

    // Create profile with Google info
    const initialProfile: UserProfile = {
      fullName: displayName || undefined,
      
      avatar: photoURL ? {
        url: photoURL,
        uploadedAt: timestamp,
      } : undefined,
      
      settings: {
        emailNotifications: true,
        smsNotifications: true,
        tradingAlerts: true,
        twoFactorEnabled: false,
        language: 'id',
        timezone: 'Asia/Jakarta',
      },
      
      verification: {
        emailVerified: true, // Google email is already verified
        phoneVerified: false,
        identityVerified: false,
        bankVerified: false,
        verificationLevel: 'unverified',
      },
    };

    const userData: User = {
      id: userId,
      email,
      password: '', // No password for Google users
      role: USER_ROLES.USER,
      status: USER_STATUS.STANDARD,
      isActive: true,
      profile: initialProfile,
      referralCode: newUserReferralCode,
      referredBy: referrerUser ? referrerUser.id : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      loginCount: 1,
      lastLoginAt: timestamp,
    };

    // Save user
    await db.collection(COLLECTIONS.USERS).doc(userId).set(userData);

    // Create initial balances
    const balanceId1 = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
    const balanceId2 = await this.firebaseService.generateId(COLLECTIONS.BALANCE);

    await Promise.all([
      db.collection(COLLECTIONS.BALANCE).doc(balanceId1).set({
        id: balanceId1,
        user_id: userId,
        accountType: BALANCE_ACCOUNT_TYPE.REAL,
        type: BALANCE_TYPES.DEPOSIT,
        amount: 0,
        description: 'Initial real balance',
        createdAt: timestamp,
      }),
      db.collection(COLLECTIONS.BALANCE).doc(balanceId2).set({
        id: balanceId2,
        user_id: userId,
        accountType: BALANCE_ACCOUNT_TYPE.DEMO,
        type: BALANCE_TYPES.DEPOSIT,
        amount: 10000000,
        description: 'Initial demo balance - 10 million',
        createdAt: timestamp,
      }),
    ]);

    // Process referral if exists
    if (referrerUser) {
      try {
        const affiliateId = await this.firebaseService.generateId(COLLECTIONS.AFFILIATES);
        
        await db.collection(COLLECTIONS.AFFILIATES).doc(affiliateId).set({
          id: affiliateId,
          referrer_id: referrerUser.id,
          referee_id: userId,
          status: AFFILIATE_STATUS.PENDING,
          commission_amount: AFFILIATE_CONFIG.COMMISSION_AMOUNT,
          createdAt: timestamp,
        });

        this.logger.log(
          `🎁 Affiliate record created: ${referrerUser.email} referred ${email} (Pending Rp 25,000 commission)`
        );
      } catch (affiliateError) {
        this.logger.error(`⚠️ Failed to create affiliate record: ${affiliateError.message}`);
      }
    }

    this.logger.log(
      `✅ Google user created: ${email} (Status: STANDARD, Real: Rp 0, Demo: Rp 10,000,000)`
    );

    if (referrerUser) {
      this.logger.log(`   Referred by: ${referrerUser.email}`);
    }

    return userData;
  }

  /**
   * ✅ GENERATE REFERRAL CODE
   */
  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * ✅ GENERATE JWT TOKEN
   */
  private generateToken(userId: string, email: string, role: string): string {
    const payload = { sub: userId, email, role };
    
    const token = this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.expiresIn'),
    });
    
    return token;
  }
}
