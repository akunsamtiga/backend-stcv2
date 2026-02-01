// src/order-schedule/entities/order-schedule.entity.ts

import { 
  AccountType, 
  TrendType, 
  ScheduleStatus,
  MartingaleSettingDto,
  StopLossProfitDto,
  ScheduleTimeDto 
} from '../dto/create-order-schedule.dto';

export interface OrderSchedule {
  id: string;
  userId: string;
  userEmail: string;
  
  // Asset & Account Info
  assetSymbol: string;
  assetName?: string;
  accountType: AccountType;
  
  // Order Settings
  duration: number; // dalam detik
  amount: number; // dalam IDR
  
  // Schedules
  schedules: ScheduleTimeDto[];
  
  // Martingale Settings
  martingaleSetting: MartingaleSettingDto;
  
  // Stop Loss/Profit Settings
  stopLossProfit?: StopLossProfitDto;
  
  // Status & Tracking
  status: ScheduleStatus;
  isActive: boolean;
  
  // Execution Tracking
  totalExecuted: number; // total order yang sudah dieksekusi
  totalSuccess: number; // total order yang sukses
  totalFailed: number; // total order yang gagal
  
  // Profit/Loss Tracking
  currentProfit: number; // profit/loss saat ini (IDR)
  totalProfit: number; // total profit sejak dibuat (IDR)
  totalLoss: number; // total loss sejak dibuat (IDR)
  
  // Martingale Tracking
  currentMartingaleStep: number; // step martingale saat ini
  consecutiveLosses: number; // jumlah loss berturut-turut
  
  // Last Execution
  lastExecutedAt?: Date;
  lastExecutionResult?: 'win' | 'loss' | 'draw';
  
  // Metadata
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date; // kapan schedule mulai berjalan
  completedAt?: Date; // kapan schedule selesai
  pausedAt?: Date; // kapan schedule di-pause
}

// Re-export dari file terpisah
export { ScheduleExecution } from './schedule-execution.entity';
export { ScheduleStatistics } from './schedule-statistics.entity';