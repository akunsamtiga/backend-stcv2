import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { ValidateVoucherDto } from './dto/validate-voucher.dto';
import { COLLECTIONS, USER_STATUS } from '../common/constants';
import { Voucher, VoucherUsage, User } from '../common/interfaces';

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(private firebaseService: FirebaseService) {}

  async createVoucher(createVoucherDto: CreateVoucherDto, adminId: string) {
    const db = this.firebaseService.getFirestore();
    
    const code = createVoucherDto.code.toUpperCase().trim();
    
    const existingSnapshot = await db
      .collection(COLLECTIONS.VOUCHERS)
      .where('code', '==', code)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      throw new ConflictException(`Voucher code '${code}' already exists`);
    }

    const validFrom = new Date(createVoucherDto.validFrom);
    const validUntil = new Date(createVoucherDto.validUntil);
    
    if (validFrom >= validUntil) {
      throw new BadRequestException('Valid from date must be before valid until date');
    }

    if (createVoucherDto.type === 'percentage' && createVoucherDto.value > 100) {
      throw new BadRequestException('Percentage value cannot exceed 100%');
    }

    const voucherId = await this.firebaseService.generateId(COLLECTIONS.VOUCHERS);
    const timestamp = new Date().toISOString();

    const voucherData: Voucher = {
      id: voucherId,
      code,
      type: createVoucherDto.type,
      value: createVoucherDto.value,
      minDeposit: createVoucherDto.minDeposit,
      eligibleStatuses: createVoucherDto.eligibleStatuses.map(s => s.toLowerCase()),
      maxUses: createVoucherDto.maxUses,
      usedCount: 0,
      maxUsesPerUser: createVoucherDto.maxUsesPerUser || 1,
      maxBonusAmount: createVoucherDto.maxBonusAmount,
      isActive: createVoucherDto.isActive ?? true,
      validFrom: createVoucherDto.validFrom,
      validUntil: createVoucherDto.validUntil,
      description: createVoucherDto.description,
      createdBy: adminId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.collection(COLLECTIONS.VOUCHERS).doc(voucherId).set(voucherData);

    this.logger.log(`Voucher created: ${code} by admin ${adminId}`);

    return {
      message: 'Voucher created successfully',
      voucher: voucherData,
    };
  }

  async getAllVouchers(options?: { isActive?: boolean; page?: number; limit?: number }) {
    const db = this.firebaseService.getFirestore();
    const { isActive, page = 1, limit = 50 } = options || {};

    let query = db.collection(COLLECTIONS.VOUCHERS)
      .orderBy('createdAt', 'desc');

    if (isActive !== undefined) {
      query = query.where('isActive', '==', isActive) as any;
    }

    const snapshot = await query.get();
    const allVouchers = snapshot.docs.map(doc => doc.data() as Voucher);

    const total = allVouchers.length;
    const startIndex = (page - 1) * limit;
    const vouchers = allVouchers.slice(startIndex, startIndex + limit);

    return {
      vouchers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getVoucherById(voucherId: string) {
    const db = this.firebaseService.getFirestore();
    const doc = await db.collection(COLLECTIONS.VOUCHERS).doc(voucherId).get();
    
    if (!doc.exists) {
      throw new NotFoundException('Voucher not found');
    }

    return doc.data() as Voucher;
  }

  async updateVoucher(voucherId: string, updateVoucherDto: UpdateVoucherDto) {
    const db = this.firebaseService.getFirestore();
    
    const voucher = await this.getVoucherById(voucherId);
    
    if (updateVoucherDto.code && updateVoucherDto.code.toUpperCase() !== voucher.code) {
      const existingSnapshot = await db
        .collection(COLLECTIONS.VOUCHERS)
        .where('code', '==', updateVoucherDto.code.toUpperCase())
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        throw new ConflictException(`Voucher code '${updateVoucherDto.code}' already exists`);
      }
    }

    const updateData: any = {
      ...updateVoucherDto,
      updatedAt: new Date().toISOString(),
    };

    if (updateVoucherDto.code) {
      updateData.code = updateVoucherDto.code.toUpperCase().trim();
    }

    if (updateVoucherDto.eligibleStatuses) {
      updateData.eligibleStatuses = updateVoucherDto.eligibleStatuses.map(s => s.toLowerCase());
    }

    await db.collection(COLLECTIONS.VOUCHERS).doc(voucherId).update(updateData);

    this.logger.log(`Voucher updated: ${voucherId}`);

    return {
      message: 'Voucher updated successfully',
    };
  }

  async deleteVoucher(voucherId: string) {
    const db = this.firebaseService.getFirestore();
    
    await this.getVoucherById(voucherId);
    
    await db.collection(COLLECTIONS.VOUCHERS).doc(voucherId).delete();
    
    this.logger.log(`Voucher deleted: ${voucherId}`);
    
    return {
      message: 'Voucher deleted successfully',
    };
  }

  async getVoucherStatistics(voucherId: string) {
    const db = this.firebaseService.getFirestore();
    
    const voucher = await this.getVoucherById(voucherId);
    
    const usagesSnapshot = await db
      .collection(COLLECTIONS.VOUCHER_USAGES)
      .where('voucherId', '==', voucherId)
      .orderBy('usedAt', 'desc')
      .get();

    const usages = usagesSnapshot.docs.map(doc => doc.data() as VoucherUsage);
    
    const totalBonusGiven = usages.reduce((sum, u) => sum + u.bonusAmount, 0);
    const totalDepositAmount = usages.reduce((sum, u) => sum + u.depositAmount, 0);

    return {
      voucher: {
        id: voucher.id,
        code: voucher.code,
        type: voucher.type,
        value: voucher.value,
      },
      statistics: {
        totalUsed: usages.length,
        totalBonusGiven,
        totalDepositAmount,
        averageBonus: usages.length > 0 ? totalBonusGiven / usages.length : 0,
        remainingUses: voucher.maxUses ? voucher.maxUses - voucher.usedCount : null,
      },
      recentUsages: usages.slice(0, 10),
    };
  }

  async validateVoucher(userId: string, validateDto: ValidateVoucherDto): Promise<{
    valid: boolean;
    bonusAmount?: number;
    message?: string;
    voucher?: Voucher;
  }> {
    const db = this.firebaseService.getFirestore();
    const { code, depositAmount } = validateDto;

    try {
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }
      const user = userDoc.data() as User;

      const voucherSnapshot = await db
        .collection(COLLECTIONS.VOUCHERS)
        .where('code', '==', code.toUpperCase().trim())
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (voucherSnapshot.empty) {
        return { valid: false, message: 'Invalid or expired voucher code' };
      }

      const voucher = voucherSnapshot.docs[0].data() as Voucher;

      const now = new Date();
      const validFrom = new Date(voucher.validFrom);
      const validUntil = new Date(voucher.validUntil);

      if (now < validFrom) {
        return { valid: false, message: 'Voucher is not yet valid' };
      }

      if (now > validUntil) {
        return { valid: false, message: 'Voucher has expired' };
      }

      if (depositAmount < voucher.minDeposit) {
        return { 
          valid: false, 
          message: `Minimum deposit of Rp ${voucher.minDeposit.toLocaleString()} required for this voucher` 
        };
      }

      const userStatus = user.status || USER_STATUS.STANDARD;
      const isEligible = voucher.eligibleStatuses.includes('all') || 
                        voucher.eligibleStatuses.includes(userStatus);

      if (!isEligible) {
        return { 
          valid: false, 
          message: `This voucher is only available for ${voucher.eligibleStatuses.join(', ')} status` 
        };
      }

      if (voucher.maxUses && voucher.usedCount >= voucher.maxUses) {
        return { valid: false, message: 'Voucher usage limit reached' };
      }

      const userUsageCount = await this.getUserVoucherUsageCount(userId, voucher.id);
      if (userUsageCount >= voucher.maxUsesPerUser) {
        return { 
          valid: false, 
          message: `You have already used this voucher ${voucher.maxUsesPerUser} time(s)` 
        };
      }

      let bonusAmount: number;
      if (voucher.type === 'percentage') {
        bonusAmount = Math.floor(depositAmount * (voucher.value / 100));
        if (voucher.maxBonusAmount && bonusAmount > voucher.maxBonusAmount) {
          bonusAmount = voucher.maxBonusAmount;
        }
      } else {
        bonusAmount = voucher.value;
      }

      return {
        valid: true,
        bonusAmount,
        voucher,
        message: `Voucher valid! You will receive Rp ${bonusAmount.toLocaleString()} bonus`,
      };

    } catch (error) {
      this.logger.error(`validateVoucher error: ${error.message}`);
      return { valid: false, message: 'Error validating voucher' };
    }
  }

  async applyVoucher(userId: string, voucherCode: string, depositId: string, depositAmount: number): Promise<{
    success: boolean;
    bonusAmount?: number;
    message?: string;
    voucherUsageId?: string;
  }> {
    const db = this.firebaseService.getFirestore();

    try {
      const validation = await this.validateVoucher(userId, {
        code: voucherCode,
        depositAmount,
      });

      if (!validation.valid || !validation.voucher || validation.bonusAmount === undefined) {
        return { success: false, message: validation.message || 'Invalid voucher' };
      }

      const voucher = validation.voucher;
      const bonusAmount = validation.bonusAmount;

      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      const user = userDoc.data() as User;

      const usageId = await this.firebaseService.generateId(COLLECTIONS.VOUCHER_USAGES);
      const timestamp = new Date().toISOString();

      const usageData: VoucherUsage = {
        id: usageId,
        voucherId: voucher.id,
        voucherCode: voucher.code,
        userId,
        userEmail: user.email,
        depositId,
        depositAmount,
        bonusAmount,
        usedAt: timestamp,
      };

      await db.runTransaction(async (transaction) => {
        const usageRef = db.collection(COLLECTIONS.VOUCHER_USAGES).doc(usageId);
        transaction.set(usageRef, usageData);

        const voucherRef = db.collection(COLLECTIONS.VOUCHERS).doc(voucher.id);
        transaction.update(voucherRef, {
          usedCount: (voucher.usedCount || 0) + 1,
          updatedAt: timestamp,
        });
      });

      this.logger.log(
        `Voucher applied: ${voucher.code} | User: ${userId} | Bonus: Rp ${bonusAmount.toLocaleString()}`
      );

      return {
        success: true,
        bonusAmount,
        voucherUsageId: usageId,
        message: `Bonus Rp ${bonusAmount.toLocaleString()} will be added after payment confirmation`,
      };

    } catch (error) {
      this.logger.error(`applyVoucher error: ${error.message}`);
      return { success: false, message: 'Error applying voucher' };
    }
  }

  async getUserVoucherUsageCount(userId: string, voucherId: string): Promise<number> {
    const db = this.firebaseService.getFirestore();
    
    const snapshot = await db
      .collection(COLLECTIONS.VOUCHER_USAGES)
      .where('userId', '==', userId)
      .where('voucherId', '==', voucherId)
      .get();

    return snapshot.size;
  }

  async getUserVoucherHistory(userId: string) {
    const db = this.firebaseService.getFirestore();
    
    const snapshot = await db
      .collection(COLLECTIONS.VOUCHER_USAGES)
      .where('userId', '==', userId)
      .orderBy('usedAt', 'desc')
      .get();

    const usages = snapshot.docs.map(doc => {
      const data = doc.data() as VoucherUsage;
      return {
        id: data.id,
        voucherCode: data.voucherCode,
        depositAmount: data.depositAmount,
        bonusAmount: data.bonusAmount,
        usedAt: data.usedAt,
      };
    });

    const totalBonusReceived = usages.reduce((sum, u) => sum + u.bonusAmount, 0);

    return {
      usages,
      summary: {
        totalUsed: usages.length,
        totalBonusReceived,
      },
    };
  }
}