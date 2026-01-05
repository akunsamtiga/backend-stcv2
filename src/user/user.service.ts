// src/user/user.service.ts
// ✅ FIXED: Better error handling & fallback for profile

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

  // ✅ FIXED: Much safer profile loading with fallbacks
  async getProfile(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();

      // Get user data
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      const { password, ...userWithoutPassword } = user;

      // Get balances with fallback
      let balances;
      try {
        balances = await this.balanceService.getBothBalances(userId);
      } catch (error) {
        this.logger.error(`❌ Balance fetch error: ${error.message}`);
        balances = {
          realBalance: 0,
          demoBalance: 10000000,
          realTransactions: 0,
          demoTransactions: 1,
        };
      }

      // Get status info with fallback
      let statusInfo;
      try {
        statusInfo = await this.userStatusService.getUserStatusInfo(userId);
      } catch (error) {
        this.logger.error(`❌ Status info error: ${error.message}`);
        statusInfo = {
          status: user.status || 'standard',
          totalDeposit: 0,
          profitBonus: 0,
          progress: 0,
        };
      }

      // Get balance history with fallback
      let balanceHistory;
      try {
        balanceHistory = await this.balanceService.getBalanceHistory(userId, { 
          page: 1, 
          limit: 20 
        });
      } catch (error) {
        this.logger.error(`❌ Balance history error: ${error.message}`);
        balanceHistory = {
          transactions: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        };
      }

      // Get orders with fallback
      let orders: BinaryOrder[] = [];
      try {
        orders = await this.getOrders(userId, db);
      } catch (error) {
        this.logger.error(`❌ Orders fetch error: ${error.message}`);
        orders = [];
      }

      // Get affiliate stats with fallback
      let affiliateStats;
      try {
        affiliateStats = await this.getAffiliateStats(userId);
      } catch (error) {
        this.logger.error(`❌ Affiliate stats error: ${error.message}`);
        affiliateStats = {
          totalReferrals: 0,
          completedReferrals: 0,
          pendingReferrals: 0,
          totalCommission: 0,
          referrals: [],
        };
      }

      const realTransactions = balanceHistory.transactions?.filter(
        t => t.accountType === BALANCE_ACCOUNT_TYPE.REAL
      ) || [];
      
      const demoTransactions = balanceHistory.transactions?.filter(
        t => t.accountType === BALANCE_ACCOUNT_TYPE.DEMO
      ) || [];

      const realOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.REAL);
      const demoOrders = orders.filter(o => o.accountType === BALANCE_ACCOUNT_TYPE.DEMO);

      return {
        user: {
          ...userWithoutPassword,
          status: user.status || 'standard',
        },
        
        statusInfo: {
          current: statusInfo.status,
          totalDeposit: statusInfo.totalDeposit || 0,
          profitBonus: `+${statusInfo.profitBonus || 0}%`,
          nextStatus: statusInfo.nextStatus || 'Max Level',
          progress: Math.round(statusInfo.progress || 100),
          depositNeeded: statusInfo.nextStatusAt 
            ? Math.max(0, statusInfo.nextStatusAt - (statusInfo.totalDeposit || 0))
            : 0,
        },
        
        affiliate: {
          referralCode: user.referralCode || 'N/A',
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

    } catch (error) {
      this.logger.error(`❌ getProfile error: ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }

  // ✅ FIXED: Safer affiliate stats
  async getAffiliateStats(userId: string): Promise<AffiliateStats> {
    try {
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

    } catch (error) {
      this.logger.error(`❌ getAffiliateStats error: ${error.message}`);
      
      return {
        totalReferrals: 0,
        completedReferrals: 0,
        pendingReferrals: 0,
        totalCommission: 0,
        referrals: [],
      };
    }
  }

  async getDetailedAffiliateStats(userId: string) {
    try {
      const db = this.firebaseService.getFirestore();

      const affiliatesSnapshot = await db.collection(COLLECTIONS.AFFILIATES)
        .where('referrer_id', '==', userId)
        .get();

      const referrals = affiliatesSnapshot.docs.map(doc => doc.data() as Affiliate);

      const referralsWithDetails = await Promise.all(
        referrals.map(async (referral) => {
          try {
            const refereeDoc = await db.collection(COLLECTIONS.USERS).doc(referral.referee_id).get();
            const refereeData = refereeDoc.exists ? refereeDoc.data() : null;

            return {
              ...referral,
              refereeEmail: refereeData?.email || 'Unknown',
              refereeStatus: refereeData?.status || 'standard',
            };
          } catch (error) {
            return {
              ...referral,
              refereeEmail: 'Unknown',
              refereeStatus: 'standard',
            };
          }
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

    } catch (error) {
      this.logger.error(`❌ getDetailedAffiliateStats error: ${error.message}`);
      
      return {
        summary: {
          totalReferrals: 0,
          completedReferrals: 0,
          pendingReferrals: 0,
          totalCommission: 0,
        },
        referrals: [],
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
  }

  // ✅ FIXED: Safer orders fetch
  private async getOrders(userId: string, db: FirebaseFirestore.Firestore): Promise<BinaryOrder[]> {
    try {
      const snapshot = await db.collection(COLLECTIONS.ORDERS)
        .where('user_id', '==', userId)
        .limit(20)
        .get();

      return snapshot.docs.map(doc => doc.data() as BinaryOrder);

    } catch (error) {
      this.logger.error(`❌ getOrders error: ${error.message}`);
      return [];
    }
  }

  private calculateWinRate(orders: BinaryOrder[]): number {
    const closedOrders = orders.filter(o => o.status === 'WON' || o.status === 'LOST');
    if (closedOrders.length === 0) return 0;

    const wins = closedOrders.filter(o => o.status === 'WON').length;
    return Math.round((wins / closedOrders.length) * 100);
  }
}