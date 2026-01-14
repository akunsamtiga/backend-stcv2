// src/config/validation.schema.ts

import * as Joi from 'joi';

/**
 * Comprehensive environment variable validation schema
 * Uses Joi for robust validation with detailed error messages
 */
export const validationSchema = Joi.object({
  // ============================================
  // SERVER CONFIGURATION
  // ============================================
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development')
    .description('Application environment'),

  PORT: Joi.number()
    .port()
    .default(3000)
    .description('Server port'),

  API_PREFIX: Joi.string()
    .default('api')
    .description('API prefix'),

  API_VERSION: Joi.string()
    .default('v1')
    .description('API version'),

  // ============================================
  // TIMEZONE CONFIGURATION
  // ============================================
  TZ: Joi.string()
    .default('Asia/Jakarta')
    .description('System timezone'),

  TIMEZONE: Joi.string()
    .default('Asia/Jakarta')
    .description('Application timezone'),

  // ============================================
  // FIREBASE CONFIGURATION (REQUIRED)
  // ============================================
  FIREBASE_PROJECT_ID: Joi.string()
    .required()
    .description('Firebase project ID'),

  FIREBASE_PRIVATE_KEY: Joi.string()
    .required()
    .custom((value, helpers) => {
      if (!value.includes('BEGIN PRIVATE KEY')) {
        return helpers.error('any.invalid', {
          message: 'Firebase private key must be a valid PEM format'
        });
      }
      return value;
    })
    .description('Firebase service account private key'),

  FIREBASE_CLIENT_EMAIL: Joi.string()
    .email()
    .required()
    .description('Firebase service account email'),

  FIREBASE_REALTIME_DB_URL: Joi.string()
    .uri()
    .required()
    .custom((value, helpers) => {
      if (!value.startsWith('https://')) {
        return helpers.error('any.invalid', {
          message: 'Realtime DB URL must start with https://'
        });
      }
      return value;
    })
    .description('Firebase Realtime Database URL'),

  FIRESTORE_MAX_IDLE_CHANNELS: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(5)
    .description('Maximum idle Firestore channels'),

  // ============================================
  // JWT CONFIGURATION (REQUIRED)
  // ============================================
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .custom((value, helpers) => {
      if (process.env.NODE_ENV === 'production' && value.length < 64) {
        return helpers.warn('jwt.secret.short', {
          message: 'JWT secret should be at least 64 characters in production'
        });
      }
      return value;
    })
    .description('JWT secret key (min 32 chars, 64+ recommended for production)'),

  JWT_EXPIRATION: Joi.string()
    .default('7d')
    .description('JWT expiration time'),

  JWT_ISSUER: Joi.string()
    .default('binary-trading-api')
    .description('JWT issuer'),

  JWT_AUDIENCE: Joi.string()
    .default('binary-trading-users')
    .description('JWT audience'),

  // ============================================
  // CORS CONFIGURATION
  // ============================================
  CORS_ORIGIN: Joi.string()
    .default('*')
    .custom((value, helpers) => {
      if (process.env.NODE_ENV === 'production' && value === '*') {
        return helpers.warn('cors.origin.wildcard', {
          message: 'CORS wildcard (*) is not recommended in production'
        });
      }
      return value;
    })
    .description('CORS allowed origins (comma-separated)'),

  CORS_CREDENTIALS: Joi.boolean()
    .default(true)
    .description('CORS credentials'),

  CORS_MAX_AGE: Joi.number()
    .integer()
    .min(0)
    .default(86400)
    .description('CORS max age (seconds)'),

  // ============================================
  // RATE LIMITING
  // ============================================
  RATE_LIMIT_TTL: Joi.number()
    .integer()
    .min(1)
    .default(60)
    .description('Rate limit window (seconds)'),

  RATE_LIMIT_LIMIT: Joi.number()
    .integer()
    .min(1)
    .default(100)
    .description('Rate limit max requests'),

  RATE_LIMIT_STRICT_TTL: Joi.number()
    .integer()
    .min(1)
    .default(60)
    .description('Strict rate limit window (seconds)'),

  RATE_LIMIT_STRICT_LIMIT: Joi.number()
    .integer()
    .min(1)
    .default(10)
    .description('Strict rate limit max requests'),

  // ============================================
  // LOGGING CONFIGURATION
  // ============================================
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info')
    .description('Logging level'),

  ENABLE_FILE_LOGGING: Joi.boolean()
    .default(false)
    .description('Enable file logging'),

  LOG_FILE_PATH: Joi.string()
    .default('./logs')
    .description('Log file path'),

  // ============================================
  // SUPER ADMIN CONFIGURATION (REQUIRED)
  // ============================================
  SUPER_ADMIN_EMAIL: Joi.string()
    .email()
    .required()
    .description('Super admin email'),

  SUPER_ADMIN_PASSWORD: Joi.string()
    .min(8)
    .required()
    .custom((value, helpers) => {
      // Check password strength
      const hasUppercase = /[A-Z]/.test(value);
      const hasLowercase = /[a-z]/.test(value);
      const hasNumber = /\d/.test(value);
      const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(value);

      if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
        return helpers.error('any.invalid', {
          message: 'Super admin password must contain uppercase, lowercase, number, and special character'
        });
      }

      return value;
    })
    .description('Super admin password (min 8 chars with complexity)'),

  // ============================================
  // PERFORMANCE TUNING
  // ============================================
  REQUEST_TIMEOUT: Joi.number()
    .integer()
    .min(100)
    .max(60000)
    .default(3000)
    .description('Default request timeout (ms)'),

  BINARY_ORDER_TIMEOUT: Joi.number()
    .integer()
    .min(100)
    .max(10000)
    .default(2000)
    .description('Binary order timeout (ms)'),

  PRICE_TIMEOUT: Joi.number()
    .integer()
    .min(100)
    .max(5000)
    .default(1500)
    .description('Price fetch timeout (ms)'),

  HEALTH_TIMEOUT: Joi.number()
    .integer()
    .min(100)
    .max(2000)
    .default(800)
    .description('Health check timeout (ms)'),

  AUTH_TIMEOUT: Joi.number()
    .integer()
    .min(100)
    .max(30000)
    .default(5000)
    .description('Auth timeout (ms)'),

  CACHE_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable caching'),

  CACHE_TTL: Joi.number()
    .integer()
    .min(1000)
    .max(300000)
    .default(30000)
    .description('Cache TTL (ms)'),

  CONNECTION_POOL_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(3)
    .description('Connection pool size'),

  // ============================================
  // TRADING CONFIGURATION
  // ============================================
  SETTLEMENT_INTERVAL: Joi.number()
    .integer()
    .min(1000)
    .max(10000)
    .default(1000)
    .description('Settlement check interval (ms)'),

  MIN_ORDER_AMOUNT_REAL: Joi.number()
    .integer()
    .min(100)
    .default(1000)
    .description('Minimum real order amount'),

  MIN_ORDER_AMOUNT_DEMO: Joi.number()
    .integer()
    .min(100)
    .default(1000)
    .description('Minimum demo order amount'),

  INITIAL_REAL_BALANCE: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .description('Initial real balance'),

  INITIAL_DEMO_BALANCE: Joi.number()
    .integer()
    .min(0)
    .default(10000000)
    .description('Initial demo balance'),

  // ============================================
  // AFFILIATE CONFIGURATION
  // ============================================
  AFFILIATE_COMMISSION_STANDARD: Joi.number()
    .integer()
    .min(0)
    .default(25000)
    .description('Standard tier commission'),

  AFFILIATE_COMMISSION_GOLD: Joi.number()
    .integer()
    .min(0)
    .default(100000)
    .description('Gold tier commission'),

  AFFILIATE_COMMISSION_VIP: Joi.number()
    .integer()
    .min(0)
    .default(400000)
    .description('VIP tier commission'),

  // ============================================
  // CRYPTO CONFIGURATION
  // ============================================
  CRYPTO_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable crypto trading'),

  BINANCE_BASE_URL: Joi.string()
    .uri()
    .default('https://api.binance.com/api/v3')
    .description('Binance API URL'),

  BINANCE_CACHE_TTL: Joi.number()
    .integer()
    .min(100)
    .max(10000)
    .default(500)
    .description('Binance cache TTL (ms)'),

  BINANCE_TIMEOUT: Joi.number()
    .integer()
    .min(1000)
    .max(30000)
    .default(8000)
    .description('Binance API timeout (ms)'),

  CRYPTO_SCHEDULER_INTERVAL: Joi.number()
    .integer()
    .min(1000)
    .max(60000)
    .default(1000)
    .description('Crypto scheduler interval (ms)'),

  CRYPTO_SCHEDULER_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable crypto scheduler'),

  // ============================================
  // HEALTH CHECK CONFIGURATION
  // ============================================
  HEALTH_CHECK_ENABLED: Joi.boolean()
    .default(true)
    .description('Enable health checks'),

  HEALTH_ENDPOINT: Joi.string()
    .default('/health')
    .description('Health check endpoint'),

  MEMORY_THRESHOLD: Joi.number()
    .min(0)
    .max(1)
    .default(0.9)
    .description('Memory threshold (0-1)'),

  RESPONSE_TIME_THRESHOLD: Joi.number()
    .integer()
    .min(100)
    .default(1000)
    .description('Response time threshold (ms)'),

  // ============================================
  // SECURITY CONFIGURATION
  // ============================================
  CSP_ENABLED: Joi.boolean()
    .default(false)
    .description('Enable Content Security Policy'),

  BCRYPT_ROUNDS: Joi.number()
    .integer()
    .min(8)
    .max(15)
    .default(10)
    .description('Bcrypt hash rounds'),

  MIN_PASSWORD_LENGTH: Joi.number()
    .integer()
    .min(6)
    .max(128)
    .default(8)
    .description('Minimum password length'),

  REQUIRE_UPPERCASE: Joi.boolean()
    .default(true)
    .description('Require uppercase in password'),

  REQUIRE_LOWERCASE: Joi.boolean()
    .default(true)
    .description('Require lowercase in password'),

  REQUIRE_NUMBERS: Joi.boolean()
    .default(true)
    .description('Require numbers in password'),

  REQUIRE_SPECIAL_CHARS: Joi.boolean()
    .default(true)
    .description('Require special characters in password'),

  // ============================================
  // MONITORING & ALERTING
  // ============================================
  MONITORING_ENABLED: Joi.boolean()
    .default(false)
    .description('Enable monitoring'),

  ALERT_HIGH_MEMORY: Joi.boolean()
    .default(false)
    .description('Alert on high memory'),

  ALERT_SLOW_RESPONSE: Joi.boolean()
    .default(false)
    .description('Alert on slow response'),

  ALERT_HIGH_ERROR_RATE: Joi.boolean()
    .default(false)
    .description('Alert on high error rate'),

  SLACK_WEBHOOK_URL: Joi.string()
    .uri()
    .optional()
    .description('Slack webhook for alerts'),

  ALERT_EMAIL: Joi.string()
    .email()
    .optional()
    .description('Email for alerts'),

  // ============================================
  // FEATURE FLAGS
  // ============================================
  ENABLE_GOOGLE_SIGNIN: Joi.boolean()
    .default(true)
    .description('Enable Google Sign-In'),

  ENABLE_AFFILIATE: Joi.boolean()
    .default(true)
    .description('Enable affiliate system'),

  ENABLE_CRYPTO: Joi.boolean()
    .default(true)
    .description('Enable crypto trading'),

  ENABLE_DEMO: Joi.boolean()
    .default(true)
    .description('Enable demo accounts'),

  ENABLE_PROFILE_UPLOAD: Joi.boolean()
    .default(true)
    .description('Enable profile upload'),
});