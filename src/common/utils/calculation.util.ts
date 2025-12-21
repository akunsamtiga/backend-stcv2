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
      if (t.type === 'deposit' || t.type === 'win') {
        return sum + t.amount;
      } else if (t.type === 'withdrawal' || t.type === 'lose') {
        return sum - t.amount;
      }
      return sum;
    }, 0);
  }

  static calculateExpiryTime(startTime: Date, durationMinutes: number): Date {
    return new Date(startTime.getTime() + durationMinutes * 60 * 1000);
  }
}
