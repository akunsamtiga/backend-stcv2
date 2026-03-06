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
  AFFILIATE_COMMISSION_TIERS,
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
  totalDeposit: number;
  totalWithdrawal: number;
  currentRealBalance: number;
  currentDemoBalance: number;
  totalRealOrders: number;
  totalDemoOrders: number;
  totalWin: number;
  totalLose: number;
  totalWinAmount: number;
  totalLoseAmount: number;
}

// ─── Commission phase info ────────────────────────────────────────────────────
export interface CommissionPhaseInfo {
  phase: 'new' | 'established';
  commissionRate: number;
  activeInvitees?: number;
  monthsActive: number;
  description: string;
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

    const unlockThreshold = dto.unlockThreshold ?? AFFILIATE_PROGRAM_CONFIG.DEFAULT_UNLOCK_THRESHOLD;

    // NOTE: revenueSharePercentage dari DTO diabaikan — komisi dihitung DINAMIS
    // berdasarkan fase (baru/lama) dan jumlah active invitees (lihat calculateCurrentCommissionRate)
    const program: AffiliatorProgram = {
      id: programId,
      userId,
      userEmail: user.email,
      affiliateCode,
      isActive: true,
      revenueSharePercentage: AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_RATE, // snapshot awal, akan berubah dinamis
      unlockThreshold,
      commissionBalance: 0,
      lockedCommissionBalance: 0,
      isCommissionUnlocked: false,
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
      `✅ User ${user.email} dijadikan affiliator (kode: ${affiliateCode}, unlock: ${unlockThreshold}) oleh admin ${adminId}. ` +
      `Fase awal: NEW (80% flat selama ${AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_MONTHS} bulan pertama)`
    );

    return {
      message: 'User berhasil dijadikan affiliator',
      program: {
        id: programId,
        userId,
        userEmail: user.email,
        affiliateCode,
        unlockThreshold,
        isActive: true,
        isCommissionUnlocked: false,
        assignedAt: timestamp,
        shareLink: `https://stouch.id/ref/${affiliateCode}`,
        commissionSystem: {
          currentPhase: 'new',
          description: `Fase Baru: ${AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_RATE}% flat dari semua loss selama ${AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_MONTHS} bulan pertama.`,
          afterNewPhase: 'Fase Lama: komisi berbasis jumlah user aktif per bulan (50%–80%).',
        },
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

    // NOTE: revenueSharePercentage tidak digunakan dalam sistem baru (komisi dinamis),
    // tapi field ini tetap bisa di-update untuk kompatibilitas dengan tampilan dashboard.
    if (dto.revenueSharePercentage !== undefined) {
      updates.revenueSharePercentage = dto.revenueSharePercentage;
    }
    if (dto.unlockThreshold !== undefined) {
      updates.unlockThreshold = dto.unlockThreshold;
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

    const programsWithInfo = await Promise.all(
      paginated.map(async (p) => {
        const phaseInfo = await this.getPhaseInfo(p);
        return {
          ...p,
          shareLink: `https://stouch.id/ref/${p.affiliateCode}`,
          pendingInvites: Math.max(0, (p.totalInvited || 0) - (p.totalInvitedDeposited || 0)),
          unlockProgress: {
            current: Math.min(p.totalInvitedDeposited || 0, p.unlockThreshold),
            required: p.unlockThreshold,
            isUnlocked: p.isCommissionUnlocked,
          },
          commissionPhase: phaseInfo,
        };
      })
    );

    return {
      affiliators: programsWithInfo,
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

    const phaseInfo = await this.getPhaseInfo(program);
    const activeInvitees = phaseInfo.phase === 'established' ? (phaseInfo.activeInvitees ?? 0) : null;

    return {
      program: {
        ...program,
        shareLink: `https://stouch.id/ref/${program.affiliateCode}`,
      },
      commissionPhase: phaseInfo,
      stats: {
        totalInvited: invites.length,
        registeredNoDeposit: pendingInvites.length,
        depositedInvites: depositedInvites.length,
        activeInvitees,
        unlockProgress: `${unlockCount} / ${program.unlockThreshold}`,
        isCommissionUnlocked: isUnlocked,
        commissionBalance: program.commissionBalance,
        totalCommissionEarned: program.totalCommissionEarned,
        totalCommissionWithdrawn: program.totalCommissionWithdrawn || 0,
        currentCommissionRate: phaseInfo.commissionRate,
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

    const phaseInfo = await this.getPhaseInfo(program);

    return {
      affiliateCode: program.affiliateCode,
      shareLink: `https://stouch.id/ref/${program.affiliateCode}`,
      isCommissionUnlocked: isUnlocked,
      revenueSharePercentage: program.revenueSharePercentage,
      commissionPhase: phaseInfo,
      balances: {
        commissionBalance: program.commissionBalance,
        lockedCommissionBalance: program.lockedCommissionBalance ?? 0,
        isLocked: !isUnlocked,
        isWithdrawable: isUnlocked,
      },
      unlockProgress: {
        current: unlockCount,
        required: program.unlockThreshold,
        percentage: Math.round((unlockCount / program.unlockThreshold) * 100),
        isUnlocked,
        message: isUnlocked
          ? `🎉 Syarat terpenuhi! Kamu bisa menarik komisi kapan saja.`
          : `Butuh ${remaining} undangan lagi yang sudah deposit untuk bisa menarik komisi.`,
      },
      stats: {
        totalInvited: invites.length,
        depositedInvites: depositedCount,
        pendingInvites: noDepositCount,
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

    const enrichedInvites = await Promise.all(
      invites.map(async (invite) => {
        const stats = await this.getInviteeStats(invite.inviteeId);
        const isActive = await this.isInviteeActive(invite.inviteeId);

        return {
          id: invite.id,
          inviteeId: invite.inviteeId,
          inviteeEmail: this.maskEmail(invite.inviteeEmail),
          hasDeposited: invite.hasDeposited,
          isCountedForUnlock: invite.isCountedForUnlock,
          isActive,
          firstDepositAt: invite.firstDepositAt,
          firstDepositAmount: invite.firstDepositAmount,
          registeredAt: invite.createdAt,
          balance: {
            totalDeposit: stats.totalDeposit,
            totalWithdrawal: stats.totalWithdrawal,
            currentRealBalance: stats.currentRealBalance,
            currentDemoBalance: stats.currentDemoBalance,
          },
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
    const activeCount = enrichedInvites.filter(i => i.isActive).length;
    const isUnlocked = depositedCount >= program.unlockThreshold;

    return {
      summary: {
        totalInvited: invites.length,
        depositedInvites: depositedCount,
        registeredNoDeposit: noDepositInvites.length,
        activeInvitees: activeCount,
        unlockProgress: {
          current: Math.min(depositedCount, program.unlockThreshold),
          required: program.unlockThreshold,
          isUnlocked,
        },
      },
      depositedUsers: depositedInvites,
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
    const phaseInfo = await this.getPhaseInfo(program);

    return {
      commissionBalance: program.commissionBalance,
      isWithdrawable: isUnlocked,
      totalEarned: program.totalCommissionEarned,
      totalWithdrawn: program.totalCommissionWithdrawn || 0,
      commissionPhase: phaseInfo,
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
  // REGISTRATION HOOK
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
  // DEPOSIT HOOK
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

      const isCountedForUnlock = newDepositedCount <= program.unlockThreshold;
      if (isCountedForUnlock) {
        await inviteDoc.ref.update({ isCountedForUnlock: true, updatedAt: timestamp });
      }

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
          `${newDepositedCount}/${program.unlockThreshold} undangan sudah deposit.`
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
  // ORDER LOST HOOK — komisi dihitung DINAMIS berdasarkan fase & active users
  //
  // Fase 1 (< 2 bulan sejak assignedAt):
  //   → Flat 80% dari semua invitee yang sudah deposit
  //
  // Fase 2 (≥ 2 bulan sejak assignedAt):
  //   → Tier berdasarkan jumlah invitee AKTIF bulan ini:
  //       0–50 aktif  = 50%
  //      51–70 aktif  = 60%
  //      71–100 aktif = 70%
  //     101+   aktif  = 80%
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

      // ── Hitung komisi dinamis ─────────────────────────────────────────────
      const dynamicRate = await this.calculateCurrentCommissionRate(program);
      const lossAmount = Math.abs(order.profit || order.amount);
      const commissionAmount = (lossAmount * dynamicRate) / 100;

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
        commissionPercentage: dynamicRate,
        commissionAmount,
        createdAt: timestamp,
      };

      await db.collection(COLLECTIONS.AFFILIATE_COMMISSION_LOGS).doc(logId).set(log);

      await programDoc.ref.update({
        commissionBalance: program.commissionBalance + commissionAmount,
        totalCommissionEarned: (program.totalCommissionEarned || 0) + commissionAmount,
        // Update snapshot of current rate so dashboard shows latest value
        revenueSharePercentage: dynamicRate,
        updatedAt: timestamp,
      });

      this.logger.log(
        `💰 Komisi → affiliator ${program.userId}: ` +
        `Rp ${commissionAmount.toLocaleString()} (${dynamicRate}% dari Rp ${lossAmount.toLocaleString()} loss invitee ${order.user_id})`
      );
    } catch (error) {
      this.logger.error(`❌ handleOrderLost error: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC: Get affiliator display name by affiliate code
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
  // PRIVATE: DYNAMIC COMMISSION RATE ENGINE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Menentukan persentase komisi saat ini berdasarkan fase affiliator.
   *
   * FASE 1 — Affiliator Baru (< 2 bulan sejak assignedAt):
   *   Flat 80% tanpa memandang jumlah user aktif.
   *
   * FASE 2 — Affiliator Lama (≥ 2 bulan sejak assignedAt):
   *   Tier berdasarkan jumlah invitee AKTIF (transaksi real dalam 30 hari):
   *     0 – 50  aktif  → 50%
   *    51 – 70  aktif  → 60%
   *    71 – 100 aktif  → 70%
   *   101+      aktif  → 80%
   */
  private async calculateCurrentCommissionRate(program: AffiliatorProgram): Promise<number> {
    const assignedAt = new Date(program.assignedAt);
    const now = new Date();

    // Hitung usia program dalam bulan
    const monthsActive = this.getMonthsDiff(assignedAt, now);

    if (monthsActive < AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_MONTHS) {
      // ── Fase 1: Affiliator baru ──────────────────────────────────────────
      return AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_RATE;
    }

    // ── Fase 2: Affiliator lama — hitung active invitees ──────────────────
    const activeCount = await this.countActiveInvitees(program);
    return this.getTieredCommissionRate(activeCount);
  }

  /**
   * Kembalikan CommissionPhaseInfo lengkap untuk ditampilkan di dashboard.
   */
  async getPhaseInfo(program: AffiliatorProgram): Promise<CommissionPhaseInfo> {
    const assignedAt = new Date(program.assignedAt);
    const now = new Date();
    const monthsActive = this.getMonthsDiff(assignedAt, now);
    const isNewPhase = monthsActive < AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_MONTHS;

    if (isNewPhase) {
      const monthsRemaining = AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_MONTHS - monthsActive;
      return {
        phase: 'new',
        commissionRate: AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_RATE,
        monthsActive,
        description:
          `Fase Baru: komisi flat ${AFFILIATE_COMMISSION_TIERS.NEW_AFFILIATE_RATE}% dari semua loss. ` +
          `Berlaku hingga ${monthsRemaining} bulan lagi, lalu beralih ke sistem tier.`,
      };
    }

    const activeInvitees = await this.countActiveInvitees(program);
    const rate = this.getTieredCommissionRate(activeInvitees);
    const nextTier = this.getNextTierInfo(activeInvitees);

    return {
      phase: 'established',
      commissionRate: rate,
      activeInvitees,
      monthsActive,
      description:
        `Fase Lama: ${activeInvitees} user aktif bulan ini → komisi ${rate}%.` +
        (nextTier
          ? ` Butuh ${nextTier.needed} user aktif lagi untuk naik ke ${nextTier.rate}%.`
          : ` Sudah di tier tertinggi (80%)!`),
    };
  }

  /**
   * Tier komisi untuk Fase 2 berdasarkan jumlah user aktif.
   *   0–50   → 50%
   *  51–70   → 60%
   *  71–100  → 70%
   * 101+     → 80%
   */
  private getTieredCommissionRate(activeUsers: number): number {
    for (const tier of AFFILIATE_COMMISSION_TIERS.TIERS) {
      if (activeUsers >= tier.minActive) {
        return tier.rate;
      }
    }
    return AFFILIATE_COMMISSION_TIERS.TIERS[AFFILIATE_COMMISSION_TIERS.TIERS.length - 1].rate;
  }

  /**
   * Info tier berikutnya (untuk display di dashboard).
   */
  private getNextTierInfo(activeUsers: number): { needed: number; rate: number } | null {
    const tiers = [...AFFILIATE_COMMISSION_TIERS.TIERS].reverse(); // ascending order
    for (const tier of tiers) {
      if (activeUsers < tier.minActive) {
        return { needed: tier.minActive - activeUsers, rate: tier.rate };
      }
    }
    return null;
  }

  /**
   * Hitung jumlah invitee yang AKTIF:
   * Aktif = memiliki minimal 1 order di real account dalam 30 hari terakhir.
   */
  private async countActiveInvitees(program: AffiliatorProgram): Promise<number> {
    const db = this.firebaseService.getFirestore();

    const invitesSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_INVITES)
      .where('programId', '==', program.id)
      .where('hasDeposited', '==', true)
      .get();

    if (invitesSnapshot.empty) return 0;

    const inviteeIds = invitesSnapshot.docs.map(d => (d.data() as AffiliatorInvite).inviteeId);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    const activeUserIds = new Set<string>();

    // Firestore 'in' operator supports up to 30 values per query
    const BATCH_SIZE = 30;
    for (let i = 0; i < inviteeIds.length; i += BATCH_SIZE) {
      const batch = inviteeIds.slice(i, i + BATCH_SIZE);

      const ordersSnapshot = await db
        .collection(COLLECTIONS.ORDERS)
        .where('user_id', 'in', batch)
        .where('accountType', '==', BALANCE_ACCOUNT_TYPE.REAL)
        .where('createdAt', '>=', thirtyDaysAgoISO)
        .limit(500)
        .get();

      ordersSnapshot.docs.forEach(d => {
        activeUserIds.add(d.data().user_id as string);
      });
    }

    return activeUserIds.size;
  }

  /**
   * Cek apakah 1 invitee tertentu aktif (ada order real dalam 30 hari).
   * Digunakan saat enrich getMyInvites.
   */
  private async isInviteeActive(inviteeId: string): Promise<boolean> {
    const db = this.firebaseService.getFirestore();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    const snap = await db
      .collection(COLLECTIONS.ORDERS)
      .where('user_id', '==', inviteeId)
      .where('accountType', '==', BALANCE_ACCOUNT_TYPE.REAL)
      .where('createdAt', '>=', thirtyDaysAgoISO)
      .limit(1)
      .get();

    return !snap.empty;
  }

  /**
   * Selisih bulan antara dua tanggal (pembulatan ke bawah).
   */
  private getMonthsDiff(from: Date, to: Date): number {
    const years = to.getFullYear() - from.getFullYear();
    const months = to.getMonth() - from.getMonth();
    return years * 12 + months;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

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
      const [balanceSnap, ordersSnap] = await Promise.all([
        db.collection(COLLECTIONS.BALANCE).where('user_id', '==', inviteeId).get(),
        db.collection(COLLECTIONS.ORDERS).where('user_id', '==', inviteeId).get(),
      ]);

      balanceSnap.forEach(doc => {
        const b = doc.data();
        const amt: number = b.amount || 0;
        const type: string = b.type || '';
        const accountType: string = b.accountType || '';

        if (type === BALANCE_TYPES.DEPOSIT && accountType === BALANCE_ACCOUNT_TYPE.REAL) {
          stats.totalDeposit += amt;
        }
        if (type === BALANCE_TYPES.WITHDRAWAL && accountType === BALANCE_ACCOUNT_TYPE.REAL) {
          stats.totalWithdrawal += amt;
        }

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