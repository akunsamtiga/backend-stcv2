// src/admin/admin.service.ts
// ✅ COMPLETE VERSION - Full Real/Demo balance management for admin

import { Injectable, NotFoundException, ConflictException, Logger, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ManageBalanceDto } from './dto/manage-balance.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { COLLECTIONS, BALANCE_TYPES, ORDER_STATUS, BALANCE_ACCOUNT_TYPE } from '../common/constants';
import { User, Balance, BinaryOrder } from '../common/interfaces';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
  ) {}

  // ============================================
  // USER MANAGEMENT
  // ============================================

  /**
   * ✅ CREATE USER - With both Real and Demo accounts
   */
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

    // ✅ Create initial balance for BOTH accounts
    const balanceId1 = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
    const balanceId2 = await this.firebaseService.generateId(COLLECTIONS.BALANCE);

    await Promise.all([
      // Real account
      db.collection(COLLECTIONS.BALANCE).doc(balanceId1).set({
        id: balanceId1,
        user_id: userId,
        accountType: BALANCE_ACCOUNT_TYPE.REAL,
        type: BALANCE_TYPES.DEPOSIT,
        amount: 0,
        description: 'Initial real balance',
        createdAt: timestamp,
      }),
      // Demo account
      db.collection(COLLECTIONS.BALANCE).doc(balanceId2).set({
        id: balanceId2,
        user_id: userId,
        accountType: BALANCE_ACCOUNT_TYPE.DEMO,
        type: BALANCE_TYPES.DEPOSIT,
        amount: 10000, // ✅ Give demo users starting balance
        description: 'Initial demo balance',
        createdAt: timestamp,
      }),
    ]);

    this.logger.log(`User created with both accounts: ${createUserDto.email}`);

    const { password, ...userWithoutPassword } = userData;
    return {
      message: 'User created successfully with real and demo accounts',
      user: userWithoutPassword,
    };
  }

  /**
   * UPDATE USER
   */
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

  /**
   * GET ALL USERS
   */
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
          const balances = await this.balanceService.getBothBalances(user.id);
          return {
            ...user,
            realBalance: balances.realBalance,
            demoBalance: balances.demoBalance,
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

  /**
   * GET USER BY ID
   */
  async getUserById(userId: string) {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const { password, ...user } = userDoc.data() as User;
    return user;
  }

  /**
   * DELETE USER
   */
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
  // BALANCE MANAGEMENT - Real/Demo
  // ============================================

  /**
   * ✅ MANAGE USER BALANCE - Real or Demo
   */
  async manageUserBalance(
    userId: string, 
    manageBalanceDto: ManageBalanceDto,
    adminId: string
  ) {
    // Validate user exists
    await this.getUserById(userId);

    const { accountType } = manageBalanceDto;

    // ✅ Validate account type
    if (accountType !== BALANCE_ACCOUNT_TYPE.REAL && accountType !== BALANCE_ACCOUNT_TYPE.DEMO) {
      throw new BadRequestException('Invalid account type. Must be "real" or "demo"');
    }

    // Get current balance for specific account
    const currentBalance = await this.balanceService.getCurrentBalance(userId, accountType);

    // Validate withdrawal
    if (manageBalanceDto.type === 'withdrawal' && currentBalance < manageBalanceDto.amount) {
      throw new BadRequestException(
        `Insufficient ${accountType} balance. Current: ${currentBalance}, Requested: ${manageBalanceDto.amount}`
      );
    }

    // Create balance entry
    const result = await this.balanceService.createBalanceEntry(userId, {
      accountType, // ✅ Specify account type
      type: manageBalanceDto.type === 'deposit' ? BALANCE_TYPES.DEPOSIT : BALANCE_TYPES.WITHDRAWAL,
      amount: manageBalanceDto.amount,
      description: `${manageBalanceDto.description} (by admin)`,
    }, true);

    this.logger.log(
      `Admin ${adminId} ${manageBalanceDto.type} ${manageBalanceDto.amount} to user ${userId}'s ${accountType} account`
    );

    return {
      message: `${accountType} balance ${manageBalanceDto.type} successful`,
      accountType,
      previousBalance: currentBalance,
      newBalance: result.currentBalance,
      transaction: result.transaction,
    };
  }

  /**
   * ✅ GET USER BALANCE DETAIL - Both Accounts
   */
  async getUserBalance(userId: string) {
    // Check if user exists
    const user = await this.getUserById(userId);

    // Get both balances
    const summary = await this.balanceService.getBothBalances(userId);

    // Get recent transactions (all)
    const history = await this.balanceService.getBalanceHistory(userId, { 
      page: 1, 
      limit: 20 
    });

    // Separate transactions by account type
    const realTransactions = history.transactions.filter(
      t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL
    );
    const demoTransactions = history.transactions.filter(
      t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      balances: {
        real: {
          current: summary.realBalance,
          recentTransactions: realTransactions.slice(0, 10),
        },
        demo: {
          current: summary.demoBalance,
          recentTransactions: demoTransactions.slice(0, 10),
        },
      },
      summary: {
        combinedBalance: summary.realBalance + summary.demoBalance,
        totalTransactions: summary.realTransactions + summary.demoTransactions,
      },
    };
  }

  /**
   * ✅ GET ALL USERS WITH BOTH BALANCES
   */
  async getAllUsersWithBalance() {
    const db = this.firebaseService.getFirestore();

    const usersSnapshot = await db.collection(COLLECTIONS.USERS).get();
    
    const usersWithBalance = await Promise.all(
      usersSnapshot.docs.map(async (doc) => {
        const { password, ...user } = doc.data() as User;
        
        try {
          const balances = await this.balanceService.getBothBalances(user.id);
          return {
            ...user,
            realBalance: balances.realBalance,
            demoBalance: balances.demoBalance,
            combinedBalance: balances.realBalance + balances.demoBalance,
          };
        } catch (error) {
          return {
            ...user,
            realBalance: 0,
            demoBalance: 0,
            combinedBalance: 0,
          };
        }
      })
    );

    // Calculate totals
    const totalRealBalance = usersWithBalance.reduce((sum, user) => sum + user.realBalance, 0);
    const totalDemoBalance = usersWithBalance.reduce((sum, user) => sum + user.demoBalance, 0);
    const activeUsers = usersWithBalance.filter(u => u.isActive).length;

    return {
      users: usersWithBalance,
      summary: {
        totalUsers: usersWithBalance.length,
        activeUsers,
        totalRealBalance,
        totalDemoBalance,
        combinedBalance: totalRealBalance + totalDemoBalance,
      },
    };
  }

  // ============================================
  // USER HISTORY - With Real/Demo Separation
  // ============================================

  /**
   * ✅ GET USER COMPLETE HISTORY
   */
  async getUserHistory(userId: string) {
    const user = await this.getUserById(userId);

    const db = this.firebaseService.getFirestore();

    // Get all balance transactions
    const balanceSnapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const balanceHistory = balanceSnapshot.docs.map(doc => doc.data() as Balance);

    // Separate by account type
    const realBalanceHistory = balanceHistory.filter(b => b.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoBalanceHistory = balanceHistory.filter(b => b.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    // Get all orders
    const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const ordersHistory = ordersSnapshot.docs.map(doc => doc.data() as BinaryOrder);

    // Separate orders by account type
    const realOrders = ordersHistory.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoOrders = ordersHistory.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    // Calculate statistics for real account
    const realStats = this.calculateAccountStats(realBalanceHistory, realOrders);
    const demoStats = this.calculateAccountStats(demoBalanceHistory, demoOrders);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
      realAccount: {
        balanceHistory: realBalanceHistory,
        orders: realOrders,
        statistics: realStats,
      },
      demoAccount: {
        balanceHistory: demoBalanceHistory,
        orders: demoOrders,
        statistics: demoStats,
      },
      combined: {
        totalTransactions: balanceHistory.length,
        totalOrders: ordersHistory.length,
      },
    };
  }

  /**
   * ✅ GET USER TRADING STATISTICS
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

    // Separate by account type
    const realOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    // Calculate stats for real account
    const realStats = this.calculateTradingStats(realOrders);
    const demoStats = this.calculateTradingStats(demoOrders);

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentRealOrders = realOrders.filter(
      o => new Date(o.createdAt) >= sevenDaysAgo
    );

    const recentDemoOrders = demoOrders.filter(
      o => new Date(o.createdAt) >= sevenDaysAgo
    );

    return {
      user: {
        id: user.id,
        email: user.email,
      },
      realAccount: {
        overall: realStats.overall,
        byAsset: realStats.byAsset,
        byDirection: realStats.byDirection,
        recentActivity: {
          last7Days: recentRealOrders.length,
          recentProfit: recentRealOrders.reduce((sum, o) => sum + (o.profit || 0), 0),
        },
      },
      demoAccount: {
        overall: demoStats.overall,
        byAsset: demoStats.byAsset,
        byDirection: demoStats.byDirection,
        recentActivity: {
          last7Days: recentDemoOrders.length,
          recentProfit: recentDemoOrders.reduce((sum, o) => sum + (o.profit || 0), 0),
        },
      },
      combined: {
        totalOrders: orders.length,
        totalProfit: orders.reduce((sum, o) => sum + (o.profit || 0), 0),
      },
    };
  }

  // ============================================
  // SYSTEM STATISTICS
  // ============================================

  /**
   * ✅ GET SYSTEM-WIDE STATISTICS
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

    // Separate by account type
    const realOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const realTransactions = transactions.filter(t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoTransactions = transactions.filter(t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    // Calculate statistics
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.isActive).length;
    const adminUsers = users.filter(u => u.role !== 'user').length;

    // Real account stats
    const realStats = {
      totalOrders: realOrders.length,
      activeOrders: realOrders.filter(o => o.status === ORDER_STATUS.ACTIVE).length,
      wonOrders: realOrders.filter(o => o.status === ORDER_STATUS.WON).length,
      lostOrders: realOrders.filter(o => o.status === ORDER_STATUS.LOST).length,
      totalVolume: realOrders.reduce((sum, o) => sum + o.amount, 0),
      totalProfit: realOrders.reduce((sum, o) => sum + (o.profit || 0), 0),
      totalDeposits: realTransactions
        .filter(t => t.type === BALANCE_TYPES.DEPOSIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalWithdrawals: realTransactions
        .filter(t => t.type === BALANCE_TYPES.WITHDRAWAL)
        .reduce((sum, t) => sum + t.amount, 0),
    };

    // Demo account stats
    const demoStats = {
      totalOrders: demoOrders.length,
      activeOrders: demoOrders.filter(o => o.status === ORDER_STATUS.ACTIVE).length,
      wonOrders: demoOrders.filter(o => o.status === ORDER_STATUS.WON).length,
      lostOrders: demoOrders.filter(o => o.status === ORDER_STATUS.LOST).length,
      totalVolume: demoOrders.reduce((sum, o) => sum + o.amount, 0),
      totalProfit: demoOrders.reduce((sum, o) => sum + (o.profit || 0), 0),
      totalDeposits: demoTransactions
        .filter(t => t.type === BALANCE_TYPES.DEPOSIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalWithdrawals: demoTransactions
        .filter(t => t.type === BALANCE_TYPES.WITHDRAWAL)
        .reduce((sum, t) => sum + t.amount, 0),
    };

    // Calculate win rates
    const realWinRate = (realStats.wonOrders + realStats.lostOrders) > 0 
      ? Math.round((realStats.wonOrders / (realStats.wonOrders + realStats.lostOrders)) * 100) 
      : 0;

    const demoWinRate = (demoStats.wonOrders + demoStats.lostOrders) > 0 
      ? Math.round((demoStats.wonOrders / (demoStats.wonOrders + demoStats.lostOrders)) * 100) 
      : 0;

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        admins: adminUsers,
      },
      realAccount: {
        trading: {
          ...realStats,
          winRate: realWinRate,
        },
        financial: {
          totalDeposits: realStats.totalDeposits,
          totalWithdrawals: realStats.totalWithdrawals,
          netFlow: realStats.totalDeposits - realStats.totalWithdrawals,
        },
      },
      demoAccount: {
        trading: {
          ...demoStats,
          winRate: demoWinRate,
        },
        financial: {
          totalDeposits: demoStats.totalDeposits,
          totalWithdrawals: demoStats.totalWithdrawals,
          netFlow: demoStats.totalDeposits - demoStats.totalWithdrawals,
        },
      },
      combined: {
        totalOrders: orders.length,
        totalVolume: realStats.totalVolume + demoStats.totalVolume,
        totalProfit: realStats.totalProfit + demoStats.totalProfit,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * ✅ HELPER: Calculate account statistics
   */
  private calculateAccountStats(transactions: Balance[], orders: BinaryOrder[]) {
    const totalDeposits = transactions
      .filter(t => t.type === BALANCE_TYPES.DEPOSIT)
      .reduce((sum, t) => sum + t.amount, 0);

    const totalWithdrawals = transactions
      .filter(t => t.type === BALANCE_TYPES.WITHDRAWAL)
      .reduce((sum, t) => sum + t.amount, 0);

    const totalOrders = orders.length;
    const activeOrders = orders.filter(o => o.status === ORDER_STATUS.ACTIVE).length;
    const wonOrders = orders.filter(o => o.status === ORDER_STATUS.WON).length;
    const lostOrders = orders.filter(o => o.status === ORDER_STATUS.LOST).length;

    const totalProfit = orders
      .filter(o => o.profit !== null)
      .reduce((sum, o) => sum + (o.profit || 0), 0);

    const winRate = (wonOrders + lostOrders) > 0 
      ? Math.round((wonOrders / (wonOrders + lostOrders)) * 100) 
      : 0;

    return {
      balance: {
        totalDeposits,
        totalWithdrawals,
        netDeposits: totalDeposits - totalWithdrawals,
        transactionCount: transactions.length,
      },
      trading: {
        totalOrders,
        activeOrders,
        wonOrders,
        lostOrders,
        winRate,
        totalProfit,
      },
    };
  }

  /**
   * ✅ HELPER: Calculate trading statistics
   */
  private calculateTradingStats(orders: BinaryOrder[]) {
    // Overall stats
    const overall = {
      totalOrders: orders.length,
      wonOrders: orders.filter(o => o.status === ORDER_STATUS.WON).length,
      lostOrders: orders.filter(o => o.status === ORDER_STATUS.LOST).length,
      activeOrders: orders.filter(o => o.status === ORDER_STATUS.ACTIVE).length,
      totalProfit: orders.reduce((sum, o) => sum + (o.profit || 0), 0),
    };

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

    return {
      overall,
      byAsset,
      byDirection,
    };
  }
}