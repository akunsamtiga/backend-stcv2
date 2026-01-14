// src/user/user-status.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE, USER_STATUS, STATUS_REQUIREMENTS } from '../common/constants';
import { Balance, UserStatusInfo } from '../common/interfaces';

@Injectable()
export class UserStatusService {
  private readonly logger = new Logger(UserStatusService.name);
  
  private statusCache: Map<string, { status: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000;

  constructor(private firebaseService: FirebaseService) {
    setInterval(() => this.cleanupCache(), 300000);
  }

  // ✅ FIXED: Safer deposit calculation
  async calculateTotalRealDeposit(userId: string): Promise<number> {
    try {
      const db = this.firebaseService.getFirestore();
      
      const snapshot = await db.collection(COLLECTIONS.BALANCE)
        .where('user_id', '==', userId)
        .where('accountType', '==', BALANCE_ACCOUNT_TYPE.REAL)
        .where('type', '==', BALANCE_TYPES.DEPOSIT)
        .get();

      let total = 0;
      snapshot.forEach(doc => {
        const data = doc.data() as Balance;
        total += data.amount;
      });

      return total;

    } catch (error) {
      this.logger.error(`❌ calculateTotalRealDeposit error: ${error.message}`);
      return 0;
    }
  }

  determineStatus(totalDeposit: number): 'standard' | 'gold' | 'vip' {
    if (totalDeposit >= STATUS_REQUIREMENTS.VIP.minDeposit) {
      return USER_STATUS.VIP;
    }
    if (totalDeposit >= STATUS_REQUIREMENTS.GOLD.minDeposit) {
      return USER_STATUS.GOLD;
    }
    return USER_STATUS.STANDARD;
  }

  getProfitBonus(status: 'standard' | 'gold' | 'vip'): number {
    const statusKey = status.toUpperCase() as keyof typeof STATUS_REQUIREMENTS;
    return STATUS_REQUIREMENTS[statusKey].profitBonus;
  }

  // ✅ FIXED: Safer status update
  async updateUserStatus(userId: string): Promise<{ 
    oldStatus: string; 
    newStatus: string; 
    totalDeposit: number; 
    profitBonus: number;
    changed: boolean;
  }> {
    try {
      const db = this.firebaseService.getFirestore();
      
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const userData = userDoc.data();
      const oldStatus = userData?.status || USER_STATUS.STANDARD;

      const totalDeposit = await this.calculateTotalRealDeposit(userId);
      const newStatus = this.determineStatus(totalDeposit);
      const profitBonus = this.getProfitBonus(newStatus);

      if (oldStatus !== newStatus) {
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
          status: newStatus,
          updatedAt: new Date().toISOString(),
        });

        this.statusCache.set(userId, {
          status: newStatus,
          timestamp: Date.now(),
        });

        this.logger.log(
          `✅ Status upgraded: ${userId} → ${oldStatus.toUpperCase()} to ${newStatus.toUpperCase()} ` +
          `(Total Deposit: Rp ${totalDeposit.toLocaleString()}, Bonus: +${profitBonus}%)`
        );

        return {
          oldStatus,
          newStatus,
          totalDeposit,
          profitBonus,
          changed: true,
        };
      }

      return {
        oldStatus,
        newStatus,
        totalDeposit,
        profitBonus,
        changed: false,
      };

    } catch (error) {
      this.logger.error(`❌ updateUserStatus error: ${error.message}`);
      
      return {
        oldStatus: 'standard',
        newStatus: 'standard',
        totalDeposit: 0,
        profitBonus: 0,
        changed: false,
      };
    }
  }

  // ✅ FIXED: Safer status info
  async getUserStatusInfo(userId: string): Promise<UserStatusInfo> {
    try {
      const cached = this.statusCache.get(userId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        const totalDeposit = await this.calculateTotalRealDeposit(userId);
        const profitBonus = this.getProfitBonus(cached.status as any);
        
        return this.buildStatusInfo(cached.status as any, totalDeposit, profitBonus);
      }

      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const userData = userDoc.data();
      const currentStatus = userData?.status || USER_STATUS.STANDARD;
      const totalDeposit = await this.calculateTotalRealDeposit(userId);
      const profitBonus = this.getProfitBonus(currentStatus);

      this.statusCache.set(userId, {
        status: currentStatus,
        timestamp: Date.now(),
      });

      return this.buildStatusInfo(currentStatus, totalDeposit, profitBonus);

    } catch (error) {
      this.logger.error(`❌ getUserStatusInfo error: ${error.message}`);
      
      return {
        status: 'standard',
        totalDeposit: 0,
        profitBonus: 0,
        progress: 0,
      };
    }
  }

  private buildStatusInfo(
    status: 'standard' | 'gold' | 'vip', 
    totalDeposit: number, 
    profitBonus: number
  ): UserStatusInfo {
    const info: UserStatusInfo = {
      status,
      totalDeposit,
      profitBonus,
    };

    if (status === USER_STATUS.STANDARD) {
      info.nextStatus = 'Gold';
      info.nextStatusAt = STATUS_REQUIREMENTS.GOLD.minDeposit;
      info.progress = Math.min(100, (totalDeposit / STATUS_REQUIREMENTS.GOLD.minDeposit) * 100);
    } else if (status === USER_STATUS.GOLD) {
      info.nextStatus = 'VIP';
      info.nextStatusAt = STATUS_REQUIREMENTS.VIP.minDeposit;
      const goldRange = STATUS_REQUIREMENTS.VIP.minDeposit - STATUS_REQUIREMENTS.GOLD.minDeposit;
      const goldProgress = totalDeposit - STATUS_REQUIREMENTS.GOLD.minDeposit;
      info.progress = Math.min(100, (goldProgress / goldRange) * 100);
    } else {
      info.progress = 100;
    }

    return info;
  }

  async getUserStatus(userId: string): Promise<'standard' | 'gold' | 'vip'> {
    try {
      const cached = this.statusCache.get(userId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.status as any;
      }

      const db = this.firebaseService.getFirestore();
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      
      if (!userDoc.exists) {
        return USER_STATUS.STANDARD;
      }

      const userData = userDoc.data();
      const status = userData?.status || USER_STATUS.STANDARD;

      this.statusCache.set(userId, {
        status,
        timestamp: Date.now(),
      });

      return status;

    } catch (error) {
      this.logger.error(`❌ getUserStatus error: ${error.message}`);
      return USER_STATUS.STANDARD;
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [userId, cached] of this.statusCache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL * 5) {
        this.statusCache.delete(userId);
      }
    }
  }

  clearUserCache(userId: string): void {
    this.statusCache.delete(userId);
  }
}