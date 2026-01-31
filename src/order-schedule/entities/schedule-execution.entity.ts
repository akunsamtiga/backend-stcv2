// src/order-schedule/entities/schedule-execution.entity.ts

import { TrendType, AccountType } from '../dto/create-order-schedule.dto';

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  userId: string;
  
  // Execution Details
  executedAt: Date;
  scheduledTime: string; // waktu yang dijadwalkan (HH:mm)
  trend: TrendType;
  
  // Order Details
  orderId?: string; // ID dari binary_orders
  assetSymbol: string;
  amount: number;
  duration: number;
  accountType: AccountType;
  
  // Martingale Info
  martingaleStep: number; // step ke berapa dalam martingale
  isRecoveryAttempt: boolean; // apakah ini attempt untuk recovery loss
  
  // Result
  status: 'pending' | 'executed' | 'failed' | 'skipped';
  result?: 'win' | 'loss' | 'draw';
  profit?: number; // profit/loss dari execution ini
  
  // Error Info
  errorMessage?: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}