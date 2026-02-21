// src/auto-lose-system/interfaces/auto-lose.interface.ts

export interface AutoLoseConfig {
  id: string;
  isEnabled: boolean;

  /**
   * Killer mode: jika true, SEMUA order yang masuk akan LOSE
   * tanpa memperhatikan filter lainnya (targetAccountType, targetUserStatus, dsb.)
   */
  killerMode: boolean;

  /**
   * Target akun berdasarkan tipe: 'demo' | 'real' | 'both'
   */
  targetAccountType: 'demo' | 'real' | 'both';

  /**
   * Target user berdasarkan status akun
   * Bisa kombinasi: ['standard'], ['gold', 'vip'], ['standard', 'gold', 'vip']
   */
  targetUserStatus: ('standard' | 'gold' | 'vip')[];

  /**
   * Filter berdasarkan jumlah/amount order (inklusif)
   * null = tidak ada batasan minimum
   */
  minOrderAmount: number | null;

  /**
   * Filter berdasarkan jumlah/amount order maksimum (inklusif)
   * null = tidak ada batasan maksimum
   */
  maxOrderAmount: number | null;

  /**
   * Prioritas saat banyak order di timeframe yang sama:
   * - 'highest_amount': urutan dari amount terbesar dulu (default)
   * - 'all': semua order yang lolos filter langsung di-lose
   */
  priorityMode: 'highest_amount' | 'all';

  /**
   * Persentase order yang di-lose saat banyak order di timeframe yang sama.
   * 100 = semua di-lose, 50 = 50% order terbesar di-lose.
   * Hanya berlaku saat priorityMode = 'highest_amount'
   */
  losePercentage: number;

  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  updatedByEmail?: string;
}

export interface AutoLoseOrderTracker {
  /** Timeframe window key (misal: timestamp dibulatkan per menit) */
  windowKey: string;
  /** Map<orderId, { userId, amount, accountType, userStatus }> */
  orders: Map<string, {
    userId: string;
    amount: number;
    accountType: string;
    userStatus: string;
    entryTimestamp: number;
  }>;
}

export interface AutoLoseCheckResult {
  shouldForceLose: boolean;
  reason?: string;
  priority?: number; // ranking dalam timeframe window (1 = tertinggi)
}