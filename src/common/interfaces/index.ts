// src/common/interfaces/index.ts
// ✅ ENHANCED: Complete user profile information

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

// ✅ ENHANCED: User Profile Information
export interface UserProfile {
  // Personal Information
  fullName?: string;
  phoneNumber?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  nationality?: string;
  
  // Address Information
  address?: {
    street?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
  
  // Identity Information (KYC)
  identityDocument?: {
    type?: 'ktp' | 'passport' | 'sim';
    number?: string;
    issuedDate?: string;
    expiryDate?: string;
    isVerified?: boolean;
    verifiedAt?: string;
  };
  
  // Bank Information
  bankAccount?: {
    bankName?: string;
    accountNumber?: string;
    accountHolderName?: string;
    isVerified?: boolean;
    verifiedAt?: string;
  };
  
  // Profile Picture
  avatar?: {
    url?: string;
    uploadedAt?: string;
  };
  
  // Account Settings
  settings?: {
    emailNotifications?: boolean;
    smsNotifications?: boolean;
    tradingAlerts?: boolean;
    twoFactorEnabled?: boolean;
    language?: string;
    timezone?: string;
  };
  
  // Account Verification
  verification?: {
    emailVerified?: boolean;
    phoneVerified?: boolean;
    identityVerified?: boolean;
    bankVerified?: boolean;
    verificationLevel?: 'unverified' | 'basic' | 'intermediate' | 'advanced';
  };
}

// ✅ ENHANCED: Complete User Interface
export interface User {
  id: string;
  email: string;
  password: string;
  role: 'super_admin' | 'admin' | 'user';
  status: 'standard' | 'gold' | 'vip';
  isActive: boolean;
  
  // ✅ NEW: Profile Information
  profile?: UserProfile;
  
  // Referral
  referralCode: string;
  referredBy?: string;
  
  // Metadata
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

export interface AffiliateStats {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalCommission: number;
  referrals: Affiliate[];
}

// ✅ NEW: Profile Update History
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