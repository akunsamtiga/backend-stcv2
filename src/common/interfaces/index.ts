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

export interface UserProfile {
  fullName?: string;
  phoneNumber?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  nationality?: string;
  
  address?: {
    street?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
  
  // ✅ ENHANCED: Identity Document with Photos
  identityDocument?: {
    type?: 'ktp' | 'passport' | 'sim';
    number?: string;
    issuedDate?: string;
    expiryDate?: string;
    isVerified?: boolean;
    verifiedAt?: string;
    // ✅ NEW: Photo fields
    photoFront?: {
      url: string;
      uploadedAt: string;
      fileSize?: number;
      mimeType?: string;
    };
    photoBack?: {
      url: string;
      uploadedAt: string;
      fileSize?: number;
      mimeType?: string;
    };
  };
  
  bankAccount?: {
    bankName?: string;
    accountNumber?: string;
    accountHolderName?: string;
    isVerified?: boolean;
    verifiedAt?: string;
  };
  
  // ✅ ENHANCED: Avatar with metadata
  avatar?: {
    url: string;
    uploadedAt: string;
    fileSize?: number;
    mimeType?: string;
  };
  
  // ✅ NEW: Selfie Verification
  selfieVerification?: {
    photoUrl: string;
    uploadedAt: string;
    isVerified: boolean;
    verifiedAt?: string;
    fileSize?: number;
    mimeType?: string;
  };
  
  settings?: {
    emailNotifications?: boolean;
    smsNotifications?: boolean;
    tradingAlerts?: boolean;
    twoFactorEnabled?: boolean;
    language?: string;
    timezone?: string;
  };
  
  verification?: {
    emailVerified?: boolean;
    phoneVerified?: boolean;
    identityVerified?: boolean;
    bankVerified?: boolean;
    // ✅ NEW: Selfie verification status
    selfieVerified?: boolean;
    verificationLevel?: 'unverified' | 'basic' | 'intermediate' | 'advanced';
  };
}


export interface User {
  id: string;
  email: string;
  password: string;
  role: 'super_admin' | 'admin' | 'user';
  status: 'standard' | 'gold' | 'vip';
  isActive: boolean;
  profile?: UserProfile;
  referralCode: string;
  referredBy?: string;
  isNewUser: boolean  
  tutorialCompleted: boolean  
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  lastLoginAt?: string;
  loginCount?: number;
}

export interface Balance {
  id: string;
  user_id: string;
  accountType: 'real' | 'demo';
  type: 'deposit' | 'withdrawal' | 'order_debit' | 'order_profit' | 'win' | 'lose' | 'affiliate_commission';
  amount: number;
  description?: string;
  createdAt: string;
}

export interface Affiliate {
  id: string;
  referrer_id: string;
  referee_id: string;
  status: 'pending' | 'completed';
  commission_amount: number;
  referee_status?: string; 
  completed_at?: string;
  createdAt: string;
}

export interface AffiliateStats {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalCommission: number;
  referrals: Affiliate[];
}

export interface Asset {
  id: string;
  name: string;
  symbol: string;
  
  icon?: string;
  type: 'forex' | 'stock' | 'commodity' | 'crypto' | 'index';

  category: 'normal' | 'crypto';
  
  profitRate: number;
  isActive: boolean;
  
  dataSource: 'realtime_db' | 'api' | 'mock' | 'binance';
  
  realtimeDbPath?: string;
  
  apiEndpoint?: string;
  
  cryptoConfig?: {
    baseCurrency: string;    
    quoteCurrency: string;   
    exchange?: string;       
  };
  
  description?: string;
  
  simulatorSettings?: {
    initialPrice: number;
    dailyVolatilityMin: number;
    dailyVolatilityMax: number;
    secondVolatilityMin: number;
    secondVolatilityMax: number;
    minPrice?: number;
    maxPrice?: number;
  };
  
  tradingSettings?: {
    minOrderAmount: number;
    maxOrderAmount: number;
    allowedDurations: number[];
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
  baseProfitRate?: number;
  statusBonus?: number;
  userStatus?: string;
  createdAt: string;
}

export interface RealtimePrice {
  price: number;
  timestamp: number;
  datetime: string;
}

export interface CryptoComparePrice {
  price: number;
  timestamp: number;
  datetime: string;
  volume24h?: number;
  change24h?: number;
  changePercent24h?: number;
  high24h?: number;
  low24h?: number;
  marketCap?: number;
}

export interface BalanceSummary {
  realBalance: number;
  demoBalance: number;
  realTransactions: number;
  demoTransactions: number;
}

export interface UserStatusInfo {
  status: 'standard' | 'gold' | 'vip';
  totalDeposit: number;
  profitBonus: number;
  nextStatus?: string;
  nextStatusAt?: number;
  progress?: number;
}

export interface ProfileUpdateHistory {
  id: string;
  user_id: string;
  field: string;
  oldValue: any;
  newValue: any;
  updatedBy: string;
  updatedAt: string;
  reason?: string;
}