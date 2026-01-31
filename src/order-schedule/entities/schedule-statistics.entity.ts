// src/order-schedule/entities/schedule-statistics.entity.ts

export interface ScheduleStatistics {
  scheduleId: string;
  userId: string;
  
  // Daily Stats
  date: string; // YYYY-MM-DD
  
  totalExecuted: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped: number;
  
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  
  winRate: number; // persentase kemenangan
  
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  
  maxMartingaleStepReached: number;
  
  createdAt: Date;
  updatedAt: Date;
}