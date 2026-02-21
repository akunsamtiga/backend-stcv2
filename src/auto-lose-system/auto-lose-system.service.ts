// src/auto-lose-system/auto-lose-system.service.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { UpdateAutoLoseConfigDto } from './dto/update-auto-lose-config.dto';
import { AutoLoseConfig, AutoLoseCheckResult } from './interfaces/auto-lose.interface';
import { BinaryOrder } from '../common/interfaces';
import { TimezoneUtil } from '../common/utils';

const AUTO_LOSE_CONFIG_COLLECTION = 'auto_lose_system';
const AUTO_LOSE_CONFIG_DOC_ID = 'global_config';

/** Durasi window timeframe dalam detik (60 detik = 1 menit) */
const TIMEFRAME_WINDOW_SECONDS = 60;
/** Cache TTL untuk config (ms) */
const CONFIG_CACHE_TTL = 5000;

@Injectable()
export class AutoLoseSystemService implements OnModuleInit {
  private readonly logger = new Logger(AutoLoseSystemService.name);

  /** Cache config agar tidak perlu query Firestore setiap settle */
  private configCache: AutoLoseConfig | null = null;
  private configCacheTimestamp = 0;

  /**
   * Memory store untuk tracking order per timeframe window.
   * Key: `${windowKey}_${accountType}`
   * Value: array of { orderId, userId, amount, userStatus, entryTimestamp }
   */
  private orderWindowTracker: Map<
    string,
    Array<{
      orderId: string;
      userId: string;
      amount: number;
      accountType: string;
      userStatus: string;
      entryTimestamp: number;
    }>
  > = new Map();

  /** Cleanup window tracker setiap 5 menit */
  private readonly TRACKER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  /** Hapus window yang sudah lewat lebih dari 10 menit */
  private readonly TRACKER_MAX_AGE_SECONDS = 10 * 60;

  constructor(private readonly firebaseService: FirebaseService) {}

  async onModuleInit() {
    await this.ensureDefaultConfig();
    // Cleanup tracker secara berkala
    setInterval(() => this.cleanupTracker(), this.TRACKER_CLEANUP_INTERVAL_MS);
    this.logger.log('✅ AutoLoseSystem initialized');
  }

  // ============================================================
  // CONFIG MANAGEMENT
  // ============================================================

  /**
   * Pastikan ada doc konfigurasi default di Firestore
   */
  private async ensureDefaultConfig(): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();
      const docRef = db
        .collection(AUTO_LOSE_CONFIG_COLLECTION)
        .doc(AUTO_LOSE_CONFIG_DOC_ID);

      const doc = await docRef.get();

      if (!doc.exists) {
        const defaultConfig: AutoLoseConfig = {
          id: AUTO_LOSE_CONFIG_DOC_ID,
          isEnabled: false,
          killerMode: false,
          targetAccountType: 'both',
          targetUserStatus: ['standard', 'gold', 'vip'],
          minOrderAmount: null,
          maxOrderAmount: null,
          priorityMode: 'highest_amount',
          losePercentage: 100,
          createdAt: TimezoneUtil.toISOString(),
          updatedAt: TimezoneUtil.toISOString(),
        };

        await docRef.set(defaultConfig);
        this.configCache = defaultConfig;
        this.configCacheTimestamp = Date.now();
        this.logger.log('✅ AutoLoseSystem default config created');
      } else {
        this.configCache = doc.data() as AutoLoseConfig;
        this.configCacheTimestamp = Date.now();
        this.logger.log(
          `✅ AutoLoseSystem config loaded - enabled: ${this.configCache.isEnabled}, ` +
          `killerMode: ${this.configCache.killerMode}`,
        );
      }
    } catch (error) {
      this.logger.error(`❌ Failed to ensure default config: ${error.message}`);
    }
  }

  /**
   * Ambil config (dengan cache)
   */
  async getConfig(): Promise<AutoLoseConfig> {
    const now = Date.now();

    if (this.configCache && now - this.configCacheTimestamp < CONFIG_CACHE_TTL) {
      return this.configCache;
    }

    try {
      const db = this.firebaseService.getFirestore();
      const doc = await db
        .collection(AUTO_LOSE_CONFIG_COLLECTION)
        .doc(AUTO_LOSE_CONFIG_DOC_ID)
        .get();

      if (!doc.exists) {
        await this.ensureDefaultConfig();
        return this.configCache!;
      }

      this.configCache = doc.data() as AutoLoseConfig;
      this.configCacheTimestamp = Date.now();

      return this.configCache;
    } catch (error) {
      this.logger.error(`❌ getConfig error: ${error.message}`);
      if (this.configCache) return this.configCache;
      throw error;
    }
  }

  /**
   * Update konfigurasi AutoLoseSystem (Super Admin only)
   */
  async updateConfig(
    dto: UpdateAutoLoseConfigDto,
    adminId: string,
    adminEmail: string,
  ): Promise<AutoLoseConfig> {
    const db = this.firebaseService.getFirestore();
    const docRef = db
      .collection(AUTO_LOSE_CONFIG_COLLECTION)
      .doc(AUTO_LOSE_CONFIG_DOC_ID);

    const existing = await this.getConfig();

    const updated: AutoLoseConfig = {
      ...existing,
      ...this.sanitizeDto(dto),
      updatedAt: TimezoneUtil.toISOString(),
      updatedBy: adminId,
      updatedByEmail: adminEmail,
    };

    await docRef.set(updated);

    // Invalidate cache
    this.configCache = updated;
    this.configCacheTimestamp = Date.now();

    this.logger.log(
      `✅ AutoLoseSystem config updated by ${adminEmail}: ` +
      `enabled=${updated.isEnabled}, killerMode=${updated.killerMode}, ` +
      `targetAccountType=${updated.targetAccountType}, ` +
      `targetUserStatus=${updated.targetUserStatus?.join(',')}, ` +
      `minAmount=${updated.minOrderAmount}, maxAmount=${updated.maxOrderAmount}, ` +
      `priorityMode=${updated.priorityMode}, losePercentage=${updated.losePercentage}%`,
    );

    return updated;
  }

  /**
   * Toggle isEnabled
   */
  async toggleEnabled(
    isEnabled: boolean,
    adminId: string,
    adminEmail: string,
  ): Promise<AutoLoseConfig> {
    return this.updateConfig({ isEnabled }, adminId, adminEmail);
  }

  /**
   * Toggle killer mode
   */
  async toggleKillerMode(
    killerMode: boolean,
    adminId: string,
    adminEmail: string,
  ): Promise<AutoLoseConfig> {
    return this.updateConfig({ killerMode }, adminId, adminEmail);
  }

  // ============================================================
  // CORE LOGIC: ORDER REGISTRATION & AUTO-LOSE CHECK
  // ============================================================

  /**
   * Daftarkan order baru ke tracker saat order dibuat.
   * Dipanggil dari BinaryOrdersService.createOrder()
   */
  registerOrder(
    orderId: string,
    userId: string,
    amount: number,
    accountType: string,
    userStatus: string,
    entryTimestamp: number,
  ): void {
    const windowKey = this.getWindowKey(entryTimestamp, accountType);

    if (!this.orderWindowTracker.has(windowKey)) {
      this.orderWindowTracker.set(windowKey, []);
    }

    this.orderWindowTracker.get(windowKey)!.push({
      orderId,
      userId,
      amount,
      accountType,
      userStatus,
      entryTimestamp,
    });

    this.logger.debug(
      `📝 AutoLose tracked order ${orderId} in window ${windowKey} (amount: ${amount}, user: ${userId})`,
    );
  }

  /**
   * Cek apakah order harus di-force lose.
   * Dipanggil dari BinaryOrdersService.settleOrderInstant().
   * 
   * Priority: AutoLoseSystem > AssetSchedule
   * Jika AutoLoseSystem mengatakan LOSE, hasilnya LOST — terlepas dari AssetSchedule.
   */
  async shouldForceLose(order: BinaryOrder): Promise<AutoLoseCheckResult> {
    try {
      const config = await this.getConfig();

      // 1. Jika AutoLoseSystem tidak aktif → skip
      if (!config.isEnabled) {
        return { shouldForceLose: false, reason: 'AutoLoseSystem disabled' };
      }

      // 2. Killer Mode: SEMUA order lose tanpa memperhatikan filter
      if (config.killerMode) {
        this.logger.debug(`💀 KillerMode: force LOSE order ${order.id}`);
        return {
          shouldForceLose: true,
          reason: 'KillerMode active - all orders lose',
          priority: 0,
        };
      }

      // 3. Filter berdasarkan accountType
      if (!this.matchesAccountType(order.accountType, config.targetAccountType)) {
        return {
          shouldForceLose: false,
          reason: `accountType ${order.accountType} not in target ${config.targetAccountType}`,
        };
      }

      // 4. Filter berdasarkan userStatus
      if (!this.matchesUserStatus(order.userStatus || 'standard', config.targetUserStatus)) {
        return {
          shouldForceLose: false,
          reason: `userStatus ${order.userStatus} not in target`,
        };
      }

      // 5. Filter berdasarkan amount
      if (!this.matchesAmount(order.amount, config.minOrderAmount, config.maxOrderAmount)) {
        return {
          shouldForceLose: false,
          reason: `amount ${order.amount} out of range`,
        };
      }

      // 6. Cek prioritas berdasarkan timeframe window
      const entryTimestamp = TimezoneUtil.toTimestamp(new Date(order.entry_time));
      const windowKey = this.getWindowKey(entryTimestamp, order.accountType);
      const windowOrders = this.orderWindowTracker.get(windowKey) || [];

      if (config.priorityMode === 'all') {
        // Semua yang lolos filter langsung lose
        return {
          shouldForceLose: true,
          reason: `AutoLose - priorityMode: all`,
          priority: 1,
        };
      }

      // priorityMode = 'highest_amount': ranking berdasarkan amount
      const { shouldLose, rank } = this.calculatePriorityLose(
        order.id,
        order.amount,
        windowOrders,
        config.losePercentage,
      );

      if (shouldLose) {
        this.logger.debug(
          `💀 AutoLose: order ${order.id} rank #${rank} in window ${windowKey} ` +
          `(amount: ${order.amount}) → FORCE LOSE`,
        );
        return {
          shouldForceLose: true,
          reason: `AutoLose - highest_amount priority, rank #${rank} in window`,
          priority: rank,
        };
      }

      return {
        shouldForceLose: false,
        reason: `Order not in top ${config.losePercentage}% by amount in window`,
      };
    } catch (error) {
      this.logger.error(`❌ shouldForceLose error: ${error.message}`);
      // Fail safe: jangan lose jika ada error
      return { shouldForceLose: false, reason: `Error: ${error.message}` };
    }
  }

  /**
   * Manipulasi exit price agar order PASTI LOSE.
   * Jika CALL (harap naik) → exit < entry
   * Jika PUT (harap turun) → exit > entry
   */
  calculateForcedLosePrice(
    direction: 'CALL' | 'PUT',
    entryPrice: number,
  ): number {
    const manipulationFactor = 0.001; // 0.1% gerak untuk pastikan kalah

    if (direction === 'CALL') {
      // User berharap naik → paksa turun
      return entryPrice * (1 - manipulationFactor);
    } else {
      // User berharap turun → paksa naik
      return entryPrice * (1 + manipulationFactor);
    }
  }

  // ============================================================
  // ADMIN REPORTING
  // ============================================================

  /**
   * Statistik & status AutoLoseSystem untuk dashboard admin
   */
  async getStatus(): Promise<{
    config: AutoLoseConfig;
    trackerStats: {
      activeWindows: number;
      totalTrackedOrders: number;
      windows: Array<{
        windowKey: string;
        orderCount: number;
        totalAmount: number;
        topAmount: number;
      }>;
    };
  }> {
    const config = await this.getConfig();

    const windows: Array<{
      windowKey: string;
      orderCount: number;
      totalAmount: number;
      topAmount: number;
    }> = [];

    let totalTrackedOrders = 0;

    this.orderWindowTracker.forEach((orders, windowKey) => {
      if (orders.length > 0) {
        const totalAmount = orders.reduce((sum, o) => sum + o.amount, 0);
        const topAmount = Math.max(...orders.map((o) => o.amount));
        windows.push({ windowKey, orderCount: orders.length, totalAmount, topAmount });
        totalTrackedOrders += orders.length;
      }
    });

    // Sort by windowKey desc (terbaru dulu)
    windows.sort((a, b) => b.windowKey.localeCompare(a.windowKey));

    return {
      config,
      trackerStats: {
        activeWindows: this.orderWindowTracker.size,
        totalTrackedOrders,
        windows: windows.slice(0, 20), // tampilkan 20 window terbaru
      },
    };
  }

  /**
   * Riwayat log auto-lose dari Firestore
   */
  async getLogs(page = 1, limit = 50): Promise<any> {
    const db = this.firebaseService.getFirestore();

    try {
      const snapshot = await db
        .collection('auto_lose_logs')
        .orderBy('createdAt', 'desc')
        .limit(limit * page)
        .get();

      const logs = snapshot.docs.map((doc) => doc.data());
      const startIndex = (page - 1) * limit;
      const paginatedLogs = logs.slice(startIndex, startIndex + limit);

      return {
        logs: paginatedLogs,
        pagination: {
          page,
          limit,
          total: logs.length,
          totalPages: Math.ceil(logs.length / limit),
        },
      };
    } catch (error) {
      this.logger.error(`❌ getLogs error: ${error.message}`);
      return { logs: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  }

  /**
   * Simpan log ke Firestore saat order di-force lose
   */
  async logForcedLose(
    order: BinaryOrder,
    reason: string,
    manipulatedPrice: number,
  ): Promise<void> {
    try {
      const db = this.firebaseService.getFirestore();
      const logId = `als_${Date.now()}_${order.id.slice(-8)}`;

      await db.collection('auto_lose_logs').doc(logId).set({
        id: logId,
        orderId: order.id,
        userId: order.user_id,
        accountType: order.accountType,
        direction: order.direction,
        amount: order.amount,
        entryPrice: order.entry_price,
        manipulatedExitPrice: manipulatedPrice,
        userStatus: order.userStatus,
        assetId: order.asset_id,
        assetName: order.asset_name,
        reason,
        createdAt: TimezoneUtil.toISOString(),
      });
    } catch (error) {
      // Non-critical: log gagal tidak boleh ganggu settlement
      this.logger.warn(`⚠️ Failed to write auto-lose log: ${error.message}`);
    }
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private sanitizeDto(dto: UpdateAutoLoseConfigDto): Partial<AutoLoseConfig> {
    const result: Partial<AutoLoseConfig> = {};

    if (dto.isEnabled !== undefined) result.isEnabled = dto.isEnabled;
    if (dto.killerMode !== undefined) result.killerMode = dto.killerMode;
    if (dto.targetAccountType !== undefined) result.targetAccountType = dto.targetAccountType;
    if (dto.targetUserStatus !== undefined) result.targetUserStatus = dto.targetUserStatus;
    if (dto.minOrderAmount !== undefined) result.minOrderAmount = dto.minOrderAmount;
    if (dto.maxOrderAmount !== undefined) result.maxOrderAmount = dto.maxOrderAmount;
    if (dto.priorityMode !== undefined) result.priorityMode = dto.priorityMode;
    if (dto.losePercentage !== undefined) result.losePercentage = dto.losePercentage;

    return result;
  }

  /**
   * Buat key window berdasarkan timestamp yang dibulatkan ke menit
   */
  private getWindowKey(entryTimestamp: number, accountType: string): string {
    const windowTimestamp =
      Math.floor(entryTimestamp / TIMEFRAME_WINDOW_SECONDS) * TIMEFRAME_WINDOW_SECONDS;
    return `w${windowTimestamp}_${accountType}`;
  }

  private matchesAccountType(
    orderAccountType: string,
    target: 'demo' | 'real' | 'both',
  ): boolean {
    if (target === 'both') return true;
    return orderAccountType === target;
  }

  private matchesUserStatus(
    userStatus: string,
    targetStatuses: ('standard' | 'gold' | 'vip')[],
  ): boolean {
    if (!targetStatuses || targetStatuses.length === 0) return true;
    return targetStatuses.includes(userStatus as any);
  }

  private matchesAmount(
    amount: number,
    minAmount: number | null,
    maxAmount: number | null,
  ): boolean {
    if (minAmount !== null && amount < minAmount) return false;
    if (maxAmount !== null && amount > maxAmount) return false;
    return true;
  }

  /**
   * Kalkulasi apakah order ini harus lose berdasarkan ranking amount di window
   */
  private calculatePriorityLose(
    orderId: string,
    orderAmount: number,
    windowOrders: Array<{ orderId: string; amount: number }>,
    losePercentage: number,
  ): { shouldLose: boolean; rank: number } {
    if (windowOrders.length === 0) {
      return { shouldLose: true, rank: 1 };
    }

    // Sort descending by amount
    const sorted = [...windowOrders].sort((a, b) => b.amount - a.amount);

    // Cari rank order ini
    const rank = sorted.findIndex((o) => o.orderId === orderId);

    if (rank === -1) {
      // Order tidak ada di tracker (mungkin order lama) → paksa lose tetap
      return { shouldLose: true, rank: sorted.length + 1 };
    }

    const rankNumber = rank + 1; // 1-based

    // Hitung cutoff: top N% dari total order di window
    const totalOrders = sorted.length;
    const loseCutoff = Math.ceil((losePercentage / 100) * totalOrders);

    return {
      shouldLose: rankNumber <= loseCutoff,
      rank: rankNumber,
    };
  }

  /**
   * Cleanup tracker dari window-window yang sudah kedaluwarsa
   */
  private cleanupTracker(): void {
    const now = TimezoneUtil.getCurrentTimestamp();
    let cleaned = 0;

    this.orderWindowTracker.forEach((orders, windowKey) => {
      // Parse timestamp dari key: w{timestamp}_{accountType}
      const match = windowKey.match(/^w(\d+)_/);
      if (match) {
        const windowTimestamp = parseInt(match[1], 10);
        const age = now - windowTimestamp;

        if (age > this.TRACKER_MAX_AGE_SECONDS) {
          this.orderWindowTracker.delete(windowKey);
          cleaned++;
        }
      }
    });

    if (cleaned > 0) {
      this.logger.debug(`🧹 AutoLose tracker: cleaned ${cleaned} expired windows`);
    }
  }
}