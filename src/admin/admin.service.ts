import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { COLLECTIONS, BALANCE_TYPES } from '../common/constants';
import { User } from '../common/interfaces';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private firebaseService: FirebaseService) {}

  async createUser(createUserDto: CreateUserDto, createdBy: string) {
    const db = this.firebaseService.getFirestore();

    const existingSnapshot = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', createUserDto.email)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 12);
    const userId = await this.firebaseService.generateId(COLLECTIONS.USERS);
    const timestamp = new Date().toISOString();

    const userData = {
      id: userId,
      email: createUserDto.email,
      password: hashedPassword,
      role: createUserDto.role,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
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

    this.logger.log(`User created by admin: ${createUserDto.email} (${createUserDto.role})`);

    const { password, ...userWithoutPassword } = userData;
    return {
      message: 'User created successfully',
      user: userWithoutPassword,
    };
  }

  async updateUser(userId: string, updateUserDto: UpdateUserDto) {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    await this.firebaseService.updateWithTimestamp(COLLECTIONS.USERS, userId, updateUserDto);

    this.logger.log(`User updated: ${userId}`);

    return {
      message: 'User updated successfully',
    };
  }

  async getAllUsers(page: number = 1, limit: number = 50) {
    const db = this.firebaseService.getFirestore();

    const snapshot = await db.collection(COLLECTIONS.USERS)
      .orderBy('createdAt', 'desc')
      .get();

    const allUsers = snapshot.docs.map(doc => {
      const { password, ...user } = doc.data() as User;
      return user;
    });

    const total = allUsers.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const users = allUsers.slice(startIndex, endIndex);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(userId: string) {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const { password, ...user } = userDoc.data() as User;
    return user;
  }

  async deleteUser(userId: string) {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    await db.collection(COLLECTIONS.USERS).doc(userId).delete();

    this.logger.log(`User deleted: ${userId}`);

    return {
      message: 'User deleted successfully',
    };
  }
}
