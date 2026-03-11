// src/auth/auth.service.ts

import {
  Injectable, UnauthorizedException, ConflictException, Logger,
  OnModuleInit, BadRequestException, Optional, NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { FirebaseService } from '../firebase/firebase.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AutotradeLoginDto } from './dto/autotrade-login.dto';
import {
  COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE,
  USER_ROLES, USER_STATUS, AFFILIATE_STATUS,
} from '../common/constants';
import { User, UserProfile } from '../common/interfaces';

// Lazy import to avoid circular dependency — resolved at runtime via Optional()
import type { AffiliateProgramService } from '../affiliate-program/affiliate-program.service';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private userCache: Map<string, { user: User; timestamp: number }> = new Map();
  private readonly USER_CACHE_TTL = 60000;
  private readonly BCRYPT_ROUNDS = 10;
  private tokenCache: Map<string, { token: string; timestamp: number }> = new Map();
  private readonly TOKEN_CACHE_TTL = 300000;

  // Email verification token TTL: 24 jam
  private readonly EMAIL_VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private firebaseService: FirebaseService,
    private emailService: EmailService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @Optional() public affiliateProgramService?: AffiliateProgramService,
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

  private async initializeCollections() {
    try {
      const db = this.firebaseService.getFirestore();
      const affiliatesSnapshot = await db.collection(COLLECTIONS.AFFILIATES).limit(1).get();

      if (affiliatesSnapshot.empty) {
        const placeholderId = '_placeholder';
        await db.collection(COLLECTIONS.AFFILIATES).doc(placeholderId).set({
          id: placeholderId,
          _placeholder: true,
          _note: 'This is a placeholder document to initialize the collection. It will be deleted automatically.',
          createdAt: new Date().toISOString(),
        });

        this.logger.log('✅ Affiliates collection initialized with placeholder');

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
        const userId = await this.firebaseService.generateNumericId(COLLECTIONS.USERS);
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
      } else {
        this.logger.log(`ℹ️ Super admin already exists: ${email}`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to create super admin: ${error.message}`);
      if (error.message.includes('not initialized') || error.message.includes('not ready')) {
        this.logger.log('🔄 Retrying super admin creation in 2 seconds...');
        setTimeout(() => this.createSuperAdminIfNotExists(), 2000);
      }
    }
  }

  // ─── Email Verification ────────────────────────────────────────────────────

  private generateEmailVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const db = this.firebaseService.getFirestore();
    const token = this.generateEmailVerificationToken();
    const expiresAt = new Date(Date.now() + this.EMAIL_VERIFY_TOKEN_TTL_MS).toISOString();

    await db.collection(COLLECTIONS.USERS).doc(userId).update({
      emailVerificationToken: token,
      emailVerificationTokenExpiresAt: expiresAt,
    });

    try {
      await this.emailService.sendEmailVerification(email, token);
    } catch (error) {
      this.logger.error(`⚠️ Email send failed (non-blocking): ${error.message}`);
    }
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    if (!token || token.trim().length === 0) {
      throw new BadRequestException('Token verifikasi tidak valid');
    }

    const db = this.firebaseService.getFirestore();

    const snapshot = await db.collection(COLLECTIONS.USERS)
      .where('emailVerificationToken', '==', token)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new BadRequestException('Token verifikasi tidak valid atau sudah digunakan');
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    if (userData.profile?.verification?.emailVerified === true) {
      return { message: 'Email sudah terverifikasi sebelumnya' };
    }

    const expiresAt = new Date(userData.emailVerificationTokenExpiresAt);
    if (new Date() > expiresAt) {
      throw new BadRequestException('Token verifikasi sudah kadaluarsa. Silakan minta kirim ulang.');
    }

    await userDoc.ref.update({
      'profile.verification.emailVerified': true,
      'profile.verification.verificationLevel': 'basic',
      emailVerificationToken: null,
      emailVerificationTokenExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });

    this.userCache.delete(userDoc.id);

    this.logger.log(`✅ Email verified for user: ${userData.email}`);

    return { message: 'Email berhasil diverifikasi' };
  }

  async resendVerificationEmail(userId: string): Promise<{ message: string }> {
    const db = this.firebaseService.getFirestore();
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

    if (!userDoc.exists) {
      throw new NotFoundException('User tidak ditemukan');
    }

    const userData = userDoc.data();

    if (!userData) {
      throw new NotFoundException('User tidak ditemukan');
    }

    if (userData.profile?.verification?.emailVerified === true) {
      throw new BadRequestException('Email sudah terverifikasi');
    }

    if (userData.emailVerificationTokenExpiresAt) {
      const expiresAt = new Date(userData.emailVerificationTokenExpiresAt);
      const tokenAge = (expiresAt.getTime() - Date.now());
      const maxAge = this.EMAIL_VERIFY_TOKEN_TTL_MS;
      const minWaitMs = 60 * 1000;

      if (tokenAge > (maxAge - minWaitMs)) {
        throw new BadRequestException(
          'Tunggu 1 menit sebelum meminta kirim ulang email verifikasi'
        );
      }
    }

    await this.sendVerificationEmail(userId, userData.email);

    this.logger.log(`✅ Verification email resent to: ${userData.email}`);

    return { message: 'Email verifikasi telah dikirim ulang. Periksa inbox Anda.' };
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  private normalizePhoneNumber(phone: string | undefined): string | undefined {
    if (!phone) return undefined;
    const cleaned = phone.trim();
    if (cleaned.startsWith('+62')) return cleaned;
    if (cleaned.startsWith('62')) return `+${cleaned}`;
    if (cleaned.startsWith('0')) return `+62${cleaned.slice(1)}`;
    return cleaned;
  }

  async register(registerDto: RegisterDto) {
    const startTime = Date.now();
    const db = this.firebaseService.getFirestore();
    const {
      email, password, referralCode, affiliateCode,
      fullName, phoneNumber, dateOfBirth, gender, nationality,
    } = registerDto;

    try {
      const usersSnapshot = await db.collection(COLLECTIONS.USERS)
        .where('email', '==', email)
        .limit(1)
        .get();

      if (!usersSnapshot.empty) {
        throw new ConflictException('Email already registered');
      }

      let referrerUser: any = null;
      let referrerUserId: string | undefined = undefined;

      if (referralCode && referralCode.trim() !== '') {
        const referrerSnapshot = await db.collection(COLLECTIONS.USERS)
          .where('referralCode', '==', referralCode.trim())
          .limit(1)
          .get();

        if (referrerSnapshot.empty) {
          this.logger.warn(`⚠️ Invalid referral code provided: ${referralCode}`);
        } else {
          referrerUser = referrerSnapshot.docs[0].data();
          referrerUserId = referrerUser.id;
          this.logger.log(`✅ Valid referral code: ${referralCode} from user ${referrerUserId}`);
        }
      }

      const hashedPassword = await bcrypt.hash(password, this.BCRYPT_ROUNDS);
      const userId = await this.firebaseService.generateNumericId(COLLECTIONS.USERS);
      const timestamp = new Date().toISOString();
      const newUserReferralCode = this.generateReferralCode();
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

      if (phoneNumber && normalizedPhone) {
        this.logger.log(`📱 Phone normalized: ${phoneNumber} → ${normalizedPhone}`);
      }

      const initialProfile: UserProfile = {
        fullName: fullName || undefined,
        phoneNumber: normalizedPhone,
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
          emailVerified: false,
          phoneVerified: false,
          identityVerified: false,
          bankVerified: false,
          verificationLevel: 'unverified',
        },
      };

      const verificationToken = this.generateEmailVerificationToken();
      const verificationTokenExpiresAt = new Date(
        Date.now() + this.EMAIL_VERIFY_TOKEN_TTL_MS
      ).toISOString();

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
        emailVerificationToken: verificationToken,
        emailVerificationTokenExpiresAt: verificationTokenExpiresAt,
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

      if (referrerUserId && referrerUser) {
        try {
          const affiliateId = await this.firebaseService.generateId(COLLECTIONS.AFFILIATES);
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
            `🎁 Affiliate record created: ${referrerUser.email} referred ${email}`,
          );
        } catch (affiliateError) {
          this.logger.error(`⚠️ Failed to create affiliate record: ${affiliateError.message}`);
        }
      }

      // Affiliate program hook
      let affiliateProgramResult: any = null;
      if (affiliateCode?.trim() && this.affiliateProgramService) {
        try {
          const result = await this.affiliateProgramService.handleNewRegistration(
            userId,
            email,
            affiliateCode.trim(),
          );
          if (result.registered) {
            affiliateProgramResult = result;
            this.logger.log(`✅ Affiliate program invite created via code: ${affiliateCode}`);
          }
        } catch (affProgError) {
          this.logger.error(`⚠️ Affiliate program hook failed: ${affProgError.message}`);
        }
      }

      this.emailService.sendEmailVerification(email, verificationToken).catch(err => {
        this.logger.error(`⚠️ Failed to send verification email: ${err.message}`);
      });

      let profileCompletion = 10;
      if (fullName) profileCompletion += 10;
      if (normalizedPhone) profileCompletion += 10;
      if (dateOfBirth) profileCompletion += 5;
      if (gender) profileCompletion += 5;

      const token = this.generateToken(userId, email, USER_ROLES.USER);
      this.cacheUser(userId, userData as unknown as User);

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Registration completed in ${duration}ms: ${email}`);

      return {
        message: 'Registration successful with real and demo accounts',
        user: {
          id: userId,
          email,
          role: USER_ROLES.USER,
          status: USER_STATUS.STANDARD,
          referralCode: newUserReferralCode,
          profileCompletion,
          isNewUser: true,
          tutorialCompleted: false,
          loginCount: 0,
          emailVerified: false,
        },
        initialBalances: {
          real: 0,
          demo: 10000000,
        },
        emailVerification: {
          required: true,
          message: 'Email verifikasi telah dikirim ke ' + email + '. Silakan cek inbox Anda.',
        },
        affiliate: referrerUserId && referrerUser
          ? {
              referredBy: referrerUser.email,
              referrerId: referrerUserId,
              commissionPending: true,
              message: 'Commission will be calculated on first deposit',
            }
          : null,
        affiliateProgram: affiliateProgramResult?.registered
          ? {
              affiliatorCode: affiliateCode,
              message: 'You have been registered under an affiliator program',
            }
          : null,
        token,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Registration failed after ${duration}ms: ${error.message}`);
      if (error instanceof ConflictException) throw error;
      throw new BadRequestException(
        error.message || 'Registration failed. Please check your input and try again.',
      );
    }
  }

  // ─── Login ────────────────────────────────────────────────────────────────

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
    const updates: any = { lastLoginAt, loginCount };

    if (loginCount >= 3 && user.tutorialCompleted === false) {
      updates.tutorialCompleted = true;
      updates.isNewUser = false;
    }

    await db.collection(COLLECTIONS.USERS).doc(user.id).update(updates);

    const token = this.generateToken(user.id, user.email, user.role);
    this.cacheUser(user.id, user);

    const emailVerified = user.profile?.verification?.emailVerified ?? false;

    const duration = Date.now() - startTime;
    this.logger.log(
      `✅ User logged in in ${duration}ms: ${email} (${user.role}, ${user.status?.toUpperCase() || 'STANDARD'}, Login #${loginCount})`,
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
        emailVerified,
      },
      emailVerification: !emailVerified
        ? {
            required: false,
            message: 'Email Anda belum diverifikasi. Silakan cek inbox atau minta kirim ulang.',
          }
        : null,
      token,
    };
  }

  // ─── Autotrade Login ──────────────────────────────────────────────────────
  //
  // Login khusus untuk bot autotrade.
  // Selain validasi email+password, memeriksa apakah User ID ada di whitelist
  // autotrade (opsional: filter by affiliateCode).
  //
  // Endpoint: POST /auth/autotrade-login
  // ─────────────────────────────────────────────────────────────────────────

  async autotradeLogin(dto: AutotradeLoginDto) {
    const startTime = Date.now();

    // 1. Validasi credentials (email + password) — reuse logika login biasa
    const loginResult = await this.login({ email: dto.email, password: dto.password });

    const userId = loginResult.user.id;

    // 2. Cek whitelist autotrade
    if (!this.affiliateProgramService) {
      throw new ForbiddenException(
        'Layanan autotrade tidak tersedia. Hubungi administrator.'
      );
    }

    const whitelistCheck = await this.affiliateProgramService.validateAutotradeLogin(
      userId,
      dto.affiliateCode,
    );

    if (!whitelistCheck.allowed) {
      this.logger.warn(
        `🚫 Autotrade login DITOLAK: user ${userId} (${dto.email}) — ${whitelistCheck.reason}`
      );
      throw new ForbiddenException(
        whitelistCheck.reason || 'User ID Anda tidak diizinkan menggunakan autotrade'
      );
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `🤖 Autotrade login BERHASIL: ${dto.email} (user ${userId}) ` +
      `di bawah affiliator ${whitelistCheck.affiliatorId} — ${duration}ms`
    );

    return {
      message: 'Autotrade login successful',
      user: loginResult.user,
      autotrade: {
        allowed: true,
        affiliatorId: whitelistCheck.affiliatorId,
        affiliateCode: dto.affiliateCode,
      },
      token: loginResult.token,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private generateToken(userId: string, email: string, role: string): string {
    const payload = { sub: userId, email, role };
    return this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.expiresIn'),
    });
  }

  private cacheUser(userId: string, user: User): void {
    this.userCache.set(userId, { user, timestamp: Date.now() });
  }

  private getCachedUser(userId: string): User | null {
    const cached = this.userCache.get(userId);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.USER_CACHE_TTL) {
      this.userCache.delete(userId);
      return null;
    }
    return cached.user;
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [userId, cached] of this.userCache.entries()) {
      if (now - cached.timestamp > this.USER_CACHE_TTL) this.userCache.delete(userId);
    }
    for (const [key, cached] of this.tokenCache.entries()) {
      if (now - cached.timestamp > this.TOKEN_CACHE_TTL) this.tokenCache.delete(key);
    }
  }

  async getUserById(userId: string): Promise<User | null> {
    const cached = this.getCachedUser(userId);
    if (cached) return cached;
    const db = this.firebaseService.getFirestore();
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) return null;
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