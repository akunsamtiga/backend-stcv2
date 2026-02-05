// src/order-schedule/entities/order-schedule.entity.ts

import { 
  AccountType, 
  TrendType, 
  ScheduleStatus,
  MartingaleSettingDto,
  StopLossProfitDto,
  ScheduleTimeDto 
} from '../dto/create-order-schedule.dto';

// ✅ Re-export dari file terpisah
export { ScheduleExecution } from './schedule-execution.entity';

// ✅ State martingale per order (per scheduled time)
export interface OrderMartingaleState {
  scheduledTime: string;
  currentStep: number;
  consecutiveLosses: number;
  lastResult: 'win' | 'loss' | 'draw' | null;
  lastExecutedAt: Date | null;
  totalExecuted: number;
  totalWins: number;
  totalLosses: number;
}

export interface OrderSchedule {
  id: string;
  userId: string;
  userEmail: string;
  
  // Asset & Account Info
  assetSymbol: string;
  assetName?: string;
  accountType: AccountType;
  
  // Order Settings
  duration: number;
  amount: number;
  
  // Schedules
  schedules: ScheduleTimeDto[];
  
  // Martingale Settings
  martingaleSetting: MartingaleSettingDto;
  
  // ✅ State martingale per order
  orderMartingaleStates?: OrderMartingaleState[];
  
  // Stop Loss/Profit Settings
  stopLossProfit?: StopLossProfitDto;
  
  // Status & Tracking
  status: ScheduleStatus;
  isActive: boolean;
  
  // Execution Tracking
  totalExecuted: number;
  totalSuccess: number;
  totalFailed: number;
  
  // Profit/Loss Tracking
  currentProfit: number;
  totalProfit: number;
  totalLoss: number;
  
  // Backward compatibility fields
  currentMartingaleStep: number;
  consecutiveLosses: number;
  
  // Last Execution
  lastExecutedAt?: Date;
  lastExecutionResult?: 'win' | 'loss' | 'draw';
  
  // Metadata
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  pausedAt?: Date;
}