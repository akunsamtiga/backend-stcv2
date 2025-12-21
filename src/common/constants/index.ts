export const BALANCE_TYPES = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
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

// Fix: Add 'as const' to ALL_DURATIONS
export const ALL_DURATIONS = [1, 2, 3, 4, 5, 15, 30, 45, 60] as const;

// Helper type for type-safe duration checking
export type ValidDuration = typeof ALL_DURATIONS[number];
