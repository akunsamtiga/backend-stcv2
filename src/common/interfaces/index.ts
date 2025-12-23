// src/common/interfaces/index.ts
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
 * ✅ UPDATED: Balance interface dengan type baru
 */
export interface Balance {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdrawal' | 'order_debit' | 'order_profit' | 'win' | 'lose';
  amount: number;
  description?: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  name: string;
  symbol: string;
  profitRate: number; // 0-100 (e.g., 85 for 85%)
  isActive: boolean;
  dataSource: 'realtime_db' | 'api' | 'mock';
  realtimeDbPath?: string; // For Firebase Realtime DB
  apiEndpoint?: string; // For external API
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface BinaryOrder {
  id: string;
  user_id: string;
  asset_id: string;
  asset_name: string;
  direction: 'CALL' | 'PUT';
  amount: number;
  duration: number; // minutes
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