// src/auth/auth.service.ts

import { Injectable, UnauthorizedException, ConflictException, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE, USER_ROLES, USER_STATUS, AFFILIATE_STATUS } from '../common/constants';
import { User, UserProfile } from '../common/interfaces';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  
  private userCache: Map<string, { user: User; timestamp: number }> = new Map();
  private readonly USER_CACHE_TTL = 60000;
  
  private readonly BCRYPT_ROUNDS = 10;
  
  private tokenCache: Map<string, { token: string; timestamp: number }> = new Map();
  private readonly TOKEN_CACHE_TTL = 300000;

  constructor(
    private firebaseService: FirebaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    setInterval(() => this.cleanupCache(), 60000);
  }

  async onModuleInit() {
    setTimeout(async () => {
      try {
        await this.firebaseService.waitForFirestore(10000);
        await this.initializeCollections();
        await this.createSuperAdminIfNotExists();
      } catch (error) {
        this.logger.error(`❌ Initialization failed: ${error.message}`);
      }
    }, 2000);
  }

  /**
   * ✅ Initialize all collections with placeholder documents
   * This ensures all collections appear in Firestore Console
   */
  private async initializeCollections() {
    try {
      const db = this.firebaseService.getFirestore();
      
      // Check if affiliates collection exists
      const affiliatesSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
        .limit(1)
        .get();

      if (affiliatesSnapshot.empty) {
        // Create placeholder document in affiliates collection
        const placeholderId = '_placeholder';
        
        await db.collection(COLLECTIONS.AFFILIATES).doc(placeholderId).set({
          id: placeholderId,
          _placeholder: true,
          _note: 'This is a placeholder document to initialize the collection. It will be deleted automatically.',
          createdAt: new Date().toISOString(),
        });

        this.logger.log('✅ Affiliates collection initialized with placeholder');

        // Delete placeholder after 5 seconds (optional)
        setTimeout(async () => {
          try {
            await db.collection(COLLECTIONS.AFFILIATES).doc(placeholderId).delete();
            this.logger.log('🗑️ Placeholder document removed from affiliates collection');
          } catch (error) {
            // Ignore error if already deleted
          }
        }, 5000);
      } else {
        this.logger.log('ℹ️ Affiliates collection already exists');
      }

    } catch (error) {
      this.logger.warn(`⚠️ Failed to initialize collections: ${error.message}`);
      // Don't throw - this is not critical
    }
  }

  private async createDefaultAssetIfNotExists() {
    try {
      const db = this.firebaseService.getFirestore();
      
      const assetSnapshot = await db.collection(COLLECTIONS.ASSETS)
        .where('symbol', '==', 'IDX_STC')
        .limit(1)
        .get();

      if (!assetSnapshot.empty) {
        this.logger.log('ℹ️ Default asset IDX_STC already exists');
        return;
      }

      const assetId = await this.firebaseService.generateId(COLLECTIONS.ASSETS);
      const timestamp = new Date().toISOString();

      const defaultAsset = {
        id: assetId,
        name: 'IDX STC',
        symbol: 'IDX_STC',
        profitRate: 85,
        isActive: true,
        dataSource: 'realtime_db',
        realtimeDbPath: '/idx_stc',
        description: 'Indonesian Stock Index - Default Asset',
        
        simulatorSettings: {
          initialPrice: 40.022,
          dailyVolatilityMin: 0.001,
          dailyVolatilityMax: 0.005,
          secondVolatilityMin: 0.00001,
          secondVolatilityMax: 0.00008,
          minPrice: 20.011,
          maxPrice: 80.044,
        },
        
        tradingSettings: {
          minOrderAmount: 1000,
          maxOrderAmount: 1000000,
          allowedDurations: [1, 2, 3, 4, 5, 15, 30, 45, 60],
        },
        
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: 'system',
      };

      await db.collection(COLLECTIONS.ASSETS).doc(assetId).set(defaultAsset);

      this.logger.log('✅ Default asset IDX_STC created successfully');
      this.logger.log('   Initial Price: 40.022');
      this.logger.log('   Volatility: 0.00001 - 0.00008');
      this.logger.log('   Profit Rate: 85%');

    } catch (error) {
      this.logger.error(`❌ Failed to create default asset: ${error.message}`);
    }
  }

  private async createSuperAdminIfNotExists() {
    try {
      if (!this.firebaseService.isFirestoreReady()) {
        this.logger.warn('⚠️ Firestore not ready, retrying super admin creation...');
        setTimeout(() => this.createSuperAdminIfNotExists(), 2000);
        return;
      }

      const db = this.firebaseService.getFirestore();
      const email = this.configService.get('superAdmin.email');
      const password = this.configService.get('superAdmin.password');

      if (!email || !password) {
        this.logger.warn('⚠️ Super admin credentials not configured');
        return;
      }

      const snapshot = await db.collection(COLLECTIONS.USERS)
        .where('email', '==', email)
        .limit(1)
        .get();

      if (snapshot.empty) {
        const hashedPassword = await bcrypt.hash(password, this.BCRYPT_ROUNDS);
        const userId = await this.firebaseService.generateId(COLLECTIONS.USERS);
        const timestamp = new Date().toISOString();

        const defaultProfile: UserProfile = {
          settings: {
            emailNotifications: true,
            smsNotifications: true,
            tradingAlerts: true,
            twoFactorEnabled: false,
            language: 'id',
            timezone: 'Asia/Jakarta',
          },
          verification: {
            emailVerified: true,
            phoneVerified: false,
            identityVerified: false,
            bankVerified: false,
            verificationLevel: 'unverified',
          },
        };

        await db.collection(COLLECTIONS.USERS).doc(userId).set({
          id: userId,
          email,
          password: hashedPassword,
          role: USER_ROLES.SUPER_ADMIN,
          status: USER_STATUS.VIP,
          isActive: true,
          profile: defaultProfile,
          createdAt: timestamp,
          updatedAt: timestamp,
          loginCount: 0,
        });

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

        this.logger.log(`✅ Super admin created: ${email} (Status: VIP, Real: Rp 0, Demo: Rp 10,000,000)`);
        
        await this.createDefaultAssetIfNotExists();
        
      } else {
        this.logger.log(`ℹ️ Super admin already exists: ${email}`);
        await this.createDefaultAssetIfNotExists();
      }
    } catch (error) {
      this.logger.error(`❌ Failed to create super admin: ${error.message}`);
      
      if (error.message.includes('not initialized') || error.message.includes('not ready')) {
        this.logger.log('🔄 Retrying super admin creation in 2 seconds...');
        setTimeout(() => this.createSuperAdminIfNotExists(), 2000);
      }
    }
  }

  async register(registerDto: RegisterDto) {
    const startTime = Date.now();
    const db = this.firebaseService.getFirestore();
    const { email, password, referralCode, fullName, phoneNumber, dateOfBirth, gender, nationality } = registerDto;

    try {
      const usersSnapshot = await db.collection(COLLECTIONS.USERS)
        .where('email', '==', email)
        .limit(1)
        .get();

      if (!usersSnapshot.empty) {
        throw new ConflictException('Email already registered');
      }

      // ✅ FIXED: Better referral validation with proper null handling
      let referrerUser: any = null;
      let referrerUserId: string | undefined = undefined;
      
      if (referralCode && referralCode.trim() !== '') {
        const referrerSnapshot = await db.collection(COLLECTIONS.USERS)
          .where('referralCode', '==', referralCode.trim())
          .limit(1)
          .get();

        if (referrerSnapshot.empty) {
          this.logger.warn(`⚠️ Invalid referral code provided: ${referralCode}`);
          // ✅ Don't fail registration, just log warning
        } else {
          referrerUser = referrerSnapshot.docs[0].data();
          referrerUserId = referrerUser.id;
          this.logger.log(`✅ Valid referral code: ${referralCode} from user ${referrerUserId}`);
        }
      }

      const hashedPassword = await bcrypt.hash(password, this.BCRYPT_ROUNDS);
      const userId = await this.firebaseService.generateId(COLLECTIONS.USERS);
      const timestamp = new Date().toISOString();
      const newUserReferralCode = this.generateReferralCode();

      const initialProfile: UserProfile = {
        fullName: fullName || undefined,
        phoneNumber: phoneNumber || undefined,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender as any || undefined,
        nationality: nationality || undefined,
        
        settings: {
          emailNotifications: true,
          smsNotifications: true,
          tradingAlerts: true,
          twoFactorEnabled: false,
          language: 'id',
          timezone: 'Asia/Jakarta',
        },
        
        verification: {
          emailVerified: true,
          phoneVerified: false,
          identityVerified: false,
          bankVerified: false,
          verificationLevel: 'unverified',
        },
      };

      const userData = {
        id: userId,
        email,
        password: hashedPassword,
        role: USER_ROLES.USER,
        status: USER_STATUS.STANDARD,
        isActive: true,
        profile: initialProfile,
        referralCode: newUserReferralCode,
        referredBy: referrerUserId || undefined,
        isNewUser: true,
        tutorialCompleted: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        loginCount: 0,
      };

      await db.collection(COLLECTIONS.USERS).doc(userId).set(userData);

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

      // ✅ CRITICAL FIX: Always create affiliate record if referral code exists
      if (referrerUserId && referrerUser) {
        try {
          const affiliateId = await this.firebaseService.generateId(COLLECTIONS.AFFILIATES);
          
          // ✅ Create affiliate record immediately
          await db.collection(COLLECTIONS.AFFILIATES).doc(affiliateId).set({
            id: affiliateId,
            referrer_id: referrerUserId,
            referee_id: userId,
            status: AFFILIATE_STATUS.PENDING,
            commission_amount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

          this.logger.log(
            `🎁 Affiliate record created: ${referrerUser.email} referred ${email} ` +
            `(Commission pending first deposit)`
          );
        } catch (affiliateError) {
          // ✅ Log error but don't fail registration
          this.logger.error(`⚠️ Failed to create affiliate record: ${affiliateError.message}`);
          this.logger.error(affiliateError.stack);
        }
      }
      
      let profileCompletion = 10;
      if (fullName) profileCompletion += 10;
      if (phoneNumber) profileCompletion += 10;
      if (dateOfBirth) profileCompletion += 5;
      if (gender) profileCompletion += 5;

      this.logger.log(
        `✅ User registered: ${email} (Status: STANDARD, Profile: ${profileCompletion}%, Real: Rp 0, Demo: Rp 10,000,000)`
      );

      if (referrerUserId && referrerUser) {
        this.logger.log(`   Referred by: ${referrerUser.email} (ID: ${referrerUserId})`);
      }

      const token = this.generateToken(userId, email, USER_ROLES.USER);
      this.cacheUser(userId, userData as User);

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Registration completed in ${duration}ms`);

      return {
        message: 'Registration successful with real and demo accounts',
        user: {
          id: userId,
          email,
          role: USER_ROLES.USER,
          status: USER_STATUS.STANDARD,
          referralCode: newUserReferralCode,
          profileCompletion,
        },
        initialBalances: {
          real: 0,
          demo: 10000000,
        },
        affiliate: referrerUserId && referrerUser ? {
          referredBy: referrerUser.email,
          referrerId: referrerUserId,
          commissionPending: true,
          message: 'Commission will be calculated on first deposit',
        } : null,
        token,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Registration failed after ${duration}ms: ${error.message}`);
      
      if (error instanceof ConflictException) {
        throw error;
      }
      
      throw new BadRequestException(
        error.message || 'Registration failed. Please check your input and try again.'
      );
    }
  }

  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async login(loginDto: LoginDto) {
    const startTime = Date.now();
    const db = this.firebaseService.getFirestore();
    const { email, password } = loginDto;

    const usersSnapshot = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', email)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const userDoc = usersSnapshot.docs[0];
    const user = userDoc.data() as User;

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const loginCount = (user.loginCount || 0) + 1;
    const lastLoginAt = new Date().toISOString();

    const updates: any = {
      lastLoginAt,
      loginCount,
    }

    if (loginCount >= 3 && user.tutorialCompleted === false) {
      updates.tutorialCompleted = true
      updates.isNewUser = false
    }

    await db.collection(COLLECTIONS.USERS).doc(user.id).update({
      lastLoginAt,
      loginCount,
    });

    const token = this.generateToken(user.id, user.email, user.role);
    this.cacheUser(user.id, user);

    const duration = Date.now() - startTime;
    this.logger.log(
      `✅ User logged in in ${duration}ms: ${email} (${user.role}, ${user.status?.toUpperCase() || 'STANDARD'}, Login #${loginCount})`
    );

    return {
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status || USER_STATUS.STANDARD,
        isNewUser: user.isNewUser !== false, 
        tutorialCompleted: user.tutorialCompleted || false,  
        loginCount,
        lastLoginAt,
      },
      token,
    };
  }

  private generateToken(userId: string, email: string, role: string): string {
    const payload = { sub: userId, email, role };
    
    const token = this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.expiresIn'),
    });
    
    return token;
  }

  private cacheUser(userId: string, user: User): void {
    this.userCache.set(userId, {
      user,
      timestamp: Date.now(),
    });
  }

  private getCachedUser(userId: string): User | null {
    const cached = this.userCache.get(userId);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.USER_CACHE_TTL) {
      this.userCache.delete(userId);
      return null;
    }

    return cached.user;
  }

  private cleanupCache(): void {
    const now = Date.now();
    
    for (const [userId, cached] of this.userCache.entries()) {
      if (now - cached.timestamp > this.USER_CACHE_TTL) {
        this.userCache.delete(userId);
      }
    }

    for (const [key, cached] of this.tokenCache.entries()) {
      if (now - cached.timestamp > this.TOKEN_CACHE_TTL) {
        this.tokenCache.delete(key);
      }
    }
  }

  async getUserById(userId: string): Promise<User | null> {
    const cached = this.getCachedUser(userId);
    if (cached) {
      return cached;
    }

    const db = this.firebaseService.getFirestore();
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    
    if (!userDoc.exists) {
      return null;
    }

    const user = userDoc.data() as User;
    this.cacheUser(userId, user);
    
    return user;
  }

  getPerformanceStats() {
    return {
      userCacheSize: this.userCache.size,
      tokenCacheSize: this.tokenCache.size,
      bcryptRounds: this.BCRYPT_ROUNDS,
    };
  }
}