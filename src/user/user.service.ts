// src/user/user.service.ts
// ✅ UPDATED: Support both Real and Demo balances

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { COLLECTIONS, BALANCE_ACCOUNT_TYPE } from '../common/constants';
import { User, Balance, BinaryOrder } from '../common/interfaces';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
  ) {}

  /**
   * ✅ UPDATED: Get profile with both Real and Demo balances
   */
  async getProfile(userId: string) {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const user = userDoc.data() as User;

    // ✅ Get both balances
    const balances = await this.balanceService.getBothBalances(userId);

    // Get recent transactions (all)
    const balanceHistory = await this.balanceService.getBalanceHistory(userId, { 
      page: 1, 
      limit: 20 
    });

    // Get orders
    const orders = await this.getOrders(userId, db);

    // Separate transactions and orders by account type
    const realTransactions = balanceHistory.transactions.filter(
      t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL
    );
    const demoTransactions = balanceHistory.transactions.filter(
      t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO
    );

    const realOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const { password, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      
      // ✅ NEW: Separate balances
      balances: {
        real: balances.realBalance,
        demo: balances.demoBalance,
        combined: balances.realBalance + balances.demoBalance,
      },

      // ✅ NEW: Recent activity by account type
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

      // ✅ UPDATED: Statistics by account type
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
    };
  }

  /**
   * HELPER: Get orders
   */
  private async getOrders(userId: string, db: FirebaseFirestore.Firestore): Promise<BinaryOrder[]> {
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(20) // Get more for filtering
      .get();

    return snapshot.docs.map(doc => doc.data() as BinaryOrder);
  }

  /**
   * HELPER: Calculate win rate
   */
  private calculateWinRate(orders: BinaryOrder[]): number {
    const closedOrders = orders.filter(o => o.status === 'WON' || o.status === 'LOST');
    if (closedOrders.length === 0) return 0;

    const wins = closedOrders.filter(o => o.status === 'WON').length;
    return Math.round((wins / closedOrders.length) * 100);
  }
}