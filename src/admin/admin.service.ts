// src/admin/admin.service.ts
import { Injectable, NotFoundException, ConflictException, Logger, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ManageBalanceDto } from './dto/manage-balance.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { COLLECTIONS, BALANCE_TYPES, ORDER_STATUS } from '../common/constants';
import { User, Balance, BinaryOrder } from '../common/interfaces';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
  ) {}

  // ============================================
  // USER MANAGEMENT (EXISTING + ENHANCED)
  // ============================================

  async createUser(createUserDto: CreateUserDto, createdBy: string) {
    const db = this.firebaseService.getFirestore();

    const existingSnapshot = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', createUserDto.email)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
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

    // Create initial balance
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

  async getAllUsers(queryDto: GetUsersQueryDto) {
    const { page = 1, limit = 50, withBalance = false } = queryDto;
    const db = this.firebaseService.getFirestore();

    const snapshot = await db.collection(COLLECTIONS.USERS)
      .orderBy('createdAt', 'desc')
      .get();

    const allUsers = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const { password, ...user } = doc.data() as User;
        
        if (withBalance) {
          // Get balance for each user
          const balance = await this.balanceService.getCurrentBalance(user.id);
          return {
            ...user,
            currentBalance: balance,
          };
        }
        
        return user;
      })
    );

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

  // ============================================
  // BALANCE MANAGEMENT (NEW)
  // ============================================

  /**
   * Manage user balance (add or subtract)
   */
  async manageUserBalance(
    userId: string, 
    manageBalanceDto: ManageBalanceDto,
    adminId: string
  ) {
    // Check if user exists
    await this.getUserById(userId);

    // Get current balance
    const currentBalance = await this.balanceService.getCurrentBalance(userId);

    // Validate withdrawal
    if (manageBalanceDto.type === 'withdrawal' && currentBalance < manageBalanceDto.amount) {
      throw new BadRequestException(
        `Insufficient balance. Current: ${currentBalance}, Requested: ${manageBalanceDto.amount}`
      );
    }

    // Create balance entry
    const result = await this.balanceService.createBalanceEntry(userId, {
      type: manageBalanceDto.type === 'deposit' ? BALANCE_TYPES.DEPOSIT : BALANCE_TYPES.WITHDRAWAL,
      amount: manageBalanceDto.amount,
      description: `${manageBalanceDto.description} (by admin)`,
    }, true); // critical = true

    this.logger.log(
      `Admin ${adminId} ${manageBalanceDto.type} ${manageBalanceDto.amount} to user ${userId}`
    );

    return {
      message: `Balance ${manageBalanceDto.type} successful`,
      previousBalance: currentBalance,
      newBalance: result.currentBalance,
      transaction: result.transaction,
    };
  }

  /**
   * Get user balance detail
   */
  async getUserBalance(userId: string) {
    // Check if user exists
    const user = await this.getUserById(userId);

    // Get balance summary
    const summary = await this.balanceService.getBalanceSummary(userId);

    // Get recent transactions
    const history = await this.balanceService.getBalanceHistory(userId, { 
      page: 1, 
      limit: 10 
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      balance: summary,
      recentTransactions: history.transactions,
    };
  }

  /**
   * Get all users with balance summary
   */
  async getAllUsersWithBalance() {
    const db = this.firebaseService.getFirestore();

    const usersSnapshot = await db.collection(COLLECTIONS.USERS).get();
    
    const usersWithBalance = await Promise.all(
      usersSnapshot.docs.map(async (doc) => {
        const { password, ...user } = doc.data() as User;
        
        try {
          const balance = await this.balanceService.getCurrentBalance(user.id);
          return {
            ...user,
            currentBalance: balance,
          };
        } catch (error) {
          return {
            ...user,
            currentBalance: 0,
          };
        }
      })
    );

    // Calculate totals
    const totalBalance = usersWithBalance.reduce((sum, user) => sum + user.currentBalance, 0);
    const activeUsers = usersWithBalance.filter(u => u.isActive).length;

    return {
      users: usersWithBalance,
      summary: {
        totalUsers: usersWithBalance.length,
        activeUsers,
        totalBalance,
      },
    };
  }

  // ============================================
  // USER HISTORY (NEW)
  // ============================================

  /**
   * Get user complete history
   */
  async getUserHistory(userId: string) {
    // Check if user exists
    const user = await this.getUserById(userId);

    const db = this.firebaseService.getFirestore();

    // Get all balance transactions
    const balanceSnapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const balanceHistory = balanceSnapshot.docs.map(doc => doc.data() as Balance);

    // Get all orders
    const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const ordersHistory = ordersSnapshot.docs.map(doc => doc.data() as BinaryOrder);

    // Calculate statistics
    const totalDeposits = balanceHistory
      .filter(b => b.type === BALANCE_TYPES.DEPOSIT)
      .reduce((sum, b) => sum + b.amount, 0);

    const totalWithdrawals = balanceHistory
      .filter(b => b.type === BALANCE_TYPES.WITHDRAWAL)
      .reduce((sum, b) => sum + b.amount, 0);

    const totalOrders = ordersHistory.length;
    const activeOrders = ordersHistory.filter(o => o.status === ORDER_STATUS.ACTIVE).length;
    const wonOrders = ordersHistory.filter(o => o.status === ORDER_STATUS.WON).length;
    const lostOrders = ordersHistory.filter(o => o.status === ORDER_STATUS.LOST).length;

    const totalProfit = ordersHistory
      .filter(o => o.profit !== null)
      .reduce((sum, o) => sum + (o.profit || 0), 0);

    const winRate = (wonOrders + lostOrders) > 0 
      ? Math.round((wonOrders / (wonOrders + lostOrders)) * 100) 
      : 0;

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
      balanceHistory: {
        transactions: balanceHistory,
        summary: {
          totalDeposits,
          totalWithdrawals,
          netDeposits: totalDeposits - totalWithdrawals,
          transactionCount: balanceHistory.length,
        },
      },
      tradingHistory: {
        orders: ordersHistory,
        statistics: {
          totalOrders,
          activeOrders,
          wonOrders,
          lostOrders,
          winRate,
          totalProfit,
        },
      },
    };
  }

  /**
   * Get user trading statistics
   */
  async getUserTradingStats(userId: string) {
    // Check if user exists
    const user = await this.getUserById(userId);

    const db = this.firebaseService.getFirestore();

    // Get all orders
    const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId)
      .get();

    const orders = ordersSnapshot.docs.map(doc => doc.data() as BinaryOrder);

    // Group by asset
    const byAsset = orders.reduce((acc, order) => {
      if (!acc[order.asset_name]) {
        acc[order.asset_name] = {
          total: 0,
          won: 0,
          lost: 0,
          profit: 0,
        };
      }
      
      acc[order.asset_name].total++;
      
      if (order.status === ORDER_STATUS.WON) {
        acc[order.asset_name].won++;
        acc[order.asset_name].profit += order.profit || 0;
      } else if (order.status === ORDER_STATUS.LOST) {
        acc[order.asset_name].lost++;
        acc[order.asset_name].profit += order.profit || 0;
      }
      
      return acc;
    }, {} as Record<string, any>);

    // Group by direction
    const byDirection = orders.reduce((acc, order) => {
      if (!acc[order.direction]) {
        acc[order.direction] = {
          total: 0,
          won: 0,
          lost: 0,
          profit: 0,
        };
      }
      
      acc[order.direction].total++;
      
      if (order.status === ORDER_STATUS.WON) {
        acc[order.direction].won++;
        acc[order.direction].profit += order.profit || 0;
      } else if (order.status === ORDER_STATUS.LOST) {
        acc[order.direction].lost++;
        acc[order.direction].profit += order.profit || 0;
      }
      
      return acc;
    }, {} as Record<string, any>);

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentOrders = orders.filter(
      o => new Date(o.createdAt) >= sevenDaysAgo
    );

    return {
      user: {
        id: user.id,
        email: user.email,
      },
      overall: {
        totalOrders: orders.length,
        wonOrders: orders.filter(o => o.status === ORDER_STATUS.WON).length,
        lostOrders: orders.filter(o => o.status === ORDER_STATUS.LOST).length,
        activeOrders: orders.filter(o => o.status === ORDER_STATUS.ACTIVE).length,
        totalProfit: orders.reduce((sum, o) => sum + (o.profit || 0), 0),
      },
      byAsset,
      byDirection,
      recentActivity: {
        last7Days: recentOrders.length,
        recentProfit: recentOrders.reduce((sum, o) => sum + (o.profit || 0), 0),
      },
    };
  }

  // ============================================
  // SYSTEM STATISTICS (NEW)
  // ============================================

  /**
   * Get system-wide statistics
   */
  async getSystemStatistics() {
    const db = this.firebaseService.getFirestore();

    // Get all users
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).get();
    const users = usersSnapshot.docs.map(doc => doc.data() as User);

    // Get all orders
    const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS).get();
    const orders = ordersSnapshot.docs.map(doc => doc.data() as BinaryOrder);

    // Get all balance transactions
    const balanceSnapshot = await db.collection(COLLECTIONS.BALANCE).get();
    const transactions = balanceSnapshot.docs.map(doc => doc.data() as Balance);

    // Calculate statistics
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.isActive).length;
    const adminUsers = users.filter(u => u.role !== 'user').length;

    const totalOrders = orders.length;
    const activeOrders = orders.filter(o => o.status === ORDER_STATUS.ACTIVE).length;
    const wonOrders = orders.filter(o => o.status === ORDER_STATUS.WON).length;
    const lostOrders = orders.filter(o => o.status === ORDER_STATUS.LOST).length;

    const totalVolume = orders.reduce((sum, o) => sum + o.amount, 0);
    const totalProfit = orders.reduce((sum, o) => sum + (o.profit || 0), 0);

    const totalDeposits = transactions
      .filter(t => t.type === BALANCE_TYPES.DEPOSIT)
      .reduce((sum, t) => sum + t.amount, 0);

    const totalWithdrawals = transactions
      .filter(t => t.type === BALANCE_TYPES.WITHDRAWAL)
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        admins: adminUsers,
      },
      trading: {
        totalOrders,
        activeOrders,
        wonOrders,
        lostOrders,
        winRate: (wonOrders + lostOrders) > 0 
          ? Math.round((wonOrders / (wonOrders + lostOrders)) * 100) 
          : 0,
        totalVolume,
        totalProfit,
      },
      financial: {
        totalDeposits,
        totalWithdrawals,
        netFlow: totalDeposits - totalWithdrawals,
      },
      timestamp: new Date().toISOString(),
    };
  }
}