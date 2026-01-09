// src/common/constants/index.ts
// ✅ UPDATED: Added 1 second duration support

export const BALANCE_TYPES = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  ORDER_DEBIT: 'order_debit',
  ORDER_PROFIT: 'order_profit',
  WIN: 'win',
  LOSE: 'lose',
  AFFILIATE_COMMISSION: 'affiliate_commission',
} as const;

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

export const USER_STATUS = {
  STANDARD: 'standard',
  GOLD: 'gold',
  VIP: 'vip',
} as const;

export const STATUS_REQUIREMENTS = {
  STANDARD: {
    minDeposit: 0,
    maxDeposit: 160000,
    profitBonus: 0,
    label: 'Standard',
    color: '#6B7280',
  },
  GOLD: {
    minDeposit: 160000,
    maxDeposit: 1600000,
    profitBonus: 5,
    label: 'Gold',
    color: '#F59E0B',
  },
  VIP: {
    minDeposit: 1600000,
    maxDeposit: Infinity,
    profitBonus: 10,
    label: 'VIP',
    color: '#8B5CF6',
  },
} as const;

export const AFFILIATE_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
} as const;

export const AFFILIATE_CONFIG = {
  COMMISSION_AMOUNT: 25000, 
  MIN_DEPOSIT_TO_ACTIVATE: 1,
  COMMISSION_BY_STATUS: {
    STANDARD: 25000,
    GOLD: 100000,
    VIP: 400000,
  },
} as const;

export const COLLECTIONS = {
  USERS: 'users',
  BALANCE: 'balance',
  ORDERS: 'binary_orders',
  ASSETS: 'assets',
  AFFILIATES: 'affiliates',
} as const;

// ✅ UPDATED: Added 1 second (converted to 0.0167 minutes internally)
export const DURATIONS = {
  // Ultra short (seconds converted to minutes for internal use)
  ULTRA_SHORT: [0.0167], // 1 second = 0.0167 minutes
  
  // Short term (minutes)
  SHORT: [1, 2, 3, 4, 5],
  
  // Medium term (minutes)
  MEDIUM: [15, 30, 45, 60],
} as const;

// ✅ NEW: Duration in seconds for display and validation
export const DURATION_SECONDS = {
  ULTRA_SHORT: [1],           // 1 second
  SHORT: [60, 120, 180, 240, 300],  // 1-5 minutes in seconds
  MEDIUM: [900, 1800, 2700, 3600],  // 15-60 minutes in seconds
} as const;

// ✅ UPDATED: All durations including 1 second (in minutes for backend)
// Frontend will convert seconds to minutes automatically
export const ALL_DURATIONS = [
  0.0167,  // 1 second (displayed as "1s" in frontend)
  1, 2, 3, 4, 5,           // 1-5 minutes
  15, 30, 45, 60           // 15-60 minutes
] as const;

// ✅ NEW: Duration display configuration
export const DURATION_CONFIG = {
  // Map internal minutes to display format
  0.0167: { display: '1s', seconds: 1, minutes: 0.0167, type: 'ultra_short' },
  1: { display: '1m', seconds: 60, minutes: 1, type: 'short' },
  2: { display: '2m', seconds: 120, minutes: 2, type: 'short' },
  3: { display: '3m', seconds: 180, minutes: 3, type: 'short' },
  4: { display: '4m', seconds: 240, minutes: 4, type: 'short' },
  5: { display: '5m', seconds: 300, minutes: 5, type: 'short' },
  15: { display: '15m', seconds: 900, minutes: 15, type: 'medium' },
  30: { display: '30m', seconds: 1800, minutes: 30, type: 'medium' },
  45: { display: '45m', seconds: 2700, minutes: 45, type: 'medium' },
  60: { display: '60m', seconds: 3600, minutes: 60, type: 'medium' },
} as const;

export type ValidDuration = typeof ALL_DURATIONS[number];
export type BalanceAccountType = typeof BALANCE_ACCOUNT_TYPE[keyof typeof BALANCE_ACCOUNT_TYPE];
export type UserStatus = typeof USER_STATUS[keyof typeof USER_STATUS];
export type AffiliateStatus = typeof AFFILIATE_STATUS[keyof typeof AFFILIATE_STATUS];