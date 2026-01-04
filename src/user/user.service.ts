import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { UserStatusService } from './user-status.service';
import { COLLECTIONS, BALANCE_ACCOUNT_TYPE, AFFILIATE_STATUS } from '../common/constants';
import { User, Balance, BinaryOrder, Affiliate, AffiliateStats } from '../common/interfaces';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
    private userStatusService: UserStatusService,
  ) {}

  async getProfile(userId: string) {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const user = userDoc.data() as User;

    const balances = await this.balanceService.getBothBalances(userId);
    const statusInfo = await this.userStatusService.getUserStatusInfo(userId);
    const balanceHistory = await this.balanceService.getBalanceHistory(userId, { 
      page: 1, 
      limit: 20 
    });

    const orders = await this.getOrders(userId, db);

    const realTransactions = balanceHistory.transactions.filter(
      t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL
    );
    const demoTransactions = balanceHistory.transactions.filter(
      t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO
    );

    const realOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
    const demoOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

    const affiliateStats = await this.getAffiliateStats(userId);

    const { password, ...userWithoutPassword } = user;

    return {
      user: {
        ...userWithoutPassword,
        status: user.status || 'standard',
      },
      
      statusInfo: {
        current: statusInfo.status,
        totalDeposit: statusInfo.totalDeposit,
        profitBonus: `+${statusInfo.profitBonus}%`,
        nextStatus: statusInfo.nextStatus || 'Max Level',
        progress: Math.round(statusInfo.progress || 100),
        depositNeeded: statusInfo.nextStatusAt 
          ? statusInfo.nextStatusAt - statusInfo.totalDeposit 
          : 0,
      },
      
      affiliate: {
        referralCode: user.referralCode,
        totalReferrals: affiliateStats.totalReferrals,
        completedReferrals: affiliateStats.completedReferrals,
        pendingReferrals: affiliateStats.pendingReferrals,
        totalCommission: affiliateStats.totalCommission,
      },
      
      balances: {
        real: balances.realBalance,
        demo: balances.demoBalance,
        combined: balances.realBalance + balances.demoBalance,
      },

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

  async getAffiliateStats(userId: string): Promise<AffiliateStats> {
    const db = this.firebaseService.getFirestore();

    const affiliatesSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
      .where('referrer_id', '==', userId)
      .get();

    const referrals = affiliatesSnapshot.docs.map(doc => doc.data() as Affiliate);

    const completedReferrals = referrals.filter(r => r.status === AFFILIATE_STATUS.COMPLETED);
    const pendingReferrals = referrals.filter(r => r.status === AFFILIATE_STATUS.PENDING);

    const totalCommission = completedReferrals.reduce((sum, r) => sum + r.commission_amount, 0);

    return {
      totalReferrals: referrals.length,
      completedReferrals: completedReferrals.length,
      pendingReferrals: pendingReferrals.length,
      totalCommission,
      referrals: referrals.slice(0, 10),
    };
  }

  async getDetailedAffiliateStats(userId: string) {
    const db = this.firebaseService.getFirestore();

    const affiliatesSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
      .where('referrer_id', '==', userId)
      .get();

    const referrals = affiliatesSnapshot.docs.map(doc => doc.data() as Affiliate);

    const referralsWithDetails = await Promise.all(
      referrals.map(async (referral) => {
        const refereeDoc = await db.collection(COLLECTIONS.USERS).doc(referral.referee_id).get();
        const refereeData = refereeDoc.exists ? refereeDoc.data() : null;

        return {
          ...referral,
          refereeEmail: refereeData?.email || 'Unknown',
          refereeStatus: refereeData?.status || 'standard',
        };
      })
    );

    const completedReferrals = referralsWithDetails.filter(r => r.status === AFFILIATE_STATUS.COMPLETED);
    const pendingReferrals = referralsWithDetails.filter(r => r.status === AFFILIATE_STATUS.PENDING);
    const totalCommission = completedReferrals.reduce((sum, r) => sum + r.commission_amount, 0);

    return {
      summary: {
        totalReferrals: referrals.length,
        completedReferrals: completedReferrals.length,
        pendingReferrals: pendingReferrals.length,
        totalCommission,
      },
      referrals: referralsWithDetails,
      instructions: {
        howToEarn: [
          'Share your referral code with friends',
          'Friend registers using your code',
          'Friend makes their first deposit (any amount)',
          'You receive Rp 25,000 commission instantly!',
        ],
        tips: [
          'No limit on referrals',
          'Commission paid immediately after first deposit',
          'Track all referrals in real-time',
        ],
      },
    };
  }

  private async getOrders(userId: string, db: FirebaseFirestore.Firestore): Promise<BinaryOrder[]> {
    const snapshot = await db.collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(20)
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