// src/common/constants/index.ts
// ✅ UPDATED: Added BALANCE_ACCOUNT_TYPE for Real/Demo separation

export const BALANCE_TYPES = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  ORDER_DEBIT: 'order_debit',
  ORDER_PROFIT: 'order_profit',
  WIN: 'win',  // Legacy
  LOSE: 'lose', // Legacy
} as const;

// ✅ NEW: Account types for balance separation
export const BALANCE_ACCOUNT_TYPE = {
  REAL: 'real',
  DEMO: 'demo',
} as const;

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  WON: 'WON',
  LOST: 'LOST',
  EXPIRED: 'EXPIRED',
} as const;

export const ORDER_DIRECTION = {
  CALL: 'CALL',
  PUT: 'PUT',
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
  SHORT: [1, 2, 3, 4, 5],
  MEDIUM: [15, 30, 45, 60],
} as const;

export const ALL_DURATIONS = [1, 2, 3, 4, 5, 15, 30, 45, 60] as const;

export type ValidDuration = typeof ALL_DURATIONS[number];
export type BalanceAccountType = typeof BALANCE_ACCOUNT_TYPE[keyof typeof BALANCE_ACCOUNT_TYPE];