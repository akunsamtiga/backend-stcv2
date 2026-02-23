// src/affiliate-program/affiliate-program.service.ts

import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, Logger, ForbiddenException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FirebaseService } from '../firebase/firebase.service';
import {
  COLLECTIONS,
  AFFILIATOR_PROGRAM_STATUS,
  AFFILIATE_PROGRAM_CONFIG,
  BALANCE_ACCOUNT_TYPE,
} from '../common/constants';
import {
  AffiliatorProgram,
  AffiliatorInvite,
  AffiliateCommissionLog,
  BinaryOrder,
  User,
} from '../common/interfaces';
import { AssignAffiliatorDto, UpdateAffiliatorConfigDto, GetAffiliatorsQueryDto } from './dto/affiliate-program.dto';

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
      throw new NotFoundException(`User ${userId} not found`);
    }

    const user = userDoc.data() as User;

    const existingSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (!existingSnapshot.empty) {
      throw new ConflictException(`User ${userId} is already an affiliator`);
    }

    const programId = await this.firebaseService.generateId(COLLECTIONS.AFFILIATOR_PROGRAMS);
    const affiliateCode = this.generateAffiliateCode();
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
      lockedCommissionBalance: 0,
      isCommissionUnlocked: false,
      totalInvited: 0,
      totalInvitedDeposited: 0,
      totalCommissionEarned: 0,
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

    this.logger.log(`✅ User ${user.email} assigned as affiliator (code: ${affiliateCode}, share: ${revenueSharePercentage}%)`);

    return {
      message: 'User successfully assigned as affiliator',
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
      throw new NotFoundException(`No affiliator program found for user ${userId}`);
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

    this.logger.log(`⛔ Affiliator status revoked for user ${userId} by admin ${adminId}`);

    return { message: 'Affiliator status revoked successfully' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN: Update affiliator config
  // ─────────────────────────────────────────────────────────────────────────

  async updateAffiliatorConfig(programId: string, dto: UpdateAffiliatorConfigDto, adminId: string) {
    const db = this.firebaseService.getFirestore();

    const programDoc = await db.collection(COLLECTIONS.AFFILIATOR_PROGRAMS).doc(programId).get();
    if (!programDoc.exists) {
      throw new NotFoundException(`Affiliator program ${programId} not found`);
    }

    const updates: any = { updatedAt: new Date().toISOString(), updatedBy: adminId };

    if (dto.revenueSharePercentage !== undefined) {
      updates.revenueSharePercentage = dto.revenueSharePercentage;
    }
    if (dto.unlockThreshold !== undefined) {
      updates.unlockThreshold = dto.unlockThreshold;
    }
    if (dto.isActive !== undefined) {
      updates.isActive = dto.isActive;
    }

    await programDoc.ref.update(updates);

    this.logger.log(`✅ Affiliator program ${programId} updated by admin ${adminId}`);

    return { message: 'Affiliator configuration updated successfully', updates };
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
    // FIX: type the 'd' parameter explicitly to suppress TS7006
    const programs: AffiliatorProgram[] = snapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliatorProgram
    );

    const total = programs.length;
    const { page = 1, limit = 20 } = query;
    const start = (page - 1) * limit;
    const paginated = programs.slice(start, start + limit);

    return {
      affiliators: paginated,
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
        totalCommissionPaid: programs.reduce((s, p) => s + p.totalCommissionEarned, 0),
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
      throw new NotFoundException(`No affiliator program found for user ${userId}`);
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

    const pendingInvites = invites.filter(i => !i.hasDeposited);
    const depositedInvites = invites.filter(i => i.hasDeposited);
    const unlockCount = depositedInvites.filter(i => i.isCountedForUnlock).length;

    return {
      program,
      stats: {
        totalInvited: invites.length,
        depositedInvites: depositedInvites.length,
        pendingInvites: pendingInvites.length,
        invitesCountedForUnlock: unlockCount,
        invitesAfterUnlock: Math.max(0, depositedInvites.length - program.unlockThreshold),
        commissionBalance: program.commissionBalance,
        lockedCommissionBalance: program.lockedCommissionBalance,
        isCommissionUnlocked: program.isCommissionUnlocked,
        totalCommissionEarned: program.totalCommissionEarned,
        revenueSharePercentage: program.revenueSharePercentage,
        unlockThreshold: program.unlockThreshold,
        unlockProgress: `${Math.min(unlockCount, program.unlockThreshold)} / ${program.unlockThreshold}`,
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
      throw new ForbiddenException('You are not an affiliator. Contact the admin to apply.');
    }

    const program = programSnapshot.docs[0].data() as AffiliatorProgram;

    if (!program.isActive) {
      throw new ForbiddenException('Your affiliator program has been deactivated');
    }

    const invitesSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_INVITES)
      .where('affiliatorId', '==', userId)
      .get();

    const invites: AffiliatorInvite[] = invitesSnapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliatorInvite
    );
    const depositedCount = invites.filter(i => i.hasDeposited).length;
    const unlockProgress = Math.min(depositedCount, program.unlockThreshold);

    return {
      affiliateCode: program.affiliateCode,
      isCommissionUnlocked: program.isCommissionUnlocked,
      revenueSharePercentage: program.revenueSharePercentage,
      balances: {
        commissionBalance: program.commissionBalance,
        lockedCommissionBalance: program.lockedCommissionBalance,
        isLocked: !program.isCommissionUnlocked,
      },
      unlockProgress: {
        current: unlockProgress,
        required: program.unlockThreshold,
        percentage: Math.round((unlockProgress / program.unlockThreshold) * 100),
        isUnlocked: program.isCommissionUnlocked,
        message: program.isCommissionUnlocked
          ? '🎉 Your commission balance is unlocked! You earn commissions from losses of your invited users.'
          : `Invite ${program.unlockThreshold - unlockProgress} more user(s) who complete a deposit to unlock your commission balance.`,
      },
      stats: {
        totalInvited: invites.length,
        depositedInvites: depositedCount,
        pendingInvites: invites.filter(i => !i.hasDeposited).length,
        totalCommissionEarned: program.totalCommissionEarned,
      },
    };
  }

  async getMyInvites(userId: string) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new ForbiddenException('You are not an affiliator');
    }

    const invitesSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_INVITES)
      .where('affiliatorId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const invites: AffiliatorInvite[] = invitesSnapshot.docs.map(
      (d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as AffiliatorInvite
    );

    return {
      invites: invites.map(i => ({
        id: i.id,
        inviteeId: i.inviteeId,
        inviteeEmail: this.maskEmail(i.inviteeEmail),
        hasDeposited: i.hasDeposited,
        firstDepositAt: i.firstDepositAt,
        isCountedForUnlock: i.isCountedForUnlock,
        createdAt: i.createdAt,
      })),
      total: invites.length,
      deposited: invites.filter(i => i.hasDeposited).length,
      pending: invites.filter(i => !i.hasDeposited).length,
    };
  }

  async getMyCommissions(userId: string) {
    const db = this.firebaseService.getFirestore();

    const programSnapshot = await db
      .collection(COLLECTIONS.AFFILIATOR_PROGRAMS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (programSnapshot.empty) {
      throw new ForbiddenException('You are not an affiliator');
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

    return {
      commissionBalance: program.commissionBalance,
      lockedCommissionBalance: program.lockedCommissionBalance,
      isCommissionUnlocked: program.isCommissionUnlocked,
      totalEarned: program.totalCommissionEarned,
      revenueSharePercentage: program.revenueSharePercentage,
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
        this.logger.warn(`Invalid or inactive affiliate code: ${affiliateCode}`);
        return { registered: false };
      }

      const program = programSnapshot.docs[0].data() as AffiliatorProgram;

      if (program.userId === inviteeId) {
        this.logger.warn(`User ${inviteeId} tried to use their own affiliate code`);
        return { registered: false };
      }

      const existingInviteSnapshot = await db
        .collection(COLLECTIONS.AFFILIATOR_INVITES)
        .where('inviteeId', '==', inviteeId)
        .limit(1)
        .get();

      if (!existingInviteSnapshot.empty) {
        this.logger.warn(`User ${inviteeId} already has an affiliator invite`);
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
        `✅ Affiliate invite created: affiliator ${program.userId} → invitee ${inviteeEmail} (code: ${affiliateCode})`
      );

      return { registered: true, affiliatorId: program.userId };
    } catch (error) {
      this.logger.error(`❌ handleNewRegistration error: ${error.message}`);
      return { registered: false };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DEPOSIT HOOK: Called when an invited user makes their first real deposit
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

      if (inviteSnapshot.empty) {
        return;
      }

      const inviteDoc = inviteSnapshot.docs[0];
      const invite = inviteDoc.data() as AffiliatorInvite;
      const timestamp = new Date().toISOString();

      await inviteDoc.ref.update({
        hasDeposited: true,
        firstDepositAt: timestamp,
        firstDepositAmount: payload.amount,
        updatedAt: timestamp,
      });

      const programDoc = await db.collection(COLLECTIONS.AFFILIATOR_PROGRAMS).doc(invite.programId).get();
      if (!programDoc.exists) return;

      const program = programDoc.data() as AffiliatorProgram;
      const newDepositedCount = (program.totalInvitedDeposited || 0) + 1;

      const updates: any = {
        totalInvitedDeposited: newDepositedCount,
        updatedAt: timestamp,
      };

      const shouldCountForUnlock = !program.isCommissionUnlocked && newDepositedCount <= program.unlockThreshold;

      if (shouldCountForUnlock) {
        await inviteDoc.ref.update({ isCountedForUnlock: true, updatedAt: timestamp });
      }

      if (!program.isCommissionUnlocked && newDepositedCount >= program.unlockThreshold) {
        updates.isCommissionUnlocked = true;

        if (program.lockedCommissionBalance > 0) {
          updates.commissionBalance = program.commissionBalance + program.lockedCommissionBalance;
          updates.lockedCommissionBalance = 0;
          this.logger.log(
            `🔓 Commission balance UNLOCKED for affiliator ${program.userId}! ` +
            `Previously locked balance (${program.lockedCommissionBalance}) is now available.`
          );
        }

        this.logger.log(
          `🎉 Commission UNLOCKED for affiliator ${program.userId} after ${newDepositedCount} depositing invites!`
        );
      }

      await programDoc.ref.update(updates);

      this.logger.log(
        `✅ Deposit registered for invitee ${payload.userId} under affiliator ${program.userId}. ` +
        `Deposited count: ${newDepositedCount}/${program.unlockThreshold}`
      );
    } catch (error) {
      this.logger.error(`❌ handleUserDeposited error: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ORDER LOST HOOK: Called when an invited user loses a real order
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

      const programDoc = await db.collection(COLLECTIONS.AFFILIATOR_PROGRAMS).doc(invite.programId).get();
      if (!programDoc.exists) return;

      const program = programDoc.data() as AffiliatorProgram;

      if (!program.isActive || !program.isCommissionUnlocked) return;

      // The first N invitees who unlocked the commission do NOT generate commissions.
      // Only post-unlock invitees do.
      if (invite.isCountedForUnlock) return;

      const lossAmount = Math.abs(order.profit || order.amount);
      const commissionAmount = (lossAmount * program.revenueSharePercentage) / 100;

      if (commissionAmount <= 0) return;

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

      await programDoc.ref.update({
        commissionBalance: program.commissionBalance + commissionAmount,
        totalCommissionEarned: (program.totalCommissionEarned || 0) + commissionAmount,
        updatedAt: timestamp,
      });

      this.logger.log(
        `💰 Commission awarded to affiliator ${program.userId}: ` +
        `Rp ${commissionAmount.toLocaleString()} (${program.revenueSharePercentage}% of Rp ${lossAmount.toLocaleString()} loss by invitee ${order.user_id})`
      );
    } catch (error) {
      this.logger.error(`❌ handleOrderLost error: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

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