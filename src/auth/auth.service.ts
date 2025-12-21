import { Injectable, UnauthorizedException, ConflictException, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { COLLECTIONS, BALANCE_TYPES, USER_ROLES } from '../common/constants';
import { User } from '../common/interfaces';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private firebaseService: FirebaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    // ✅ Wait for Firestore to be ready before creating super admin
    setTimeout(async () => {
      try {
        await this.firebaseService.waitForFirestore(10000); // Wait up to 10 seconds
        await this.createSuperAdminIfNotExists();
      } catch (error) {
        this.logger.error(`❌ Super admin creation failed: ${error.message}`);
      }
    }, 2000); // Wait 2 seconds for Firebase to fully initialize
  }

  private async createSuperAdminIfNotExists() {
    try {
      // ✅ Check if Firestore is ready
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
        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = await this.firebaseService.generateId(COLLECTIONS.USERS);
        const timestamp = new Date().toISOString();

        await db.collection(COLLECTIONS.USERS).doc(userId).set({
          id: userId,
          email,
          password: hashedPassword,
          role: USER_ROLES.SUPER_ADMIN,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
        await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set({
          id: balanceId,
          user_id: userId,
          type: BALANCE_TYPES.DEPOSIT,
          amount: 0,
          description: 'Initial balance',
          createdAt: timestamp,
        });

        this.logger.log(`✅ Super admin created: ${email}`);
      } else {
        this.logger.log(`ℹ️ Super admin already exists: ${email}`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to create super admin: ${error.message}`);
      
      // Retry if Firestore not ready
      if (error.message.includes('not initialized') || error.message.includes('not ready')) {
        this.logger.log('🔄 Retrying super admin creation in 2 seconds...');
        setTimeout(() => this.createSuperAdminIfNotExists(), 2000);
      }
    }
  }

  async register(registerDto: RegisterDto) {
    const db = this.firebaseService.getFirestore();
    const { email, password } = registerDto;

    const usersSnapshot = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = await this.firebaseService.generateId(COLLECTIONS.USERS);
    const timestamp = new Date().toISOString();

    const userData = {
      id: userId,
      email,
      password: hashedPassword,
      role: USER_ROLES.USER,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.collection(COLLECTIONS.USERS).doc(userId).set(userData);

    const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
    await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set({
      id: balanceId,
      user_id: userId,
      type: BALANCE_TYPES.DEPOSIT,
      amount: 0,
      description: 'Initial balance',
      createdAt: timestamp,
    });

    const token = this.generateToken(userId, email, USER_ROLES.USER);

    this.logger.log(`✅ User registered: ${email}`);

    return {
      message: 'Registration successful',
      user: {
        id: userId,
        email,
        role: USER_ROLES.USER,
      },
      token,
    };
  }

  async login(loginDto: LoginDto) {
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

    this.logger.log(`✅ User logged in: ${email} (${user.role})`);

    return {
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      token,
    };
  }

  private generateToken(userId: string, email: string, role: string): string {
    const payload = { sub: userId, email, role };
    return this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.expiresIn'),
    });
  }
}