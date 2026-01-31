// src/order-schedule/interfaces/order-schedule.interface.ts

export interface ScheduleExecutionSummary {
  scheduleId: string;
  totalExecuted: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped: number;
  winRate: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  averageProfitPerWin: number;
  averageLossPerLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  currentStreak: number;
  streakType: 'win' | 'loss' | 'none';
}

export interface MartingaleAnalysis {
  currentStep: number;
  maxStepReached: number;
  timesAtMaxStep: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  recoveryRate: number;
  averageRecoveryTime: number; // in executions
}

export interface SchedulePerformanceMetrics {
  roi: number; // Return on Investment (%)
  profitFactor: number; // Total Profit / Total Loss
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  averageDailyProfit: number;
  bestDay: {
    date: string;
    profit: number;
  };
  worstDay: {
    date: string;
    loss: number;
  };
}