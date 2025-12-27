// src/common/interfaces/index.ts
// ✅ UPDATED: Balance and BinaryOrder interfaces with accountType

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

/**
 * ✅ UPDATED: Balance interface with accountType (real/demo)
 */
export interface Balance {
  id: string;
  user_id: string;
  accountType: 'real' | 'demo'; // ✅ NEW: Separate real and demo balance
  type: 'deposit' | 'withdrawal' | 'order_debit' | 'order_profit' | 'win' | 'lose';
  amount: number;
  description?: string;
  createdAt: string;
}

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
  createdAt: string;
  updatedAt?: string;
}

/**
 * ✅ UPDATED: BinaryOrder interface with accountType
 */
export interface BinaryOrder {
  id: string;
  user_id: string;
  accountType: 'real' | 'demo'; // ✅ NEW: Track which account was used
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

/**
 * ✅ NEW: Balance summary for both accounts
 */
export interface BalanceSummary {
  realBalance: number;
  demoBalance: number;
  realTransactions: number;
  demoTransactions: number;
}