// src/common/constants/index.ts
export const BALANCE_TYPES = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  ORDER_DEBIT: 'order_debit',      // ✅ BARU: Saat order dibuat
  ORDER_PROFIT: 'order_profit',    // ✅ BARU: Saat order menang
  // Legacy types (bisa dihapus nanti jika tidak dipakai)
  WIN: 'win',
  LOSE: 'lose',
} as const;

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  WON: 'WON',
  LOST: 'LOST',
  EXPIRED: 'EXPIRED',
} as const;

export const ORDER_DIRECTION = {
  CALL: 'CALL',  // Buy/Bullish
  PUT: 'PUT',    // Sell/Bearish
} as const;

export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  USER: 'user',
} as const;

export const COLLECTIONS = {
  USERS: 'users',
  BALANCE: 'balance',
  ORDERS: 'binary_orders',
  ASSETS: 'assets',
} as const;

export const DURATIONS = {
  SHORT: [1, 2, 3, 4, 5], // minutes
  MEDIUM: [15, 30, 45, 60], // minutes
} as const;

export const ALL_DURATIONS = [1, 2, 3, 4, 5, 15, 30, 45, 60] as const;

export type ValidDuration = typeof ALL_DURATIONS[number];