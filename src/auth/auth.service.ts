import { Injectable, UnauthorizedException, ConflictException, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE, USER_ROLES, USER_STATUS } from '../common/constants';
import { User } from '../common/interfaces';

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
        await this.createSuperAdminIfNotExists();
      } catch (error) {
        this.logger.error(`❌ Super admin creation failed: ${error.message}`);
      }
    }, 2000);
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

        await db.collection(COLLECTIONS.USERS).doc(userId).set({
          id: userId,
          email,
          password: hashedPassword,
          role: USER_ROLES.SUPER_ADMIN,
          status: USER_STATUS.VIP,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
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
    const { email, password } = registerDto;

    const usersSnapshot = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, this.BCRYPT_ROUNDS);
    const userId = await this.firebaseService.generateId(COLLECTIONS.USERS);
    const timestamp = new Date().toISOString();

    const userData = {
      id: userId,
      email,
      password: hashedPassword,
      role: USER_ROLES.USER,
      status: USER_STATUS.STANDARD,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
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

    this.logger.log(`✅ User registered: ${email} (Status: STANDARD, Real: Rp 0, Demo: Rp 10,000,000)`);

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
      },
      initialBalances: {
        real: 0,
        demo: 10000000,
      },
      token,
    };
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

    const token = this.generateToken(user.id, user.email, user.role);
    this.cacheUser(user.id, user);

    const duration = Date.now() - startTime;
    this.logger.log(`✅ User logged in in ${duration}ms: ${email} (${user.role}, ${user.status?.toUpperCase() || 'STANDARD'})`);

    return {
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status || USER_STATUS.STANDARD,
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