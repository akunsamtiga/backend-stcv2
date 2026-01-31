// src/order-schedule/utils/order-schedule.utils.ts

import { ORDER_SCHEDULE_CONSTANTS } from '../constants/order-schedule.constants';

export class OrderScheduleUtils {
  /**
   * Format waktu dari Date ke HH:mm
   */
  static formatTimeToSchedule(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Parse waktu HH:mm ke Date object (hari ini)
   */
  static parseScheduleTime(timeString: string): Date {
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  /**
   * Validasi format waktu HH:mm
   */
  static isValidTimeFormat(timeString: string): boolean {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(timeString);
  }

  /**
   * Calculate total maksimal amount yang dibutuhkan dengan martingale
   */
  static calculateMaxRequiredAmount(
    baseAmount: number,
    maxStep: number,
    multiplier: number
  ): number {
    let total = 0;
    for (let step = 0; step <= maxStep; step++) {
      total += baseAmount * Math.pow(multiplier, step);
    }
    return total;
  }

  /**
   * Calculate profit dengan profit rate
   */
  static calculateProfit(
    amount: number,
    profitRate: number = ORDER_SCHEDULE_CONSTANTS.DEFAULT_PROFIT_RATE
  ): number {
    return amount * profitRate;
  }

  /**
   * Get status color untuk UI
   */
  static getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      pending: '#d9d9d9',
      active: '#52c41a',
      paused: '#faad14',
      completed: '#1890ff',
      cancelled: '#f5222d',
    };
    return colors[status] || colors.pending;
  }

  /**
   * Get trend label
   */
  static getTrendLabel(trend: string): string {
    return trend === 'buy' ? 'BUY ▲' : 'SELL ▼';
  }

  /**
   * Format currency IDR
   */
  static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Calculate win rate percentage
   */
  static calculateWinRate(totalSuccess: number, totalExecuted: number): number {
    if (totalExecuted === 0) return 0;
    return Math.round((totalSuccess / totalExecuted) * 100);
  }

  /**
   * Check apakah waktu schedule sudah lewat hari ini
   */
  static hasScheduleTimePassed(scheduledTime: string): boolean {
    const now = new Date();
    const scheduleDate = this.parseScheduleTime(scheduledTime);
    return now > scheduleDate;
  }

  /**
   * Get next execution time untuk schedule
   */
  static getNextExecutionTime(schedules: Array<{ time: string }>): string | null {
    const now = new Date();
    const currentTime = this.formatTimeToSchedule(now);

    // Filter schedules yang belum dieksekusi hari ini
    const upcomingSchedules = schedules
      .filter(s => s.time > currentTime)
      .sort((a, b) => a.time.localeCompare(b.time));

    if (upcomingSchedules.length > 0) {
      return upcomingSchedules[0].time;
    }

    // Jika tidak ada, return schedule pertama besok
    const sortedSchedules = schedules.sort((a, b) => a.time.localeCompare(b.time));
    return sortedSchedules.length > 0 ? sortedSchedules[0].time : null;
  }

  /**
   * Validasi schedule agar tidak overlap
   */
  static validateNoOverlap(
    schedules: Array<{ time: string }>,
    durationSeconds: number
  ): { valid: boolean; message?: string } {
    const sortedSchedules = schedules
      .map(s => this.parseScheduleTime(s.time))
      .sort((a, b) => a.getTime() - b.getTime());

    for (let i = 0; i < sortedSchedules.length - 1; i++) {
      const current = sortedSchedules[i];
      const next = sortedSchedules[i + 1];
      
      const currentEnd = new Date(current.getTime() + durationSeconds * 1000);
      
      if (currentEnd > next) {
        return {
          valid: false,
          message: `Schedule overlap detected: ${this.formatTimeToSchedule(current)} and ${this.formatTimeToSchedule(next)}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Estimate daily profit/loss
   */
  static estimateDailyProfit(
    schedules: Array<{ time: string }>,
    baseAmount: number,
    profitRate: number = ORDER_SCHEDULE_CONSTANTS.DEFAULT_PROFIT_RATE,
    winRate: number = 0.6 // Assume 60% win rate
  ): {
    totalExecutions: number;
    estimatedWins: number;
    estimatedLosses: number;
    bestCase: number;
    worstCase: number;
    expectedValue: number;
  } {
    const totalExecutions = schedules.length;
    const estimatedWins = Math.round(totalExecutions * winRate);
    const estimatedLosses = totalExecutions - estimatedWins;

    const profitPerWin = this.calculateProfit(baseAmount, profitRate);
    const lossPerLoss = baseAmount;

    const bestCase = totalExecutions * profitPerWin;
    const worstCase = -totalExecutions * lossPerLoss;
    const expectedValue = (estimatedWins * profitPerWin) - (estimatedLosses * lossPerLoss);

    return {
      totalExecutions,
      estimatedWins,
      estimatedLosses,
      bestCase,
      worstCase,
      expectedValue,
    };
  }

  /**
   * Suggest optimal martingale settings based on balance
   */
  static suggestMartingaleSettings(
    baseAmount: number,
    availableBalance: number
  ): {
    maxStep: number;
    multiplier: number;
    totalRequired: number;
  } {
    const multipliers = [1.5, 2, 2.5, 3];
    
    for (const multiplier of multipliers) {
      for (let step = 3; step >= 0; step--) {
        const required = this.calculateMaxRequiredAmount(baseAmount, step, multiplier);
        
        // Pastikan balance cukup dengan margin 20%
        if (required * 1.2 <= availableBalance) {
          return {
            maxStep: step,
            multiplier,
            totalRequired: required,
          };
        }
      }
    }

    // Jika balance tidak cukup untuk martingale
    return {
      maxStep: 0,
      multiplier: 1,
      totalRequired: baseAmount,
    };
  }
}