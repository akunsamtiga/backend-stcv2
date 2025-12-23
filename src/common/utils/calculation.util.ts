// src/common/utils/calculation.util.ts
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

  static calculateExpiryTime(startTime: Date, durationMinutes: number): Date {
    return new Date(startTime.getTime() + durationMinutes * 60 * 1000);
  }
}