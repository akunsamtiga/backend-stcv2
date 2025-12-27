import TimezoneUtil from './timezone.util';

export class CalculationUtil {
  static calculateBinaryProfit(
    amount: number,
    profitRate: number,
  ): number {
    return (amount * profitRate) / 100;
  }

  static determineBinaryResult(
    direction: 'CALL' | 'PUT',
    entryPrice: number,
    exitPrice: number,
  ): 'WON' | 'LOST' {
    if (direction === 'CALL') {
      return exitPrice > entryPrice ? 'WON' : 'LOST';
    } else {
      return exitPrice < entryPrice ? 'WON' : 'LOST';
    }
  }

  /**
   * ✅ UPDATED: Calculate balance dengan type baru
   */
  static calculateBalance(transactions: Array<{ type: string; amount: number }>): number {
    return transactions.reduce((sum, t) => {
      // ✅ Tambah balance: deposit, order_profit
      if (t.type === 'deposit' || t.type === 'order_profit' || t.type === 'win') {
        return sum + t.amount;
      } 
      // ✅ Kurangi balance: withdrawal, order_debit
      else if (t.type === 'withdrawal' || t.type === 'order_debit' || t.type === 'lose') {
        return sum - t.amount;
      }
      return sum;
    }, 0);
  }

  /**
   * ✅ UPDATED: Calculate expiry time using TimezoneUtil
   * Ensures consistent timezone with simulator
   */
  static calculateExpiryTime(startTime: Date, durationMinutes: number): Date {
    return TimezoneUtil.addMinutes(startTime, durationMinutes);
  }

  /**
   * ✅ NEW: Get current timestamp (consistent with simulator)
   */
  static getCurrentTimestamp(): number {
    return TimezoneUtil.getCurrentTimestamp();
  }

  /**
   * ✅ NEW: Get current ISO string
   */
  static getCurrentISOString(): string {
    return TimezoneUtil.toISOString();
  }

  /**
   * ✅ NEW: Format datetime (consistent with simulator format)
   */
  static formatDateTime(date: Date = new Date()): string {
    return TimezoneUtil.formatDateTime(date);
  }

  /**
   * ✅ NEW: Check if order has expired
   */
  static isOrderExpired(exitTimestamp: number): boolean {
    return TimezoneUtil.isExpired(exitTimestamp);
  }

  /**
   * ✅ NEW: Get time remaining until expiry
   */
  static getTimeUntilExpiry(exitTimestamp: number): number {
    const now = TimezoneUtil.getCurrentTimestamp();
    return Math.max(0, exitTimestamp - now);
  }

  /**
   * ✅ NEW: Format order expiry info
   */
  static formatExpiryInfo(exitTimestamp: number): {
    isExpired: boolean;
    timeRemaining: number;
    formattedRemaining: string;
  } {
    const timeRemaining = this.getTimeUntilExpiry(exitTimestamp);
    const isExpired = timeRemaining === 0;

    return {
      isExpired,
      timeRemaining,
      formattedRemaining: TimezoneUtil.formatDuration(timeRemaining),
    };
  }
}