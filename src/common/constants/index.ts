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
} as const;

export const COLLECTIONS = {
  USERS: 'users',
  BALANCE: 'balance',
  ORDERS: 'binary_orders',
  ASSETS: 'assets',
  AFFILIATES: 'affiliates',
} as const;

export const DURATIONS = {
  SHORT: [1, 2, 3, 4, 5],
  MEDIUM: [15, 30, 45, 60],
} as const;

export const ALL_DURATIONS = [1, 2, 3, 4, 5, 15, 30, 45, 60] as const;

export type ValidDuration = typeof ALL_DURATIONS[number];
export type BalanceAccountType = typeof BALANCE_ACCOUNT_TYPE[keyof typeof BALANCE_ACCOUNT_TYPE];
export type UserStatus = typeof USER_STATUS[keyof typeof USER_STATUS];
export type AffiliateStatus = typeof AFFILIATE_STATUS[keyof typeof AFFILIATE_STATUS];