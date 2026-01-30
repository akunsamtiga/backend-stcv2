// src/asset-schedule/interfaces/asset-schedule.interface.ts

export interface AssetSchedule {
  id: string;
  assetSymbol: string;
  scheduledTime: Date;
  trend: 'buy' | 'sell';
  timeframe: string;
  notes?: string;
  isActive: boolean;
  status: 'pending' | 'executed' | 'failed' | 'cancelled';
  createdBy: string;
  createdByEmail: string;
  createdAt: Date;
  updatedAt: Date;
  executedAt?: Date;
  executionDetails?: {
    startPrice?: number;
    endPrice?: number;
    priceChange?: number;
    success: boolean;
    errorMessage?: string;
  };
}