// src/voucher/voucher.service.ts
// ✅ FINAL VERSION - Fixed Firebase initialization with OnModuleInit

import { Injectable, NotFoundException, BadRequestException, ConflictException, OnModuleInit } from '@nestjs/common';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { Voucher, VoucherUsage } from '../common/interfaces';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class VoucherService implements OnModuleInit {
  private vouchersCollection: FirebaseFirestore.CollectionReference;
  private voucherUsagesCollection: FirebaseFirestore.CollectionReference;

  // ✅ FIXED: Constructor hanya inject service, tidak initialize Firestore
  constructor(private firebaseService: FirebaseService) {}

  // ✅ FIXED: Initialize Firestore setelah module ready
  onModuleInit() {
    try {
      const db = this.firebaseService.getFirestore();
      this.vouchersCollection = db.collection('vouchers');
      this.voucherUsagesCollection = db.collection('voucher_usages');
      console.log('VoucherService: Firestore collections initialized successfully');
    } catch (error) {
      console.error('VoucherService: Failed to initialize Firestore collections', error);
      throw error;
    }
  }

  // ============================================
  // ADMIN METHODS
  // ============================================

  async createVoucher(createVoucherDto: CreateVoucherDto, adminId: string): Promise<Voucher> {
    try {
      // Check if voucher code already exists
      const existingVoucher = await this.vouchersCollection
        .where('code', '==', createVoucherDto.code.toUpperCase())
        .limit(1)
        .get();

      if (!existingVoucher.empty) {
        throw new ConflictException('Voucher code already exists');
      }

      const now = new Date().toISOString();
      const voucherData: Omit<Voucher, 'id'> = {
        code: createVoucherDto.code.toUpperCase(),
        type: createVoucherDto.type,
        value: createVoucherDto.value,
        minDeposit: createVoucherDto.minDeposit,
        eligibleStatuses: createVoucherDto.eligibleStatuses || ['standard', 'gold', 'vip'],
        maxUses: createVoucherDto.maxUses || undefined,
        usedCount: 0,
        maxUsesPerUser: createVoucherDto.maxUsesPerUser || 1,
        maxBonusAmount: createVoucherDto.maxBonusAmount || undefined,
        isActive: createVoucherDto.isActive !== false,
        validFrom: createVoucherDto.validFrom,
        validUntil: createVoucherDto.validUntil,
        description: createVoucherDto.description || '',
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await this.vouchersCollection.add(voucherData);

      return {
        id: docRef.id,
        ...voucherData,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new BadRequestException('Failed to create voucher: ' + error.message);
    }
  }

  async getAllVouchers(options?: { 
    page?: number; 
    limit?: number; 
    isActive?: boolean 
  }): Promise<{
    vouchers: Voucher[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    try {
      const page = options?.page || 1;
      const limit = options?.limit || 20;
      const offset = (page - 1) * limit;

      let query = this.vouchersCollection.orderBy('createdAt', 'desc');

      // Filter by active status if specified
      if (options?.isActive !== undefined) {
        query = query.where('isActive', '==', options.isActive) as any;
      }

      // Get total count for pagination
      const countSnapshot = await query.get();
      const total = countSnapshot.size;

      // Get paginated results
      const snapshot = await query
        .offset(offset)
        .limit(limit)
        .get();

      const vouchers: Voucher[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
        } as Voucher;
      });

      return {
        vouchers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new BadRequestException('Failed to fetch vouchers: ' + error.message);
    }
  }

  async getVoucherById(voucherId: string): Promise<Voucher> {
    try {
      const doc = await this.vouchersCollection.doc(voucherId).get();

      if (!doc.exists) {
        throw new NotFoundException('Voucher not found');
      }

      const data = doc.data();
      return {
        ...data,
        id: doc.id,
      } as Voucher;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch voucher: ' + error.message);
    }
  }

  async getVoucherStatistics(voucherId: string): Promise<{
    voucher: {
      id: string;
      code: string;
      type: string;
      value: number;
    };
    statistics: {
      totalUsed: number;
      totalBonusGiven: number;
      totalDepositAmount: number;
      averageBonus: number;
      remainingUses: number | null;
    };
    recentUsages: VoucherUsage[];
  }> {
    try {
      const voucher = await this.getVoucherById(voucherId);

      // Get usage statistics
      const usagesSnapshot = await this.voucherUsagesCollection
        .where('voucherId', '==', voucherId)
        .orderBy('usedAt', 'desc')
        .get();

      const usages: VoucherUsage[] = usagesSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
        } as VoucherUsage;
      });

      const totalUsed = usages.length;
      const totalBonusGiven = usages.reduce((sum, usage) => sum + (usage.bonusAmount || 0), 0);
      const totalDepositAmount = usages.reduce((sum, usage) => sum + (usage.depositAmount || 0), 0);
      const averageBonus = totalUsed > 0 ? totalBonusGiven / totalUsed : 0;
      
      let remainingUses: number | null = null;
      if (voucher.maxUses) {
        remainingUses = voucher.maxUses - voucher.usedCount;
      }

      // Get recent 10 usages
      const recentUsages = usages.slice(0, 10);

      return {
        voucher: {
          id: voucher.id,
          code: voucher.code,
          type: voucher.type,
          value: voucher.value,
        },
        statistics: {
          totalUsed,
          totalBonusGiven,
          totalDepositAmount,
          averageBonus: Math.round(averageBonus),
          remainingUses,
        },
        recentUsages,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch voucher statistics: ' + error.message);
    }
  }

  async updateVoucher(voucherId: string, updateVoucherDto: UpdateVoucherDto): Promise<Voucher> {
    try {
      const voucherRef = this.vouchersCollection.doc(voucherId);
      const doc = await voucherRef.get();

      if (!doc.exists) {
        throw new NotFoundException('Voucher not found');
      }

      // Create updateData with index signature for dynamic property access
      const updateData: Partial<Voucher> & { [key: string]: any } = {
        ...updateVoucherDto,
        updatedAt: new Date().toISOString(),
      };

      // Remove undefined fields
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      await voucherRef.update(updateData);

      const updated = await voucherRef.get();
      const data = updated.data();
      return {
        ...data,
        id: updated.id,
      } as Voucher;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to update voucher: ' + error.message);
    }
  }

  async deleteVoucher(voucherId: string): Promise<{ success: boolean }> {
    try {
      const voucherRef = this.vouchersCollection.doc(voucherId);
      const doc = await voucherRef.get();

      if (!doc.exists) {
        throw new NotFoundException('Voucher not found');
      }

      // Soft delete by marking as inactive
      await voucherRef.update({
        isActive: false,
        deletedAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to delete voucher: ' + error.message);
    }
  }

  // ============================================
  // USER METHODS
  // ============================================

  async validateVoucher(code: string, depositAmount: number, user: any): Promise<{
    valid: boolean;
    bonusAmount?: number;
    message?: string;
    voucher?: {
      type: string;
      value: number;
      minDeposit: number;
      maxBonusAmount?: number;
    };
  }> {
    try {
      // Find voucher by code
      const snapshot = await this.vouchersCollection
        .where('code', '==', code.toUpperCase())
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return {
          valid: false,
          message: 'Voucher not found or inactive',
        };
      }

      const voucherDoc = snapshot.docs[0];
      const data = voucherDoc.data();
      
      const voucher: Voucher = {
        ...data,
        id: voucherDoc.id,
      } as Voucher;

      // Check if voucher is expired
      const now = new Date();
      const validFrom = new Date(voucher.validFrom);
      const validUntil = new Date(voucher.validUntil);

      if (now < validFrom) {
        return {
          valid: false,
          message: 'Voucher is not yet valid',
        };
      }

      if (now > validUntil) {
        return {
          valid: false,
          message: 'Voucher has expired',
        };
      }

      // Check min deposit
      if (depositAmount < voucher.minDeposit) {
        return {
          valid: false,
          message: `Minimum deposit is ${this.formatCurrency(voucher.minDeposit)}`,
        };
      }

      // Check user eligibility
      if (!voucher.eligibleStatuses.includes(user.status)) {
        return {
          valid: false,
          message: 'You are not eligible for this voucher',
        };
      }

      // Check max uses
      if (voucher.maxUses && voucher.usedCount >= voucher.maxUses) {
        return {
          valid: false,
          message: 'Voucher usage limit reached',
        };
      }

      // Check user usage limit
      const userUsages = await this.voucherUsagesCollection
        .where('voucherId', '==', voucherDoc.id)
        .where('userId', '==', user.id)
        .get();

      if (userUsages.size >= voucher.maxUsesPerUser) {
        return {
          valid: false,
          message: `You can only use this voucher ${voucher.maxUsesPerUser} time(s)`,
        };
      }

      // Calculate bonus
      let bonusAmount = 0;
      if (voucher.type === 'percentage') {
        bonusAmount = Math.floor(depositAmount * (voucher.value / 100));
        
        // Apply max bonus cap if set
        if (voucher.maxBonusAmount && bonusAmount > voucher.maxBonusAmount) {
          bonusAmount = voucher.maxBonusAmount;
        }
      } else if (voucher.type === 'fixed') {
        bonusAmount = voucher.value;
      }

      return {
        valid: true,
        bonusAmount,
        message: 'Voucher is valid',
        voucher: {
          type: voucher.type,
          value: voucher.value,
          minDeposit: voucher.minDeposit,
          maxBonusAmount: voucher.maxBonusAmount,
        },
      };
    } catch (error) {
      throw new BadRequestException('Failed to validate voucher: ' + error.message);
    }
  }

  async recordVoucherUsage(
    voucherId: string,
    voucherCode: string,
    userId: string,
    userEmail: string,
    depositId: string,
    depositAmount: number,
    bonusAmount: number,
  ): Promise<{ success: boolean }> {
    try {
      // Record usage
      const usageData: Omit<VoucherUsage, 'id'> = {
        voucherId,
        voucherCode: voucherCode.toUpperCase(),
        userId,
        userEmail,
        depositId,
        depositAmount,
        bonusAmount,
        usedAt: new Date().toISOString(),
      };

      await this.voucherUsagesCollection.add(usageData);

      // Increment used count
      const voucherRef = this.vouchersCollection.doc(voucherId);
      const voucherDoc = await voucherRef.get();
      
      if (!voucherDoc.exists) {
        throw new NotFoundException('Voucher not found');
      }

      const data = voucherDoc.data();
      const voucherData = {
        ...data,
        id: voucherDoc.id,
      } as Voucher;
      
      await voucherRef.update({
        usedCount: voucherData.usedCount + 1,
        updatedAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      throw new BadRequestException('Failed to record voucher usage: ' + error.message);
    }
  }

  async getMyVoucherHistory(userId: string): Promise<{
    usages: VoucherUsage[];
    summary: {
      totalUsed: number;
      totalBonusReceived: number;
    };
  }> {
    try {
      const snapshot = await this.voucherUsagesCollection
        .where('userId', '==', userId)
        .orderBy('usedAt', 'desc')
        .get();

      const usages: VoucherUsage[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
        } as VoucherUsage;
      });

      const totalUsed = usages.length;
      const totalBonusReceived = usages.reduce((sum, usage) => sum + (usage.bonusAmount || 0), 0);

      return {
        usages,
        summary: {
          totalUsed,
          totalBonusReceived,
        },
      };
    } catch (error) {
      throw new BadRequestException('Failed to fetch voucher history: ' + error.message);
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(amount);
  }
}