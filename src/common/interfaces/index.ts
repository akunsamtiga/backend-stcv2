// src/common/interfaces/index.ts
// ✅ UPDATED: Asset interface dengan full control fields

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  timestamp: string;
  path: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface User {
  id: string;
  email: string;
  password: string;
  role: 'super_admin' | 'admin' | 'user';
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface Balance {
  id: string;
  user_id: string;
  accountType: 'real' | 'demo';
  type: 'deposit' | 'withdrawal' | 'order_debit' | 'order_profit' | 'win' | 'lose';
  amount: number;
  description?: string;
  createdAt: string;
}

/**
 * ✅ UPDATED: Asset interface dengan kontrol penuh untuk Super Admin
 */
export interface Asset {
  id: string;
  name: string;
  symbol: string;
  profitRate: number;
  isActive: boolean;
  dataSource: 'realtime_db' | 'api' | 'mock';
  realtimeDbPath?: string;
  apiEndpoint?: string;
  description?: string;
  
  // ✅ NEW: Simulator Settings (controllable by Super Admin)
  simulatorSettings?: {
    initialPrice: number;
    dailyVolatilityMin: number;
    dailyVolatilityMax: number;
    secondVolatilityMin: number;
    secondVolatilityMax: number;
    minPrice?: number; // Optional: minimum allowed price
    maxPrice?: number; // Optional: maximum allowed price
  };
  
  // ✅ NEW: Trading Settings
  tradingSettings?: {
    minOrderAmount: number;
    maxOrderAmount: number;
    allowedDurations: number[]; // e.g., [1,2,3,4,5,15,30,45,60]
  };
  
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface BinaryOrder {
  id: string;
  user_id: string;
  accountType: 'real' | 'demo';
  asset_id: string;
  asset_name: string;
  direction: 'CALL' | 'PUT';
  amount: number;
  duration: number;
  entry_price: number;
  entry_time: string;
  exit_price: number | null;
  exit_time: string | null;
  status: 'PENDING' | 'ACTIVE' | 'WON' | 'LOST' | 'EXPIRED';
  profit: number | null;
  profitRate: number;
  createdAt: string;
}

export interface RealtimePrice {
  price: number;
  timestamp: number;
  datetime: string;
}

export interface BalanceSummary {
  realBalance: number;
  demoBalance: number;
  realTransactions: number;
  demoTransactions: number;
}