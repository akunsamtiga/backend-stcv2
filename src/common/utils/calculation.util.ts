// src/common/utils/calculation.util.ts
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

  static calculateExpiryTime(startTime: Date, durationMinutes: number): Date {
    const durationMs = durationMinutes * 60 * 1000;
    return new Date(startTime.getTime() + durationMs);
  }

  static calculateExpiryTimestamp(startTimestamp: number, durationMinutes: number): number {
    const durationSeconds = Math.round(durationMinutes * 60);
    return startTimestamp + durationSeconds;
  }

  static getCurrentTimestamp(): number {
    return TimezoneUtil.getCurrentTimestamp();
  }

  static getCurrentISOString(): string {
    return TimezoneUtil.toISOString();
  }

  static formatDateTime(date: Date = new Date()): string {
    return TimezoneUtil.formatDateTime(date);
  }

  static isOrderExpired(exitTimestamp: number): boolean {
    return TimezoneUtil.isExpired(exitTimestamp);
  }

  static getTimeUntilExpiry(exitTimestamp: number): number {
    const now = TimezoneUtil.getCurrentTimestamp();
    return Math.max(0, exitTimestamp - now);
  }

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

  static formatDurationDisplay(durationMinutes: number): string {
    if (durationMinutes < 1) {
      const seconds = Math.round(durationMinutes * 60);
      return `${seconds}s`;
    } else if (durationMinutes < 60) {
      return `${durationMinutes}m`;
    } else {
      const hours = Math.floor(durationMinutes / 60);
      const mins = durationMinutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
  }

  static parseDurationToMinutes(display: string): number {
    const match = display.match(/^(\d+)(s|m|h)$/);
    if (!match) {
      throw new Error('Invalid duration format. Use format like: 1s, 1m, 15m, 1h');
    }

    const [, value, unit] = match;
    const numValue = parseInt(value);

    switch (unit) {
      case 's':
        return numValue / 60;
      case 'm':
        return numValue;
      case 'h':
        return numValue * 60;
      default:
        throw new Error('Invalid duration unit');
    }
  }

  static isValidDuration(durationMinutes: number, allowedDurations: number[]): boolean {
    const tolerance = 0.0001;
    return allowedDurations.some(allowed => 
      Math.abs(allowed - durationMinutes) < tolerance
    );
  }
}