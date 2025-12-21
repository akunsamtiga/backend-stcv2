import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { COLLECTIONS } from '../common/constants';
import { CalculationUtil } from '../common/utils';
import { User, Balance, BinaryOrder } from '../common/interfaces';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private firebaseService: FirebaseService) {}

  async getProfile(userId: string) {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const user = userDoc.data() as User;

    const [balances, orders] = await Promise.all([
      this.getBalanceHistory(userId, db),
      this.getOrders(userId, db),
    ]);

    const totalBalance = CalculationUtil.calculateBalance(balances);

    const { password, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      balance: totalBalance,
      balanceHistory: balances.slice(0, 10),
      recentOrders: orders.slice(0, 5),
      statistics: {
        totalOrders: orders.length,
        activeOrders: orders.filter(o => o.status === 'ACTIVE').length,
        wonOrders: orders.filter(o => o.status === 'WON').length,
        lostOrders: orders.filter(o => o.status === 'LOST').length,
        winRate: this.calculateWinRate(orders),
      },
    };
  }

  private async getBalanceHistory(userId: string, db: FirebaseFirestore.Firestore): Promise<Balance[]> {
    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map(doc => doc.data() as Balance);
  }

  private async getOrders(userId: string, db: FirebaseFirestore.Firestore): Promise<BinaryOrder[]> {
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map(doc => doc.data() as BinaryOrder);
  }

  private calculateWinRate(orders: BinaryOrder[]): number {
    const closedOrders = orders.filter(o => o.status === 'WON' || o.status === 'LOST');
    if (closedOrders.length === 0) return 0;

    const wins = closedOrders.filter(o => o.status === 'WON').length;
    return Math.round((wins / closedOrders.length) * 100);
  }
}
