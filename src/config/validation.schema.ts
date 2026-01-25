import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api'),
  API_VERSION: Joi.string().default('v1'),
  
  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().email().required(),
  FIREBASE_REALTIME_DB_URL: Joi.string().uri().required(),
  
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRATION: Joi.string().default('7d'),
  
  CORS_ORIGIN: Joi.string().default('*'),
  FRONTEND_URL: Joi.string().uri().required(),
  
  RATE_LIMIT_TTL: Joi.number().default(60),
  RATE_LIMIT_LIMIT: Joi.number().default(100),
  
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),

  SUPER_ADMIN_EMAIL: Joi.string().email().required(),
  SUPER_ADMIN_PASSWORD: Joi.string().min(8).required(),

  MIDTRANS_IS_PRODUCTION: Joi.boolean().default(false),
  MIDTRANS_SERVER_KEY: Joi.string().required(),
  MIDTRANS_CLIENT_KEY: Joi.string().required(),
  MIDTRANS_MERCHANT_ID: Joi.string().required(),
});