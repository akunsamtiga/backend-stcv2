// src/affiliate-program/affiliate-program.service.ts

import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, Logger, ForbiddenException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FirebaseService } from '../firebase/firebase.service';
import {
  COLLECTIONS,
  AFFILIATE_PROGRAM_CONFIG,
  BALANCE_ACCOUNT_TYPE,
  BALANCE_TYPES,
  COMMISSION_WITHDRAWAL_STATUS,
  COMMISSION_WITHDRAWAL_CONFIG,
} from '../common/constants';
import {
  AffiliatorProgram,
  AffiliatorInvite,
  AffiliateCommissionLog,
  AffiliateCommissionWithdrawal,
  BinaryOrder,
  User,
} from '../common/interfaces';
import { AssignAffiliatorDto, UpdateAffiliatorConfigDto, GetAffiliatorsQueryDto } from './dto/affiliate-program.dto';
import {
  RequestCommissionWithdrawalDto,
  ApproveCommissionWithdrawalDto,
  GetCommissionWithdrawalsQueryDto,
} from './dto/affiliate-commission-withdrawal.dto';

// ─── Detailed invitee stats (enriched per invitee) ───────────────────────────
interface InviteeStats {
  // Balance
  totalDeposit: number;
  totalWithdrawal: number;
  currentRealBalance: number;
  currentDemoBalance: number;
  // Trading
  totalRealOrders: number;
  totalDemoOrders: number;
  totalWin: number;
  totalLose: number;
  totalWinAmount: number;  // sum of profit from wins
  totalLoseAmount: number; // sum of amount from loses (= commission base)
}

@Injectable()
export class AffiliateProgramService {
  private readonly logger = new Logger(AffiliateProgramService.name);

  constructor(private firebaseService: FirebaseService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN: Assign a user as affiliator
  // ─────────────────────────────────────────────────────────────────────────

  async assignAffiliator(userId: string, dto: AssignAffiliatorDto, adminId: string) {
    const db = this.firebaseService.getFirestore();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException(`User ${userId} tidak ditemukan`);
    }
    const user = userDoc.data() as User;

    const existingSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      throw new ConflictException(`User ${userId} sudah menjadi affiliator`);
    }

    let affiliateCode: string;

    if (dto.customCode?.trim()) {
      affiliateCode = dto.customCode.trim().toUpperCase();

      const codeConflict = await db
        .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
        .where('affiliateCode', '==', affiliateCode)
        .limit(1)
        .get();

      if (!codeConflict.empty) {
        throw new ConflictException(
          `Kode affiliate "${affiliateCode}" sudah digunakan. Silakan pilih kode lain.`,
        );
      }
    } else {
      affiliateCode = await this.generateUniqueAffiliateCode();
    }

    const programId = await this.firebaseService.generateId(COLLECTIONS.AFFILIATOR_PROGRAMS);
    const timestamp = new Date().toISOString();

    const revenueSharePercentage = dto.revenueSharePercentage ?? AFFILIATE_PROGRAM_CONFIG.DEFAULT_REVENUE_SHARE;
    const unlockThreshold = dto.unlockThreshold ?? AFFILIATE_PROGRAM_CONFIG.DEFAULT_UNLOCK_THRESHOLD;

    const program: AffiliatorProgram = {
      id: programId,
      userId,
      userEmail: user.email,
      affiliateCode,
      isActive: true,
      revenueSharePercentage,
      unlockThreshold,
      commissionBalance: 0,
      lockedCommissionBalance: 0, // kept for schema compatibility, always 0 in new logic
      isCommissionUnlocked: false, // unlocked when totalInvitedDeposited >= unlockThreshold
      totalInvited: 0,
      totalInvitedDeposited: 0,
      totalCommissionEarned: 0,
      totalCommissionWithdrawn: 0,
      assignedBy: adminId,
      assignedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.collection(COLLECTIONS.AFFILIATOR_PROGRAMS).doc(programId).set(program);

    await db.collection(COLLECTIONS.USERS).doc(userId).update({
      isAffiliator: true,
      affiliatorProgramId: programId,
      updatedAt: timestamp,
    });

    this.logger.log(
      `✅ User ${user.email} dijadikan affiliator (kode: ${affiliateCode}, share: ${revenueSharePercentage}%, unlock threshold: ${unlockThreshold}) oleh admin ${adminId}`
    );

    return {
      message: 'User berhasil dijadikan affiliator',
      program: {
        id: programId,
        userId,
        userEmail: user.email,
        affiliateCode,
        revenueSharePercentage,
        unlockThreshold,
        isActive: true,
        isCommissionUnlocked: false,
        assignedAt: timestamp,
        shareLink: `https://stouch.id/ref/${affiliateCode}`,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN: Revoke affiliator status
  // ─────────────────────────────────────────────────────────────────────────

  async revokeAffiliator(userId: string, adminId: string) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new NotFoundException(`Tidak ada program affiliator untuk user ${userId}`);
    }

    const programDoc = programSnapshot.docs[0];
    const timestamp = new Date().toISOString();

    await programDoc.ref.update({
      isActive: false,
      revokedBy: adminId,
      revokedAt: timestamp,
      updatedAt: timestamp,
    });

    await db.collection(COLLECTIONS.USERS).doc(userId).update({
      isAffiliator: false,
      updatedAt: timestamp,
    });

    this.logger.log(`⛔ Status affiliator dicabut untuk user ${userId} oleh admin ${adminId}`);

    return { message: 'Status affiliator berhasil dicabut' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN: Update affiliator config
  // ─────────────────────────────────────────────────────────────────────────

  async updateAffiliatorConfig(programId: string, dto: UpdateAffiliatorConfigDto, adminId: string) {
    const db = this.firebaseService.getFirestore();

    const programDoc = await db.collection(COLLECTIONS.AFFILIATOR_PROGRAMS).doc(programId).get();
    if (!programDoc.exists) {
      throw new NotFoundException(`Program affiliator ${programId} tidak ditemukan`);
    }

    const program = programDoc.data() as AffiliatorProgram;
    const updates: any = { updatedAt: new Date().toISOString(), updatedBy: adminId };

    if (dto.revenueSharePercentage !== undefined) {
      updates.revenueSharePercentage = dto.revenueSharePercentage;
    }
    if (dto.unlockThreshold !== undefined) {
      updates.unlockThreshold = dto.unlockThreshold;
      // Re-evaluate unlock status with new threshold
      const newIsUnlocked = program.totalInvitedDeposited >= dto.unlockThreshold;
      updates.isCommissionUnlocked = newIsUnlocked;
    }
    if (dto.isActive !== undefined) {
      updates.isActive = dto.isActive;
    }

    await programDoc.ref.update(updates);

    this.logger.log(`✅ Program affiliator ${programId} diperbarui oleh admin ${adminId}`);

    return { message: 'Konfigurasi affiliator berhasil diperbarui', updates };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN: Get all affiliators with stats
  // ─────────────────────────────────────────────────────────────────────────

  async getAllAffiliators(query: GetAffiliatorsQueryDto) {
    const db = this.firebaseService.getFirestore();

    let ref = db.collection(COLLECTIONS.AFFILIATOR_PROGRAMS) as any;

    if (query.isActive !== undefined) {
      ref = ref.where('isActive', '==', query.isActive);
    }

    const snapshot = await ref.orderBy('createdAt', 'desc').get();
    const programs: AffiliatorProgram[] = snapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliatorProgram
    );

    const total = programs.length;
    const { page = 1, limit = 20 } = query;
    const start = (page - 1) * limit;
    const paginated = programs.slice(start, start + limit);

    const programsWithLink = paginated.map(p => ({
      ...p,
      shareLink: `https://stouch.id/ref/${p.affiliateCode}`,
      // Pending invites = totalInvited - totalInvitedDeposited
      pendingInvites: Math.max(0, (p.totalInvited || 0) - (p.totalInvitedDeposited || 0)),
      unlockProgress: {
        current: Math.min(p.totalInvitedDeposited || 0, p.unlockThreshold),
        required: p.unlockThreshold,
        isUnlocked: p.isCommissionUnlocked,
      },
    }));

    return {
      affiliators: programsWithLink,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalAffiliators: total,
        activeAffiliators: programs.filter(p => p.isActive).length,
        unlockedPrograms: programs.filter(p => p.isCommissionUnlocked).length,
        totalCommissionPaid: programs.reduce((s, p) => s + (p.totalCommissionEarned || 0), 0),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN: Get single affiliator detail
  // ─────────────────────────────────────────────────────────────────────────

  async getAffiliatorDetail(userId: string) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new NotFoundException(`Tidak ada program affiliator untuk user ${userId}`);
    }

    const program = programSnapshot.docs[0].data() as AffiliatorProgram;

    const invitesSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_INVITES)
      .where('affiliatorId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const invites: AffiliatorInvite[] = invitesSnapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliatorInvite
    );

    const commissionLogsSnapshot = await db
      .collection(COLLECTIONS.AFFILIATE_COMMISSION_LOGS)
      .where('affiliatorId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const commissionLogs: AffiliateCommissionLog[] = commissionLogsSnapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliateCommissionLog
    );

    const depositedInvites = invites.filter(i => i.hasDeposited);
    const pendingInvites = invites.filter(i => !i.hasDeposited);
    const unlockCount = Math.min(depositedInvites.length, program.unlockThreshold);
    const isUnlocked = depositedInvites.length >= program.unlockThreshold;

    return {
      program: {
        ...program,
        shareLink: `https://stouch.id/ref/${program.affiliateCode}`,
      },
      stats: {
        totalInvited: invites.length,
        registeredNoDeposit: pendingInvites.length,
        depositedInvites: depositedInvites.length,
        unlockProgress: `${unlockCount} / ${program.unlockThreshold}`,
        isCommissionUnlocked: isUnlocked,
        commissionBalance: program.commissionBalance,
        totalCommissionEarned: program.totalCommissionEarned,
        totalCommissionWithdrawn: program.totalCommissionWithdrawn || 0,
        revenueSharePercentage: program.revenueSharePercentage,
        unlockThreshold: program.unlockThreshold,
      },
      recentInvites: invites.slice(0, 20),
      recentCommissions: commissionLogs,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AFFILIATOR USER: Get own dashboard
  // ─────────────────────────────────────────────────────────────────────────

  async getMyProgram(userId: string) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new ForbiddenException('Kamu bukan affiliator. Hubungi admin untuk mendaftar.');
    }

    const program = programSnapshot.docs[0].data() as AffiliatorProgram;

    if (!program.isActive) {
      throw new ForbiddenException('Program affiliator kamu telah dinonaktifkan');
    }

    const invitesSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_INVITES)
      .where('affiliatorId', '==', userId)
      .get();

    const invites: AffiliatorInvite[] = invitesSnapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliatorInvite
    );

    const depositedCount = invites.filter(i => i.hasDeposited).length;
    const noDepositCount = invites.filter(i => !i.hasDeposited).length;
    const unlockCount = Math.min(depositedCount, program.unlockThreshold);
    const isUnlocked = depositedCount >= program.unlockThreshold;
    const remaining = Math.max(0, program.unlockThreshold - depositedCount);

    return {
      affiliateCode: program.affiliateCode,
      shareLink: `https://stouch.id/ref/${program.affiliateCode}`,
      isCommissionUnlocked: isUnlocked,
      revenueSharePercentage: program.revenueSharePercentage,
      balances: {
        commissionBalance: program.commissionBalance,
        isWithdrawable: isUnlocked,
      },
      unlockProgress: {
        current: unlockCount,
        required: program.unlockThreshold,
        percentage: Math.round((unlockCount / program.unlockThreshold) * 100),
        isUnlocked,
        message: isUnlocked
          ? `🎉 Syarat terpenuhi! Kamu bisa menarik komisi kapan saja. Terus undang lebih banyak user untuk komisi lebih besar.`
          : `Butuh ${remaining} undangan lagi yang sudah deposit untuk bisa menarik komisi. Kamu sudah mendapat komisi, tapi belum bisa ditarik.`,
      },
      stats: {
        totalInvited: invites.length,
        depositedInvites: depositedCount,
        registeredNoDeposit: noDepositCount,
        totalCommissionEarned: program.totalCommissionEarned,
        totalCommissionWithdrawn: program.totalCommissionWithdrawn || 0,
        commissionPending: program.commissionBalance,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AFFILIATOR USER: Get own invites with detailed stats
  // ─────────────────────────────────────────────────────────────────────────

  async getMyInvites(userId: string) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new ForbiddenException('Kamu bukan affiliator');
    }

    const program = programSnapshot.docs[0].data() as AffiliatorProgram;

    const invitesSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_INVITES)
      .where('affiliatorId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const invites: AffiliatorInvite[] = invitesSnapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliatorInvite
    );

    // Fetch detailed stats for each invitee in parallel
    const enrichedInvites = await Promise.all(
      invites.map(async (invite) => {
        const stats = await this.getInviteeStats(invite.inviteeId);

        return {
          id: invite.id,
          inviteeId: invite.inviteeId,
          inviteeEmail: this.maskEmail(invite.inviteeEmail),
          // Registration & deposit status
          hasDeposited: invite.hasDeposited,
          isCountedForUnlock: invite.isCountedForUnlock,
          firstDepositAt: invite.firstDepositAt,
          firstDepositAmount: invite.firstDepositAmount,
          registeredAt: invite.createdAt,
          // Balance info
          balance: {
            totalDeposit: stats.totalDeposit,
            totalWithdrawal: stats.totalWithdrawal,
            currentRealBalance: stats.currentRealBalance,
            currentDemoBalance: stats.currentDemoBalance,
          },
          // Trading stats
          trading: {
            totalRealOrders: stats.totalRealOrders,
            totalDemoOrders: stats.totalDemoOrders,
            totalOrders: stats.totalRealOrders + stats.totalDemoOrders,
            win: stats.totalWin,
            lose: stats.totalLose,
            winAmount: stats.totalWinAmount,
            loseAmount: stats.totalLoseAmount,
            winRate: (stats.totalRealOrders + stats.totalDemoOrders) > 0
              ? Math.round((stats.totalWin / (stats.totalRealOrders + stats.totalDemoOrders)) * 100)
              : 0,
          },
        };
      })
    );

    const depositedInvites = enrichedInvites.filter(i => i.hasDeposited);
    const noDepositInvites = enrichedInvites.filter(i => !i.hasDeposited);
    const depositedCount = depositedInvites.length;
    const isUnlocked = depositedCount >= program.unlockThreshold;

    return {
      // Summary
      summary: {
        totalInvited: invites.length,
        depositedInvites: depositedCount,
        registeredNoDeposit: noDepositInvites.length,
        unlockProgress: {
          current: Math.min(depositedCount, program.unlockThreshold),
          required: program.unlockThreshold,
          isUnlocked,
        },
      },
      // All invitees (with deposit)
      depositedUsers: depositedInvites,
      // Users registered but haven't deposited yet
      pendingUsers: noDepositInvites.map(i => ({
        id: i.id,
        inviteeEmail: i.inviteeEmail,
        registeredAt: i.registeredAt,
        hasDeposited: false,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AFFILIATOR USER: Get own commission balance & logs
  // ─────────────────────────────────────────────────────────────────────────

  async getMyCommissions(userId: string) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new ForbiddenException('Kamu bukan affiliator');
    }

    const program = programSnapshot.docs[0].data() as AffiliatorProgram;

    const logsSnapshot = await db
      .collection(COLLECTIONS.AFFILIATE_COMMISSION_LOGS)
      .where('affiliatorId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const logs: AffiliateCommissionLog[] = logsSnapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliateCommissionLog
    );

    const depositedInvitesCount = program.totalInvitedDeposited || 0;
    const isUnlocked = depositedInvitesCount >= program.unlockThreshold;

    return {
      commissionBalance: program.commissionBalance,
      isWithdrawable: isUnlocked,
      totalEarned: program.totalCommissionEarned,
      totalWithdrawn: program.totalCommissionWithdrawn || 0,
      revenueSharePercentage: program.revenueSharePercentage,
      unlockStatus: {
        depositedInvites: depositedInvitesCount,
        required: program.unlockThreshold,
        isUnlocked,
        message: isUnlocked
          ? 'Kamu sudah bisa menarik komisi.'
          : `Butuh ${program.unlockThreshold - depositedInvitesCount} undangan lagi yang deposit agar komisi bisa ditarik.`,
      },
      commissionLogs: logs.map(l => ({
        id: l.id,
        orderAmount: l.orderAmount,
        lossAmount: l.lossAmount,
        commissionPercentage: l.commissionPercentage,
        commissionAmount: l.commissionAmount,
        createdAt: l.createdAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AFFILIATOR: Request commission withdrawal
  // ─────────────────────────────────────────────────────────────────────────

  async requestCommissionWithdrawal(userId: string, dto: RequestCommissionWithdrawalDto) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new ForbiddenException('Kamu tidak memiliki program affiliator yang aktif');
    }

    const program = programSnapshot.docs[0].data() as AffiliatorProgram;

    // ✅ NEW LOGIC: unlock = depositedInvites >= unlockThreshold (can withdraw)
    const depositedCount = program.totalInvitedDeposited || 0;
    const isUnlocked = depositedCount >= program.unlockThreshold;

    if (!isUnlocked) {
      const remaining = program.unlockThreshold - depositedCount;
      throw new BadRequestException(
        `Kamu belum memenuhi syarat penarikan. Butuh ${remaining} undangan lagi yang deposit ` +
        `(${depositedCount}/${program.unlockThreshold} terpenuhi). Komisi tetap berjalan dan akan bisa ditarik setelah syarat terpenuhi.`,
      );
    }

    if (dto.amount < COMMISSION_WITHDRAWAL_CONFIG.MIN_AMOUNT) {
      throw new BadRequestException(
        `Minimal penarikan adalah Rp ${COMMISSION_WITHDRAWAL_CONFIG.MIN_AMOUNT.toLocaleString('id-ID')}`,
      );
    }

    if (dto.amount > program.commissionBalance) {
      throw new BadRequestException(
        `Saldo komisi tidak cukup. Tersedia: Rp ${program.commissionBalance.toLocaleString('id-ID')}, Diminta: Rp ${dto.amount.toLocaleString('id-ID')}`,
      );
    }

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('User tidak ditemukan');
    }
    const user = userDoc.data() as User;

    const bankAccount = user.profile?.bankAccount;
    if (
      !bankAccount?.bankName ||
      !bankAccount?.accountNumber ||
      !bankAccount?.accountHolderName
    ) {
      throw new NotFoundException(
        'Rekening bank belum terdaftar di profil. Harap lengkapi data rekening bank terlebih dahulu.',
      );
    }

    const pendingSnapshot = await db
      .collection(COLLECTIONS.AFFILIATE_COMMISSION_WITHDRAWALS)
      .where('affiliatorId', '==', userId)
      .where('status', '==', COMMISSION_WITHDRAWAL_STATUS.PENDING)
      .limit(1)
      .get();

    if (!pendingSnapshot.empty) {
      throw new ConflictException(
        'Kamu sudah memiliki request penarikan komisi yang sedang menunggu. Tunggu sampai diproses.',
      );
    }

    const withdrawalId = await this.firebaseService.generateId(
      COLLECTIONS.AFFILIATE_COMMISSION_WITHDRAWALS,
    );
    const timestamp = new Date().toISOString();

    const withdrawal: AffiliateCommissionWithdrawal = {
      id: withdrawalId,
      affiliatorId: userId,
      programId: program.id,
      amount: dto.amount,
      status: COMMISSION_WITHDRAWAL_STATUS.PENDING,
      userEmail: user.email,
      bankAccount: {
        bankName: bankAccount.bankName!,
        accountNumber: bankAccount.accountNumber!,
        accountHolderName: bankAccount.accountHolderName!,
      },
      commissionBalanceAtRequest: program.commissionBalance,
      note: dto.note,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db
      .collection(COLLECTIONS.AFFILIATE_COMMISSION_WITHDRAWALS)
      .doc(withdrawalId)
      .set(withdrawal);

    // Reserve amount
    await programSnapshot.docs[0].ref.update({
      commissionBalance: program.commissionBalance - dto.amount,
      updatedAt: timestamp,
    });

    this.logger.log(
      `✅ Penarikan komisi diajukan: affiliator ${userId}, Rp ${dto.amount.toLocaleString('id-ID')}, id: ${withdrawalId}`,
    );

    return {
      message: 'Request penarikan komisi berhasil diajukan',
      withdrawal: {
        id: withdrawalId,
        amount: dto.amount,
        status: COMMISSION_WITHDRAWAL_STATUS.PENDING,
        bankAccount: withdrawal.bankAccount,
        commissionBalanceRemaining: program.commissionBalance - dto.amount,
        createdAt: timestamp,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AFFILIATOR: Get own commission withdrawal history
  // ─────────────────────────────────────────────────────────────────────────

  async getMyCommissionWithdrawals(userId: string) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new ForbiddenException('Kamu tidak memiliki program affiliator');
    }

    const program = programSnapshot.docs[0].data() as AffiliatorProgram;

    const snapshot = await db
      .collection(COLLECTIONS.AFFILIATE_COMMISSION_WITHDRAWALS)
      .where('affiliatorId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const withdrawals: AffiliateCommissionWithdrawal[] = snapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliateCommissionWithdrawal,
    );

    const totalWithdrawn = withdrawals
      .filter(w => w.status === COMMISSION_WITHDRAWAL_STATUS.COMPLETED)
      .reduce((sum, w) => sum + w.amount, 0);

    const isUnlocked = (program.totalInvitedDeposited || 0) >= program.unlockThreshold;

    return {
      commissionBalance: program.commissionBalance,
      isWithdrawable: isUnlocked,
      totalWithdrawn,
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        amount: w.amount,
        status: w.status,
        bankAccount: w.bankAccount,
        note: w.note,
        adminNotes: w.adminNotes,
        rejectionReason: w.rejectionReason,
        reviewedAt: w.reviewedAt,
        createdAt: w.createdAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AFFILIATOR: Cancel a pending commission withdrawal
  // ─────────────────────────────────────────────────────────────────────────

  async cancelCommissionWithdrawal(userId: string, withdrawalId: string) {
    const db = this.firebaseService.getFirestore();

    const withdrawalDoc = await db
      .collection(COLLECTIONS.AFFILIATE_COMMISSION_WITHDRAWALS)
      .doc(withdrawalId)
      .get();

    if (!withdrawalDoc.exists) {
      throw new NotFoundException('Request penarikan tidak ditemukan');
    }

    const withdrawal = withdrawalDoc.data() as AffiliateCommissionWithdrawal;

    if (withdrawal.affiliatorId !== userId) {
      throw new ForbiddenException('Request ini bukan milikmu');
    }

    if (withdrawal.status !== COMMISSION_WITHDRAWAL_STATUS.PENDING) {
      throw new BadRequestException(
        `Tidak bisa membatalkan request yang sudah ${withdrawal.status}`,
      );
    }

    const timestamp = new Date().toISOString();

    const programDoc = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .doc(withdrawal.programId)
      .get();

    if (programDoc.exists) {
      const program = programDoc.data() as AffiliatorProgram;
      await programDoc.ref.update({
        commissionBalance: program.commissionBalance + withdrawal.amount,
        updatedAt: timestamp,
      });
    }

    await withdrawalDoc.ref.update({
      status: COMMISSION_WITHDRAWAL_STATUS.REJECTED,
      rejectionReason: 'Dibatalkan oleh affiliator',
      updatedAt: timestamp,
    });

    return { message: 'Request penarikan berhasil dibatalkan' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN: Get all commission withdrawal requests
  // ─────────────────────────────────────────────────────────────────────────

  async getAllCommissionWithdrawals(query: GetCommissionWithdrawalsQueryDto) {
    const db = this.firebaseService.getFirestore();

    let ref: any;

    if (
      query.status &&
      ['pending', 'approved', 'rejected', 'completed'].includes(query.status)
    ) {
      ref = db
        .collection(COLLECTIONS.AFFILIATE_COMMISSION_WITHDRAWALS)
        .where('status', '==', query.status)
        .orderBy('createdAt', 'desc');
    } else {
      ref = db
        .collection(COLLECTIONS.AFFILIATE_COMMISSION_WITHDRAWALS)
        .orderBy('createdAt', 'desc');
    }

    const snapshot = await ref.get();
    const all: AffiliateCommissionWithdrawal[] = snapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliateCommissionWithdrawal,
    );

    const { page = 1, limit = 20 } = query;
    const start = (page - 1) * limit;
    const paginated = all.slice(start, start + limit);

    return {
      withdrawals: paginated,
      pagination: {
        page,
        limit,
        total: all.length,
        totalPages: Math.ceil(all.length / limit),
      },
      summary: {
        total: all.length,
        pending: all.filter(w => w.status === COMMISSION_WITHDRAWAL_STATUS.PENDING).length,
        approved: all.filter(w => w.status === COMMISSION_WITHDRAWAL_STATUS.APPROVED).length,
        rejected: all.filter(w => w.status === COMMISSION_WITHDRAWAL_STATUS.REJECTED).length,
        completed: all.filter(w => w.status === COMMISSION_WITHDRAWAL_STATUS.COMPLETED).length,
        totalAmountPending: all
          .filter(w => w.status === COMMISSION_WITHDRAWAL_STATUS.PENDING)
          .reduce((s, w) => s + w.amount, 0),
        totalAmountCompleted: all
          .filter(w => w.status === COMMISSION_WITHDRAWAL_STATUS.COMPLETED)
          .reduce((s, w) => s + w.amount, 0),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN: Approve or reject a commission withdrawal
  // ─────────────────────────────────────────────────────────────────────────

  async approveCommissionWithdrawal(
    withdrawalId: string,
    dto: ApproveCommissionWithdrawalDto,
    adminId: string,
  ) {
    const db = this.firebaseService.getFirestore();

    const withdrawalDoc = await db
      .collection(COLLECTIONS.AFFILIATE_COMMISSION_WITHDRAWALS)
      .doc(withdrawalId)
      .get();

    if (!withdrawalDoc.exists) {
      throw new NotFoundException('Request penarikan komisi tidak ditemukan');
    }

    const withdrawal = withdrawalDoc.data() as AffiliateCommissionWithdrawal;

    if (withdrawal.status !== COMMISSION_WITHDRAWAL_STATUS.PENDING) {
      throw new BadRequestException(`Request ini sudah ${withdrawal.status}`);
    }

    const timestamp = new Date().toISOString();

    if (dto.approve) {
      const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);

      await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set({
        id: balanceId,
        user_id: withdrawal.affiliatorId,
        accountType: BALANCE_ACCOUNT_TYPE.REAL,
        type: BALANCE_TYPES.AFFILIATE_COMMISSION,
        amount: withdrawal.amount,
        description: `Penarikan komisi disetujui — ${withdrawal.bankAccount.bankName} ${withdrawal.bankAccount.accountNumber}`,
        createdAt: timestamp,
      });

      await withdrawalDoc.ref.update({
        status: COMMISSION_WITHDRAWAL_STATUS.COMPLETED,
        reviewedBy: adminId,
        reviewedAt: timestamp,
        adminNotes: dto.adminNotes || 'Disetujui dan diproses',
        updatedAt: timestamp,
      });

      const programDoc = await db
        .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
        .doc(withdrawal.programId)
        .get();

      if (programDoc.exists) {
        const program = programDoc.data() as AffiliatorProgram;
        await programDoc.ref.update({
          totalCommissionWithdrawn: (program.totalCommissionWithdrawn || 0) + withdrawal.amount,
          updatedAt: timestamp,
        });
      }

      this.logger.log(
        `✅ Penarikan komisi DISETUJUI: ${withdrawalId} | Affiliator: ${withdrawal.userEmail} | Rp ${withdrawal.amount.toLocaleString('id-ID')}`
      );

      return {
        message: 'Penarikan komisi disetujui dan berhasil diproses',
        withdrawal: {
          id: withdrawalId,
          amount: withdrawal.amount,
          status: COMMISSION_WITHDRAWAL_STATUS.COMPLETED,
          affiliatorEmail: withdrawal.userEmail,
          bankAccount: withdrawal.bankAccount,
          reviewedBy: adminId,
          reviewedAt: timestamp,
        },
      };
    } else {
      if (!dto.rejectionReason?.trim()) {
        throw new BadRequestException('Alasan penolakan wajib diisi saat menolak penarikan');
      }

      const programDoc = await db
        .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
        .doc(withdrawal.programId)
        .get();

      if (programDoc.exists) {
        const program = programDoc.data() as AffiliatorProgram;
        await programDoc.ref.update({
          commissionBalance: program.commissionBalance + withdrawal.amount,
          updatedAt: timestamp,
        });
      }

      await withdrawalDoc.ref.update({
        status: COMMISSION_WITHDRAWAL_STATUS.REJECTED,
        reviewedBy: adminId,
        reviewedAt: timestamp,
        rejectionReason: dto.rejectionReason,
        adminNotes: dto.adminNotes || dto.rejectionReason,
        updatedAt: timestamp,
      });

      return {
        message: 'Penarikan komisi ditolak',
        withdrawal: {
          id: withdrawalId,
          amount: withdrawal.amount,
          status: COMMISSION_WITHDRAWAL_STATUS.REJECTED,
          rejectionReason: dto.rejectionReason,
          reviewedBy: adminId,
          reviewedAt: timestamp,
        },
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REGISTRATION HOOK: Called when a new user registers with affiliate code
  // ─────────────────────────────────────────────────────────────────────────

  async handleNewRegistration(
    inviteeId: string,
    inviteeEmail: string,
    affiliateCode: string,
  ): Promise<{ registered: boolean; affiliatorId?: string }> {
    const db = this.firebaseService.getFirestore();

    try {
      const programSnapshot = await db
        .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
        .where('affiliateCode', '==', affiliateCode.trim().toUpperCase())
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (programSnapshot.empty) {
        this.logger.warn(`Kode affiliate tidak valid atau tidak aktif: ${affiliateCode}`);
        return { registered: false };
      }

      const program = programSnapshot.docs[0].data() as AffiliatorProgram;

      if (program.userId === inviteeId) {
        this.logger.warn(`User ${inviteeId} mencoba menggunakan kode affiliate sendiri`);
        return { registered: false };
      }

      const existingInviteSnapshot = await db
        .collection(COLLECTIONS.AFFILIATOR_INVITES)
        .where('inviteeId', '==', inviteeId)
        .limit(1)
        .get();

      if (!existingInviteSnapshot.empty) {
        this.logger.warn(`User ${inviteeId} sudah memiliki affiliate invite`);
        return { registered: false };
      }

      const inviteId = await this.firebaseService.generateId(COLLECTIONS.AFFILIATOR_INVITES);
      const timestamp = new Date().toISOString();

      const invite: AffiliatorInvite = {
        id: inviteId,
        affiliatorId: program.userId,
        programId: program.id,
        inviteeId,
        inviteeEmail,
        hasDeposited: false,
        isCountedForUnlock: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.collection(COLLECTIONS.AFFILIATOR_INVITES).doc(inviteId).set(invite);

      await programSnapshot.docs[0].ref.update({
        totalInvited: (program.totalInvited || 0) + 1,
        updatedAt: timestamp,
      });

      this.logger.log(
        `✅ Invite affiliasi dibuat: affiliator ${program.userId} → invitee ${inviteeEmail} (kode: ${affiliateCode})`
      );

      return { registered: true, affiliatorId: program.userId };
    } catch (error) {
      this.logger.error(`❌ handleNewRegistration error: ${error.message}`);
      return { registered: false };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DEPOSIT HOOK: Called when an invited user makes their first real deposit
  //
  // ✅ NEW LOGIC:
  //  - All invitees contribute to unlock threshold count
  //  - isCommissionUnlocked is purely a withdrawal gate (totalDeposited >= threshold)
  //  - No more lockedCommissionBalance — commissions always earned freely
  // ─────────────────────────────────────────────────────────────────────────

  @OnEvent('affiliate.user.deposited')
  async handleUserDeposited(payload: { userId: string; amount: number }) {
    const db = this.firebaseService.getFirestore();

    try {
      const inviteSnapshot = await db
        .collection(COLLECTIONS.AFFILIATOR_INVITES)
        .where('inviteeId', '==', payload.userId)
        .where('hasDeposited', '==', false)
        .limit(1)
        .get();

      if (inviteSnapshot.empty) return;

      const inviteDoc = inviteSnapshot.docs[0];
      const invite = inviteDoc.data() as AffiliatorInvite;
      const timestamp = new Date().toISOString();

      // Mark invitee as deposited
      await inviteDoc.ref.update({
        hasDeposited: true,
        firstDepositAt: timestamp,
        firstDepositAmount: payload.amount,
        updatedAt: timestamp,
      });

      const programDoc = await db
        .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
        .doc(invite.programId)
        .get();

      if (!programDoc.exists) return;

      const program = programDoc.data() as AffiliatorProgram;
      const newDepositedCount = (program.totalInvitedDeposited || 0) + 1;

      // Mark whether this invite counts toward threshold (informational, first N)
      const isCountedForUnlock = newDepositedCount <= program.unlockThreshold;
      if (isCountedForUnlock) {
        await inviteDoc.ref.update({ isCountedForUnlock: true, updatedAt: timestamp });
      }

      // ✅ NEW: unlock = can withdraw = enough deposited invites
      const nowUnlocked = newDepositedCount >= program.unlockThreshold;
      const justUnlocked = !program.isCommissionUnlocked && nowUnlocked;

      await programDoc.ref.update({
        totalInvitedDeposited: newDepositedCount,
        isCommissionUnlocked: nowUnlocked,
        updatedAt: timestamp,
      });

      if (justUnlocked) {
        this.logger.log(
          `🎉 Syarat penarikan TERPENUHI untuk affiliator ${program.userId}! ` +
          `${newDepositedCount}/${program.unlockThreshold} undangan sudah deposit. Komisi sekarang bisa ditarik.`
        );
      }

      this.logger.log(
        `✅ Deposit invitee ${payload.userId} tercatat di bawah affiliator ${program.userId}. ` +
        `Progress: ${newDepositedCount}/${program.unlockThreshold}${nowUnlocked ? ' ✅ UNLOCK' : ''}`
      );
    } catch (error) {
      this.logger.error(`❌ handleUserDeposited error: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ORDER LOST HOOK: Called when an invited user loses a real order
  //
  // ✅ NEW LOGIC:
  //  - ALL invitees generate commission when they lose (including the first N)
  //  - isCountedForUnlock no longer gates commission earning
  //  - Commission is always added to commissionBalance directly
  // ─────────────────────────────────────────────────────────────────────────

  @OnEvent('affiliate.order.lost')
  async handleOrderLost(order: BinaryOrder) {
    if (order.accountType !== BALANCE_ACCOUNT_TYPE.REAL) return;

    const db = this.firebaseService.getFirestore();

    try {
      const inviteSnapshot = await db
        .collection(COLLECTIONS.AFFILIATOR_INVITES)
        .where('inviteeId', '==', order.user_id)
        .where('hasDeposited', '==', true)
        .limit(1)
        .get();

      if (inviteSnapshot.empty) return;

      const invite = inviteSnapshot.docs[0].data() as AffiliatorInvite;

      const programDoc = await db
        .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
        .doc(invite.programId)
        .get();

      if (!programDoc.exists) return;

      const program = programDoc.data() as AffiliatorProgram;

      if (!program.isActive) return;

      const lossAmount = Math.abs(order.profit || order.amount);
      const commissionAmount = (lossAmount * program.revenueSharePercentage) / 100;

      if (commissionAmount < AFFILIATE_PROGRAM_CONFIG.MIN_LOSS_AMOUNT_FOR_COMMISSION) return;

      const logId = await this.firebaseService.generateId(COLLECTIONS.AFFILIATE_COMMISSION_LOGS);
      const timestamp = new Date().toISOString();

      const log: AffiliateCommissionLog = {
        id: logId,
        affiliatorId: program.userId,
        programId: program.id,
        inviteeId: order.user_id,
        orderId: order.id,
        orderAmount: order.amount,
        lossAmount,
        commissionPercentage: program.revenueSharePercentage,
        commissionAmount,
        createdAt: timestamp,
      };

      await db.collection(COLLECTIONS.AFFILIATE_COMMISSION_LOGS).doc(logId).set(log);

      // ✅ Always add to commissionBalance directly (no locking)
      await programDoc.ref.update({
        commissionBalance: program.commissionBalance + commissionAmount,
        totalCommissionEarned: (program.totalCommissionEarned || 0) + commissionAmount,
        updatedAt: timestamp,
      });

      this.logger.log(
        `💰 Komisi → affiliator ${program.userId}: ` +
        `Rp ${commissionAmount.toLocaleString()} (${program.revenueSharePercentage}% dari Rp ${lossAmount.toLocaleString()} loss invitee ${order.user_id})` +
        (invite.isCountedForUnlock ? ' [unlock-period invitee]' : '')
      );
    } catch (error) {
      this.logger.error(`❌ handleOrderLost error: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC: Get affiliator display name by affiliate code (no auth required)
  // ─────────────────────────────────────────────────────────────────────────

  async getAffiliatorPublicInfo(affiliateCode: string): Promise<{ name: string }> {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('affiliateCode', '==', affiliateCode.toUpperCase())
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new NotFoundException(`Kode affiliate tidak ditemukan`);
    }

    const program = programSnapshot.docs[0].data() as AffiliatorProgram;

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(program.userId).get();
    if (!userDoc.exists) {
      throw new NotFoundException(`User tidak ditemukan`);
    }

    const user = userDoc.data() as any;
    const fullName = user?.profile?.fullName;
    const name = fullName ? fullName : program.userEmail.split('@')[0];

    return { name };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch detailed balance and trading stats for a single invitee.
   * Used in getMyInvites to enrich each invitee row.
   */
  private async getInviteeStats(inviteeId: string): Promise<InviteeStats> {
    const db = this.firebaseService.getFirestore();

    const stats: InviteeStats = {
      totalDeposit: 0,
      totalWithdrawal: 0,
      currentRealBalance: 0,
      currentDemoBalance: 0,
      totalRealOrders: 0,
      totalDemoOrders: 0,
      totalWin: 0,
      totalLose: 0,
      totalWinAmount: 0,
      totalLoseAmount: 0,
    };

    try {
      // Fetch balance entries and orders in parallel
      const [balanceSnap, ordersSnap] = await Promise.all([
        db.collection(COLLECTIONS.BALANCE)
          .where('user_id', '==', inviteeId)
          .get(),
        db.collection(COLLECTIONS.ORDERS)
          .where('user_id', '==', inviteeId)
          .get(),
      ]);

      // ── Balance calculations ────────────────────────────────────────────
      balanceSnap.forEach(doc => {
        const b = doc.data();
        const amt: number = b.amount || 0;
        const type: string = b.type || '';
        const accountType: string = b.accountType || '';

        // Total deposits (real only)
        if (type === BALANCE_TYPES.DEPOSIT && accountType === BALANCE_ACCOUNT_TYPE.REAL) {
          stats.totalDeposit += amt;
        }
        // Total withdrawals (real only)
        if (type === BALANCE_TYPES.WITHDRAWAL && accountType === BALANCE_ACCOUNT_TYPE.REAL) {
          stats.totalWithdrawal += amt;
        }

        // Running balance per accountType
        const isIncome =
          type === BALANCE_TYPES.DEPOSIT ||
          type === BALANCE_TYPES.ORDER_PROFIT ||
          type === BALANCE_TYPES.WIN ||
          type === BALANCE_TYPES.VOUCHER_BONUS ||
          type === BALANCE_TYPES.AFFILIATE_COMMISSION;

        const isExpense =
          type === BALANCE_TYPES.WITHDRAWAL ||
          type === BALANCE_TYPES.ORDER_DEBIT ||
          type === BALANCE_TYPES.LOSE;

        if (accountType === BALANCE_ACCOUNT_TYPE.REAL) {
          if (isIncome) stats.currentRealBalance += amt;
          if (isExpense) stats.currentRealBalance -= amt;
        }
        if (accountType === BALANCE_ACCOUNT_TYPE.DEMO) {
          if (isIncome) stats.currentDemoBalance += amt;
          if (isExpense) stats.currentDemoBalance -= amt;
        }
      });

      // ── Order calculations ──────────────────────────────────────────────
      ordersSnap.forEach(doc => {
        const o = doc.data();
        const status: string = o.status || '';
        const accountType: string = o.accountType || '';

        if (accountType === BALANCE_ACCOUNT_TYPE.REAL) stats.totalRealOrders++;
        if (accountType === BALANCE_ACCOUNT_TYPE.DEMO) stats.totalDemoOrders++;

        if (status === 'WON') {
          stats.totalWin++;
          stats.totalWinAmount += Math.abs(o.profit || 0);
        }
        if (status === 'LOST') {
          stats.totalLose++;
          stats.totalLoseAmount += o.amount || 0;
        }
      });
    } catch (error) {
      this.logger.warn(`⚠️ getInviteeStats partial fail for ${inviteeId}: ${error.message}`);
    }

    return stats;
  }

  /**
   * Generate a unique affiliate code with up to 5 retry attempts on collision.
   */
  private async generateUniqueAffiliateCode(): Promise<string> {
    const db = this.firebaseService.getFirestore();

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.generateAffiliateCode();

      const snap = await db
        .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
        .where('affiliateCode', '==', code)
        .limit(1)
        .get();

      if (snap.empty) return code;

      this.logger.warn(`Collision pada attempt ke-${attempt + 1}: ${code}`);
    }

    throw new Error('Gagal generate kode affiliate unik setelah 5 percobaan');
  }

  private generateAffiliateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'AFF';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    const masked = local.length > 2
      ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
      : local[0] + '*';
    return `${masked}@${domain}`;
  }
}