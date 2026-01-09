// src/common/utils/calculation.util.ts
// ✅ UPDATED: Support for 1 second duration (sub-minute precision)

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
   * ✅ Calculate balance dengan type baru
   */
  static calculateBalance(transactions: Array<{ type: string; amount: number }>): number {
    return transactions.reduce((sum, t) => {
      if (t.type === 'deposit' || t.type === 'order_profit' || t.type === 'win') {
        return sum + t.amount;
      } 
      else if (t.type === 'withdrawal' || t.type === 'order_debit' || t.type === 'lose') {
        return sum - t.amount;
      }
      return sum;
    }, 0);
  }

  /**
   * ✅ UPDATED: Calculate expiry time with support for sub-minute durations (1 second = 0.0167 minutes)
   * Ensures consistent timezone with simulator
   */
  static calculateExpiryTime(startTime: Date, durationMinutes: number): Date {
    // Convert minutes to milliseconds (supports decimal minutes for 1 second)
    const durationMs = durationMinutes * 60 * 1000;
    return new Date(startTime.getTime() + durationMs);
  }

  /**
   * ✅ NEW: Calculate expiry time from timestamp with sub-minute precision
   */
  static calculateExpiryTimestamp(startTimestamp: number, durationMinutes: number): number {
    // Convert minutes to seconds (supports 0.0167 minutes = 1 second)
    const durationSeconds = Math.round(durationMinutes * 60);
    return startTimestamp + durationSeconds;
  }

  /**
   * ✅ Get current timestamp (consistent with simulator)
   */
  static getCurrentTimestamp(): number {
    return TimezoneUtil.getCurrentTimestamp();
  }

  /**
   * ✅ Get current ISO string
   */
  static getCurrentISOString(): string {
    return TimezoneUtil.toISOString();
  }

  /**
   * ✅ Format datetime (consistent with simulator format)
   */
  static formatDateTime(date: Date = new Date()): string {
    return TimezoneUtil.formatDateTime(date);
  }

  /**
   * ✅ Check if order has expired (precise to seconds for 1s orders)
   */
  static isOrderExpired(exitTimestamp: number): boolean {
    return TimezoneUtil.isExpired(exitTimestamp);
  }

  /**
   * ✅ Get time remaining until expiry (in seconds)
   */
  static getTimeUntilExpiry(exitTimestamp: number): number {
    const now = TimezoneUtil.getCurrentTimestamp();
    return Math.max(0, exitTimestamp - now);
  }

  /**
   * ✅ UPDATED: Format order expiry info with sub-second precision
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

  /**
   * ✅ NEW: Convert duration in minutes to display format
   */
  static formatDurationDisplay(durationMinutes: number): string {
    if (durationMinutes < 1) {
      // Sub-minute durations (1 second = 0.0167 minutes)
      const seconds = Math.round(durationMinutes * 60);
      return `${seconds}s`;
    } else if (durationMinutes < 60) {
      // Minute durations
      return `${durationMinutes}m`;
    } else {
      // Hour durations
      const hours = Math.floor(durationMinutes / 60);
      const mins = durationMinutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
  }

  /**
   * ✅ NEW: Parse duration from display format to minutes
   */
  static parseDurationToMinutes(display: string): number {
    const match = display.match(/^(\d+)(s|m|h)$/);
    if (!match) {
      throw new Error('Invalid duration format. Use format like: 1s, 1m, 15m, 1h');
    }

    const [, value, unit] = match;
    const numValue = parseInt(value);

    switch (unit) {
      case 's':
        return numValue / 60; // Convert seconds to minutes (1s = 0.0167m)
      case 'm':
        return numValue;
      case 'h':
        return numValue * 60;
      default:
        throw new Error('Invalid duration unit');
    }
  }

  /**
   * ✅ NEW: Validate if duration is allowed for an asset
   */
  static isValidDuration(durationMinutes: number, allowedDurations: number[]): boolean {
    // Check with small tolerance for floating point comparison
    const tolerance = 0.0001;
    return allowedDurations.some(allowed => 
      Math.abs(allowed - durationMinutes) < tolerance
    );
  }
}