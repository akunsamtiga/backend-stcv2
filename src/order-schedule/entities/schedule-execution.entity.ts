// src/order-schedule/entities/schedule-execution.entity.ts

import { TrendType, AccountType } from '../dto/create-order-schedule.dto';

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  userId: string;
  
  // Execution Details
  executedAt: Date;
  scheduledTime: string;
  trend: TrendType;
  
  // Order Details
  orderId?: string;
  assetSymbol: string;
  amount: number;
  duration: number;
  accountType: AccountType;
  
  // ✅ Martingale Info per execution
  martingaleStep: number;
  isRecoveryAttempt: boolean;
  
  // Result
  status: 'pending' | 'executed' | 'failed' | 'skipped';
  result?: 'win' | 'loss' | 'draw';
  profit?: number;
  
  // Error Info
  errorMessage?: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}