// src/config/configuration.ts

import { Logger } from '@nestjs/common';

const logger = new Logger('Configuration');

/**
 * Validate critical environment variables
 * Throws error if any required variable is missing or invalid
 */
function validateEnvironment() {
  const errors: string[] = [];

  // ============================================
  // FIREBASE CONFIGURATION (CRITICAL)
  // ============================================
  if (!process.env.FIREBASE_PROJECT_ID) {
    errors.push('FIREBASE_PROJECT_ID is required');
  }

  if (!process.env.FIREBASE_PRIVATE_KEY) {
    errors.push('FIREBASE_PRIVATE_KEY is required');
  } else if (!process.env.FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')) {
    errors.push('FIREBASE_PRIVATE_KEY appears to be invalid (missing BEGIN PRIVATE KEY)');
  }

  if (!process.env.FIREBASE_CLIENT_EMAIL) {
    errors.push('FIREBASE_CLIENT_EMAIL is required');
  } else if (!process.env.FIREBASE_CLIENT_EMAIL.includes('@')) {
    errors.push('FIREBASE_CLIENT_EMAIL appears to be invalid (missing @)');
  }

  if (!process.env.FIREBASE_REALTIME_DB_URL) {
    errors.push('FIREBASE_REALTIME_DB_URL is required');
  } else if (!process.env.FIREBASE_REALTIME_DB_URL.startsWith('https://')) {
    errors.push('FIREBASE_REALTIME_DB_URL must start with https://');
  }

  // ============================================
  // JWT CONFIGURATION (CRITICAL)
  // ============================================
  if (!process.env.JWT_SECRET) {
    errors.push('JWT_SECRET is required');
  } else if (process.env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long for security');
  }

  // ============================================
  // SUPER ADMIN CONFIGURATION (CRITICAL)
  // ============================================
  if (!process.env.SUPER_ADMIN_EMAIL) {
    errors.push('SUPER_ADMIN_EMAIL is required');
  } else if (!process.env.SUPER_ADMIN_EMAIL.includes('@')) {
    errors.push('SUPER_ADMIN_EMAIL appears to be invalid');
  }

  if (!process.env.SUPER_ADMIN_PASSWORD) {
    errors.push('SUPER_ADMIN_PASSWORD is required');
  } else if (process.env.SUPER_ADMIN_PASSWORD.length < 8) {
    errors.push('SUPER_ADMIN_PASSWORD must be at least 8 characters long');
  }

  // ============================================
  // VALIDATE NODE_ENV
  // ============================================
  const validEnvs = ['development', 'production', 'test'];
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  if (!validEnvs.includes(nodeEnv)) {
    logger.warn(`⚠️ Invalid NODE_ENV: ${nodeEnv}. Must be one of: ${validEnvs.join(', ')}`);
  }

  // ============================================
  // VALIDATE PORT
  // ============================================
  const port = parseInt(process.env.PORT || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be a valid number between 1 and 65535 (got: ${process.env.PORT})`);
  }

  // ============================================
  // WARNINGS (non-critical)
  // ============================================
  const warnings: string[] = [];

  if (!process.env.CORS_ORIGIN) {
    warnings.push('CORS_ORIGIN not set - allowing all origins (*)');
  }

  if (!process.env.TIMEZONE) {
    warnings.push('TIMEZONE not set - defaulting to Asia/Jakarta');
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.LOG_LEVEL) {
      warnings.push('LOG_LEVEL not set - defaulting to "info"');
    }

    if (process.env.CORS_ORIGIN === '*') {
      warnings.push('⚠️ CORS allows all origins in PRODUCTION - security risk!');
    }

    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 64) {
      warnings.push('⚠️ JWT_SECRET should be at least 64 characters in PRODUCTION');
    }
  }

  // ============================================
  // THROW IF ERRORS
  // ============================================
  if (errors.length > 0) {
    logger.error('❌ ================================================');
    logger.error('❌ ENVIRONMENT VALIDATION FAILED');
    logger.error('❌ ================================================');
    errors.forEach(error => logger.error(`❌ ${error}`));
    logger.error('❌ ================================================');
    logger.error('❌ Please check your .env file and fix the errors above');
    logger.error('❌ ================================================');
    
    throw new Error(`Environment validation failed: ${errors.length} error(s) found`);
  }

  // ============================================
  // LOG WARNINGS
  // ============================================
  if (warnings.length > 0) {
    logger.warn('⚠️ ================================================');
    logger.warn('⚠️ ENVIRONMENT WARNINGS');
    logger.warn('⚠️ ================================================');
    warnings.forEach(warning => logger.warn(`⚠️ ${warning}`));
    logger.warn('⚠️ ================================================');
  }

  // ============================================
  // LOG SUCCESS
  // ============================================
  logger.log('✅ ================================================');
  logger.log('✅ ENVIRONMENT VALIDATION PASSED');
  logger.log('✅ ================================================');
  logger.log(`✅ Environment: ${nodeEnv}`);
  logger.log(`✅ Port: ${port}`);
  logger.log(`✅ Timezone: ${process.env.TIMEZONE || 'Asia/Jakarta'}`);
  logger.log(`✅ Firebase Project: ${process.env.FIREBASE_PROJECT_ID}`);
  logger.log(`✅ JWT Secret: ${process.env.JWT_SECRET ? '***configured***' : 'MISSING'}`);
  logger.log(`✅ CORS Origin: ${process.env.CORS_ORIGIN || '*'}`);
  logger.log('✅ ================================================');
}

/**
 * Main configuration export
 * Validates environment and returns configuration object
 */
export default () => {
  // Validate environment before proceeding
  validateEnvironment();

  return {
    // ============================================
    // SERVER CONFIGURATION
    // ============================================
    port: parseInt(process.env.PORT || '3000', 10),
    apiPrefix: process.env.API_PREFIX || 'api',
    apiVersion: process.env.API_VERSION || 'v1',
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // ============================================
    // TIMEZONE CONFIGURATION
    // ============================================
    timezone: process.env.TIMEZONE || 'Asia/Jakarta',
    
    // ============================================
    // FIREBASE CONFIGURATION
    // ============================================
    firebase: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      realtimeDbUrl: process.env.FIREBASE_REALTIME_DB_URL,
      
      // Optional: Firestore settings
      firestoreSettings: {
        ignoreUndefinedProperties: true,
        timestampsInSnapshots: true,
        maxIdleChannels: parseInt(process.env.FIRESTORE_MAX_IDLE_CHANNELS || '5', 10),
      },
    },
    
    // ============================================
    // JWT CONFIGURATION
    // ============================================
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRATION || '7d',
      
      // Additional JWT options
      issuer: process.env.JWT_ISSUER || 'binary-trading-api',
      audience: process.env.JWT_AUDIENCE || 'binary-trading-users',
    },
    
    // ============================================
    // CORS CONFIGURATION
    // ============================================
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',').map(o => o.trim()) || '*',
      credentials: process.env.CORS_CREDENTIALS === 'true',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
      maxAge: parseInt(process.env.CORS_MAX_AGE || '86400', 10),
    },
    
    // ============================================
    // RATE LIMITING CONFIGURATION
    // ============================================
    rateLimit: {
      // Default rate limit
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
      limit: parseInt(process.env.RATE_LIMIT_LIMIT || '100', 10),
      
      // Strict rate limit (for sensitive endpoints)
      strictTtl: parseInt(process.env.RATE_LIMIT_STRICT_TTL || '60', 10),
      strictLimit: parseInt(process.env.RATE_LIMIT_STRICT_LIMIT || '10', 10),
    },
    
    // ============================================
    // LOGGING CONFIGURATION
    // ============================================
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      
      // Enable detailed logs in development
      enableDetailedLogs: process.env.NODE_ENV !== 'production',
      
      // Log to file in production
      enableFileLogging: process.env.ENABLE_FILE_LOGGING === 'true',
      logFilePath: process.env.LOG_FILE_PATH || './logs',
    },

    // ============================================
    // SUPER ADMIN CONFIGURATION
    // ============================================
    superAdmin: {
      email: process.env.SUPER_ADMIN_EMAIL,
      password: process.env.SUPER_ADMIN_PASSWORD,
    },

    // ============================================
    // PERFORMANCE TUNING
    // ============================================
    performance: {
      // Request timeout (ms)
      defaultTimeout: parseInt(process.env.REQUEST_TIMEOUT || '3000', 10),
      binaryOrderTimeout: parseInt(process.env.BINARY_ORDER_TIMEOUT || '2000', 10),
      priceTimeout: parseInt(process.env.PRICE_TIMEOUT || '1500', 10),
      healthTimeout: parseInt(process.env.HEALTH_TIMEOUT || '800', 10),
      authTimeout: parseInt(process.env.AUTH_TIMEOUT || '5000', 10),
      
      // Cache settings
      cacheEnabled: process.env.CACHE_ENABLED !== 'false',
      cacheTTL: parseInt(process.env.CACHE_TTL || '30000', 10),
      
      // Connection pool
      connectionPoolSize: parseInt(process.env.CONNECTION_POOL_SIZE || '3', 10),
    },

    // ============================================
    // TRADING CONFIGURATION
    // ============================================
    trading: {
      // Settlement interval (ms)
      settlementInterval: parseInt(process.env.SETTLEMENT_INTERVAL || '1000', 10),
      
      // Minimum order amounts
      minOrderAmountReal: parseInt(process.env.MIN_ORDER_AMOUNT_REAL || '1000', 10),
      minOrderAmountDemo: parseInt(process.env.MIN_ORDER_AMOUNT_DEMO || '1000', 10),
      
      // Initial balances
      initialRealBalance: parseInt(process.env.INITIAL_REAL_BALANCE || '0', 10),
      initialDemoBalance: parseInt(process.env.INITIAL_DEMO_BALANCE || '10000000', 10),
    },

    // ============================================
    // AFFILIATE CONFIGURATION
    // ============================================
    affiliate: {
      commissionStandard: parseInt(process.env.AFFILIATE_COMMISSION_STANDARD || '25000', 10),
      commissionGold: parseInt(process.env.AFFILIATE_COMMISSION_GOLD || '100000', 10),
      commissionVIP: parseInt(process.env.AFFILIATE_COMMISSION_VIP || '400000', 10),
    },

    // ============================================
    // CRYPTO CONFIGURATION (BINANCE)
    // ============================================
    crypto: {
      enabled: process.env.CRYPTO_ENABLED !== 'false',
      
      // Binance API (FREE tier)
      binanceBaseUrl: process.env.BINANCE_BASE_URL || 'https://api.binance.com/api/v3',
      binanceCacheTTL: parseInt(process.env.BINANCE_CACHE_TTL || '500', 10),
      binanceTimeout: parseInt(process.env.BINANCE_TIMEOUT || '8000', 10),
      
      // Scheduler
      schedulerInterval: parseInt(process.env.CRYPTO_SCHEDULER_INTERVAL || '1000', 10),
      schedulerEnabled: process.env.CRYPTO_SCHEDULER_ENABLED !== 'false',
    },

    // ============================================
    // HEALTH CHECK CONFIGURATION
    // ============================================
    health: {
      enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
      endpoint: process.env.HEALTH_ENDPOINT || '/health',
      
      // Thresholds
      memoryThreshold: parseFloat(process.env.MEMORY_THRESHOLD || '0.9'),
      responseTimeThreshold: parseInt(process.env.RESPONSE_TIME_THRESHOLD || '1000', 10),
    },

    // ============================================
    // SECURITY CONFIGURATION
    // ============================================
    security: {
      // Helmet options
      contentSecurityPolicy: process.env.CSP_ENABLED === 'true',
      
      // Bcrypt rounds
      bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
      
      // Password requirements
      minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH || '8', 10),
      requireUppercase: process.env.REQUIRE_UPPERCASE !== 'false',
      requireLowercase: process.env.REQUIRE_LOWERCASE !== 'false',
      requireNumbers: process.env.REQUIRE_NUMBERS !== 'false',
      requireSpecialChars: process.env.REQUIRE_SPECIAL_CHARS !== 'false',
    },

    // ============================================
    // MONITORING & ALERTING
    // ============================================
    monitoring: {
      enabled: process.env.MONITORING_ENABLED === 'true',
      
      // Alert thresholds
      alertOnHighMemory: process.env.ALERT_HIGH_MEMORY === 'true',
      alertOnSlowResponse: process.env.ALERT_SLOW_RESPONSE === 'true',
      alertOnHighErrorRate: process.env.ALERT_HIGH_ERROR_RATE === 'true',
      
      // Notification endpoints
      slackWebhook: process.env.SLACK_WEBHOOK_URL,
      emailAlerts: process.env.ALERT_EMAIL,
    },

    // ============================================
    // FEATURE FLAGS
    // ============================================
    features: {
      enableGoogleSignIn: process.env.ENABLE_GOOGLE_SIGNIN !== 'false',
      enableAffiliateSystem: process.env.ENABLE_AFFILIATE !== 'false',
      enableCryptoTrading: process.env.ENABLE_CRYPTO !== 'false',
      enableDemoAccount: process.env.ENABLE_DEMO !== 'false',
      enableProfileUpload: process.env.ENABLE_PROFILE_UPLOAD !== 'false',
    },
  };
};