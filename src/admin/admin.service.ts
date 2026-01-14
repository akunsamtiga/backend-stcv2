// src/admin/admin.service.ts
import { Injectable, NotFoundException, ConflictException, Logger, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { UserStatusService } from '../user/user-status.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ManageBalanceDto } from './dto/manage-balance.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { COLLECTIONS, BALANCE_TYPES, ORDER_STATUS, BALANCE_ACCOUNT_TYPE, USER_STATUS, AFFILIATE_STATUS } from '../common/constants';
import { User, Balance, BinaryOrder, Affiliate } from '../common/interfaces';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
    private userStatusService: UserStatusService,
  ) {}

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
      status: USER_STATUS.STANDARD,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
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

    this.logger.log(`✅ User created by admin: ${createUserDto.email} (Status: STANDARD, Real: Rp 0, Demo: Rp 10,000,000)`);

    const { password, ...userWithoutPassword } = userData;
    return {
      message: 'User created successfully with real and demo accounts',
      user: userWithoutPassword,
      initialBalances: {
        real: 0,
        demo: 10000000,
      },
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
          const balances = await this.balanceService.getBothBalances(user.id);
          const statusInfo = await this.userStatusService.getUserStatusInfo(user.id);
          
          return {
            ...user,
            status: user.status || USER_STATUS.STANDARD,
            realBalance: balances.realBalance,
            demoBalance: balances.demoBalance,
            statusInfo: {
              totalDeposit: statusInfo.totalDeposit,
              profitBonus: statusInfo.profitBonus,
              nextStatus: statusInfo.nextStatus,
            },
          };
        }
        
        return {
          ...user,
          status: user.status || USER_STATUS.STANDARD,
        };
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
    
    const statusInfo = await this.userStatusService.getUserStatusInfo(userId);
    
    return {
      ...user,
      status: user.status || USER_STATUS.STANDARD,
      statusInfo: {
        totalDeposit: statusInfo.totalDeposit,
        profitBonus: statusInfo.profitBonus,
        nextStatus: statusInfo.nextStatus,
        progress: statusInfo.progress,
      },
    };
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

  async manageUserBalance(
    userId: string, 
    manageBalanceDto: ManageBalanceDto,
    adminId: string
  ) {
    await this.getUserById(userId);

    const { accountType } = manageBalanceDto;

    if (accountType !== BALANCE_ACCOUNT_TYPE.REAL && accountType !== BALANCE_ACCOUNT_TYPE.DEMO) {
      throw new BadRequestException('Invalid account type. Must be "real" or "demo"');
    }

    const currentBalance = await this.balanceService.getCurrentBalance(userId, accountType);

    if (manageBalanceDto.type === 'withdrawal' && currentBalance < manageBalanceDto.amount) {
      throw new BadRequestException(
        `Insufficient ${accountType} balance. Current: ${currentBalance}, Requested: ${manageBalanceDto.amount}`
      );
    }

    const result = await this.balanceService.createBalanceEntry(userId, {
      accountType,
      type: manageBalanceDto.type === 'deposit' ? BALANCE_TYPES.DEPOSIT : BALANCE_TYPES.WITHDRAWAL,
      amount: manageBalanceDto.amount,
      description: `${manageBalanceDto.description} (by admin)`,
    }, true);

    if (accountType === BALANCE_ACCOUNT_TYPE.REAL && manageBalanceDto.type === 'deposit') {
      const statusUpdate = await this.userStatusService.updateUserStatus(userId);
      
      if (statusUpdate.changed) {
        this.logger.log(
          `🎉 User ${userId} upgraded by admin: ${statusUpdate.oldStatus.toUpperCase()} → ${statusUpdate.newStatus.toUpperCase()}`
        );
      }
    }

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

  async getUserBalance(userId: string) {
  const user = await this.getUserById(userId);
  const summary = await this.balanceService.getBothBalances(userId);
  const statusInfo = await this.userStatusService.getUserStatusInfo(userId);
  const history = await this.balanceService.getBalanceHistory(userId, { 
    page: 1, 
    limit: 20 
  });

  const transactions = history.transactions as Balance[];
  
  const realTransactions = transactions.filter(
    t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL
  );
  const demoTransactions = transactions.filter(
    t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    statusInfo: {
      current: statusInfo.status,
      totalDeposit: statusInfo.totalDeposit,
      profitBonus: statusInfo.profitBonus,
      nextStatus: statusInfo.nextStatus,
      progress: statusInfo.progress,
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

  async getAllUsersWithBalance() {
    const db = this.firebaseService.getFirestore();
    const usersSnapshot = await db.collection(COLLECTIONS.USERS).get();
    
    const usersWithBalance = await Promise.all(
      usersSnapshot.docs.map(async (doc) => {
        const { password, ...user } = doc.data() as User;
        
        try {
          const balances = await this.balanceService.getBothBalances(user.id);
          const statusInfo = await this.userStatusService.getUserStatusInfo(user.id);
          
          return {
            ...user,
            status: user.status || USER_STATUS.STANDARD,
            realBalance: balances.realBalance,
            demoBalance: balances.demoBalance,
            combinedBalance: balances.realBalance + balances.demoBalance,
            statusInfo: {
              totalDeposit: statusInfo.totalDeposit,
              profitBonus: statusInfo.profitBonus,
            },
          };
        } catch (error) {
          return {
            ...user,
            status: user.status || USER_STATUS.STANDARD,
            realBalance: 0,
            demoBalance: 0,
            combinedBalance: 0,
            statusInfo: {
              totalDeposit: 0,
              profitBonus: 0,
            },
          };
        }
      })
    );

    const totalRealBalance = usersWithBalance.reduce((sum, user) => sum + user.realBalance, 0);
    const totalDemoBalance = usersWithBalance.reduce((sum, user) => sum + user.demoBalance, 0);
    const activeUsers = usersWithBalance.filter(u => u.isActive).length;
    
    const statusCounts = {
      standard: usersWithBalance.filter(u => u.status === USER_STATUS.STANDARD).length,
      gold: usersWithBalance.filter(u => u.status === USER_STATUS.GOLD).length,
      vip: usersWithBalance.filter(u => u.status === USER_STATUS.VIP).length,
    };

    return {
      users: usersWithBalance,
      summary: {
        totalUsers: usersWithBalance.length,
        activeUsers,
        totalRealBalance,
        totalDemoBalance,
        combinedBalance: totalRealBalance + totalDemoBalance,
        statusDistribution: statusCounts,
      },
    };
  }

  async getUserHistory(userId: string) {
    const user = await this.getUserById(userId);
    const db = this.firebaseService.getFirestore();

    const balanceSnapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const balanceHistory: Balance[] = balanceSnapshot.docs.map(doc => doc.data() as Balance);
    const realBalanceHistory: Balance[] = balanceHistory.filter(b => b.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoBalanceHistory: Balance[] = balanceHistory.filter(b => b.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const ordersHistory: BinaryOrder[] = ordersSnapshot.docs.map(doc => doc.data() as BinaryOrder);
    const realOrders: BinaryOrder[] = ordersHistory.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoOrders: BinaryOrder[] = ordersHistory.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const realStats = this.calculateAccountStats(realBalanceHistory, realOrders);
    const demoStats = this.calculateAccountStats(demoBalanceHistory, demoOrders);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
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

  async getUserTradingStats(userId: string) {
    const user = await this.getUserById(userId);
    const db = this.firebaseService.getFirestore();

    const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId)
      .get();

    const orders: BinaryOrder[] = ordersSnapshot.docs.map(doc => doc.data() as BinaryOrder);
    const realOrders: BinaryOrder[] = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoOrders: BinaryOrder[] = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const realStats = this.calculateTradingStats(realOrders);
    const demoStats = this.calculateTradingStats(demoOrders);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentRealOrders: BinaryOrder[] = realOrders.filter(
      o => new Date(o.createdAt) >= sevenDaysAgo
    );

    const recentDemoOrders: BinaryOrder[] = demoOrders.filter(
      o => new Date(o.createdAt) >= sevenDaysAgo
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
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

  async getSystemStatistics() {
    const db = this.firebaseService.getFirestore();

    const usersSnapshot = await db.collection(COLLECTIONS.USERS).get();
    const users: User[] = usersSnapshot.docs.map(doc => doc.data() as User);

    const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS).get();
    const orders: BinaryOrder[] = ordersSnapshot.docs.map(doc => doc.data() as BinaryOrder);

    const balanceSnapshot = await db.collection(COLLECTIONS.BALANCE).get();
    const transactions: Balance[] = balanceSnapshot.docs.map(doc => doc.data() as Balance);

    const affiliatesSnapshot = await db.collection(COLLECTIONS.AFFILIATES).get();
    const affiliates: Affiliate[] = affiliatesSnapshot.docs.map(doc => doc.data() as Affiliate);

    const realOrders: BinaryOrder[] = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoOrders: BinaryOrder[] = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const realTransactions: Balance[] = transactions.filter(t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoTransactions: Balance[] = transactions.filter(t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.isActive).length;
    const adminUsers = users.filter(u => u.role !== 'user').length;

    const statusCounts = {
      standard: users.filter(u => (u.status || USER_STATUS.STANDARD) === USER_STATUS.STANDARD).length,
      gold: users.filter(u => u.status === USER_STATUS.GOLD).length,
      vip: users.filter(u => u.status === USER_STATUS.VIP).length,
    };

    const completedAffiliates: Affiliate[] = affiliates.filter(a => a.status === AFFILIATE_STATUS.COMPLETED);
    const pendingAffiliates: Affiliate[] = affiliates.filter(a => a.status === AFFILIATE_STATUS.PENDING);
    const totalAffiliateCommissions = completedAffiliates.reduce((sum, a) => sum + a.commission_amount, 0);

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
      affiliateCommissions: realTransactions
        .filter(t => t.type === BALANCE_TYPES.AFFILIATE_COMMISSION)
        .reduce((sum, t) => sum + t.amount, 0),
    };

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
        statusDistribution: statusCounts,
      },
      affiliate: {
        totalReferrals: affiliates.length,
        completedReferrals: completedAffiliates.length,
        pendingReferrals: pendingAffiliates.length,
        totalCommissionsPaid: totalAffiliateCommissions,
        commissionRate: 25000,
        conversionRate: affiliates.length > 0 
          ? Math.round((completedAffiliates.length / affiliates.length) * 100) 
          : 0,
      },
      realAccount: {
        trading: {
          ...realStats,
          winRate: realWinRate,
        },
        financial: {
          totalDeposits: realStats.totalDeposits,
          totalWithdrawals: realStats.totalWithdrawals,
          affiliateCommissions: realStats.affiliateCommissions,
          netFlow: realStats.totalDeposits - realStats.totalWithdrawals - realStats.affiliateCommissions,
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

  private calculateTradingStats(orders: BinaryOrder[]) {
    const overall = {
      totalOrders: orders.length,
      wonOrders: orders.filter(o => o.status === ORDER_STATUS.WON).length,
      lostOrders: orders.filter(o => o.status === ORDER_STATUS.LOST).length,
      activeOrders: orders.filter(o => o.status === ORDER_STATUS.ACTIVE).length,
      totalProfit: orders.reduce((sum, o) => sum + (o.profit || 0), 0),
    };

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