// src/common/constants/index.ts

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

// ============================================
// WITHDRAWAL CONSTANTS (NEW)
// ============================================

export const WITHDRAWAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  COMPLETED: 'completed',
} as const;

export const WITHDRAWAL_CONFIG = {
  MIN_AMOUNT: 100000, // Minimum Rp 100,000
  REQUIRE_KTP: true,
  REQUIRE_SELFIE: true,
  REQUIRE_BANK_ACCOUNT: true,
} as const;

// ============================================
// COLLECTIONS
// ============================================

export const COLLECTIONS = {
  USERS: 'users',
  BALANCE: 'balance',
  ORDERS: 'binary_orders',
  ASSETS: 'assets',
  AFFILIATES: 'affiliates',
  WITHDRAWAL_REQUESTS: 'withdrawal_requests', // 👈 NEW COLLECTION
} as const;

export const ASSET_TYPE = {
  FOREX: 'forex',
  STOCK: 'stock',
  COMMODITY: 'commodity',
  CRYPTO: 'crypto',
  INDEX: 'index',
} as const;

export const ASSET_CATEGORY = {
  NORMAL: 'normal',
  CRYPTO: 'crypto',
} as const;

export const ASSET_DATA_SOURCE = {
  REALTIME_DB: 'realtime_db',
  API: 'api',
  MOCK: 'mock',
  BINANCE: 'binance',  
} as const;

export const ASSET_TYPE_INFO = {
  forex: {
    label: 'Forex',
    description: 'Foreign Exchange Currency Pairs',
    examples: ['EUR/USD', 'GBP/USD', 'USD/JPY'],
    icon: '💱',
  },
  stock: {
    label: 'Stocks',
    description: 'Company Shares & Equities',
    examples: ['AAPL', 'GOOGL', 'TSLA'],
    icon: '📈',
  },
  commodity: {
    label: 'Commodities',
    description: 'Raw Materials & Resources',
    examples: ['Gold', 'Silver', 'Oil'],
    icon: '🛢️',
  },
  crypto: {
    label: 'Cryptocurrency',
    description: 'Digital Currencies',
    examples: ['BTC/USD', 'ETH/USD', 'BNB/USD'],
    icon: '₿',
  },
  index: {
    label: 'Indices',
    description: 'Stock Market Indices',
    examples: ['S&P 500', 'NASDAQ', 'Dow Jones'],
    icon: '📊',
  },
} as const;

export const BINANCE_CONFIG = {
  BASE_URL: 'https://api.binance.com/api/v3',
  CACHE_TTL: 60000,       
  STALE_CACHE_TTL: 300000, 
  TIMEOUT: 10000,          
  RATE_LIMIT_DELAY: 100,   
  MIN_CALL_INTERVAL: 50,   
} as const;

export const CRYPTO_SYMBOLS = {
  BITCOIN: 'BTC',
  ETHEREUM: 'ETH',
  BINANCE_COIN: 'BNB',
  RIPPLE: 'XRP',
  CARDANO: 'ADA',
  SOLANA: 'SOL',
  POLKADOT: 'DOT',
  DOGECOIN: 'DOGE',
  POLYGON: 'MATIC',
  LITECOIN: 'LTC',
} as const;

export const DURATIONS = {
  ULTRA_SHORT: [0.0167],
  SHORT: [1, 2, 3, 4, 5],
  MEDIUM: [15, 30, 45, 60],
} as const;

export const DURATION_SECONDS = {
  ULTRA_SHORT: [1],
  SHORT: [60, 120, 180, 240, 300],
  MEDIUM: [900, 1800, 2700, 3600],
} as const;

export const ALL_DURATIONS = [
  0.0167,
  1, 2, 3, 4, 5,
  15, 30, 45, 60
] as const;

export const DURATION_CONFIG = {
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
export type WithdrawalStatus = typeof WITHDRAWAL_STATUS[keyof typeof WITHDRAWAL_STATUS]; // 👈 NEW TYPE
export type AssetType = typeof ASSET_TYPE[keyof typeof ASSET_TYPE];
export type AssetCategory = typeof ASSET_CATEGORY[keyof typeof ASSET_CATEGORY];
export type AssetDataSource = typeof ASSET_DATA_SOURCE[keyof typeof ASSET_DATA_SOURCE];