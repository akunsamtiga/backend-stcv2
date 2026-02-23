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

  identityDocument?: {
    type?: 'ktp' | 'passport' | 'sim';
    number?: string;
    issuedDate?: string;
    expiryDate?: string;
    isVerified?: boolean;
    verifiedAt?: string;
    verifiedBy?: string;
    rejectionReason?: string;
    rejectedAt?: string;
    rejectedBy?: string;
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

  avatar?: {
    url: string;
    uploadedAt: string;
    fileSize?: number;
    mimeType?: string;
  };

  selfieVerification?: {
    photoUrl: string;
    uploadedAt: string;
    isVerified: boolean;
    verifiedAt?: string;
    verifiedBy?: string;
    rejectionReason?: string;
    rejectedAt?: string;
    rejectedBy?: string;
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
  isNewUser: boolean;
  tutorialCompleted: boolean;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  lastLoginAt?: string;
  loginCount?: number;
  // Affiliate Program fields
  isAffiliator?: boolean;
  affiliatorProgramId?: string;
}

export interface Balance {
  id: string;
  user_id: string;
  accountType: 'real' | 'demo';
  type: 'deposit' | 'withdrawal' | 'order_debit' | 'order_profit' | 'win' | 'lose' | 'affiliate_commission' | 'voucher_bonus';
  amount: number;
  description?: string;
  createdAt: string;
}

export interface WithdrawalRequest {
  id: string;
  user_id: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  description?: string;
  userEmail: string;
  userName?: string;
  bankAccount?: {
    bankName: string;
    accountNumber: string;
    accountHolderName: string;
  };
  ktpVerified: boolean;
  selfieVerified: boolean;
  currentBalance: number;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  adminNotes?: string;
  createdAt: string;
  updatedAt?: string;
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

// ─── Affiliate Program Interfaces ────────────────────────────────────────────

export interface AffiliatorProgram {
  id: string;
  userId: string;
  userEmail: string;
  affiliateCode: string;       // Format: AFF + 8 alphanumeric chars
  isActive: boolean;

  // Commission config
  revenueSharePercentage: number;  // Default: 50
  unlockThreshold: number;         // Default: 5 (invited users who must deposit)

  // Balances
  commissionBalance: number;       // Available (unlocked) commission balance — reserved saat ada withdrawal pending
  lockedCommissionBalance: number; // Accumulated before unlock (reserved / informational)
  isCommissionUnlocked: boolean;

  // Stats
  totalInvited: number;
  totalInvitedDeposited: number;
  totalCommissionEarned: number;
  totalCommissionWithdrawn?: number; // Total yang sudah berhasil ditarik (status: completed)

  // Admin tracking
  assignedBy: string;
  assignedAt: string;
  updatedBy?: string;
  revokedBy?: string;
  revokedAt?: string;

  createdAt: string;
  updatedAt: string;
}

export interface AffiliatorInvite {
  id: string;
  affiliatorId: string;   // userId of the affiliator
  programId: string;      // AffiliatorProgram.id
  inviteeId: string;
  inviteeEmail: string;

  hasDeposited: boolean;
  firstDepositAt?: string;
  firstDepositAmount?: number;

  // Whether this invite was counted toward the unlock threshold.
  // First N (unlockThreshold) depositing invitees get isCountedForUnlock = true
  // and do NOT generate commissions.
  isCountedForUnlock: boolean;

  createdAt: string;
  updatedAt: string;
}

export interface AffiliateCommissionLog {
  id: string;
  affiliatorId: string;  // userId of the affiliator
  programId: string;     // AffiliatorProgram.id
  inviteeId: string;
  orderId: string;

  orderAmount: number;
  lossAmount: number;            // = orderAmount (full stake lost)
  commissionPercentage: number;  // revenueSharePercentage at time of event
  commissionAmount: number;      // = lossAmount * commissionPercentage / 100

  createdAt: string;
}

export interface AffiliateCommissionWithdrawal {
  id: string;
  affiliatorId: string;  // userId of the affiliator
  programId: string;     // AffiliatorProgram.id
  amount: number;        // Jumlah yang ingin ditarik
  status: 'pending' | 'approved' | 'rejected' | 'completed';

  // Snapshot info affiliator saat request dibuat
  userEmail: string;
  bankAccount: {
    bankName: string;
    accountNumber: string;
    accountHolderName: string;
  };

  // Snapshot saldo komisi saat request dibuat (untuk audit trail)
  commissionBalanceAtRequest: number;

  // Catatan opsional dari affiliator
  note?: string;

  // Review oleh admin
  reviewedBy?: string;
  reviewedAt?: string;
  adminNotes?: string;
  rejectionReason?: string;

  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────

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
  metadata?: {
    isEndOfCandleEntry: boolean;
    remainingSecondsInMinute: number;
    originalDuration: number;
    adjustedDuration: number;
    timezone: string;
  };
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

export interface Voucher {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minDeposit: number;
  eligibleStatuses: string[];
  maxUses?: number;
  usedCount: number;
  maxUsesPerUser: number;
  maxBonusAmount?: number;
  isActive: boolean;
  validFrom: string;
  validUntil: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VoucherUsage {
  id: string;
  voucherId: string;
  voucherCode: string;
  userId: string;
  userEmail: string;
  depositId: string;
  depositAmount: number;
  bonusAmount: number;
  usedAt: string;
}

export enum InformationType {
  ANNOUNCEMENT = 'announcement',
  PROMOTION = 'promotion',
  NEWS = 'news',
  MAINTENANCE = 'maintenance',
  UPDATE = 'update',
  WARNING = 'warning',
}

export enum InformationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export interface Information {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  type: InformationType;
  priority: InformationPriority;

  // Display settings
  imageUrl?: string;
  linkUrl?: string;
  linkText?: string;

  // Scheduling
  startDate?: string;
  endDate?: string;
  publishDate?: string;

  // Status
  isActive: boolean;
  isPinned: boolean;

  // Targeting
  targetUserStatus?: ('standard' | 'gold' | 'vip')[];
  targetUserRoles?: ('user' | 'admin' | 'super_admin')[];

  // Metadata
  createdBy: string;
  createdByEmail?: string;
  updatedBy?: string;
  updatedByEmail?: string;
  createdAt: string;
  updatedAt?: string;

  // Analytics
  viewCount?: number;
  clickCount?: number;
}