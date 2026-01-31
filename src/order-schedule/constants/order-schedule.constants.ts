// src/order-schedule/constants/order-schedule.constants.ts

export const ORDER_SCHEDULE_CONSTANTS = {
  // Durasi minimum dan maksimum (dalam detik)
  MIN_DURATION: 30,
  MAX_DURATION: 3600,

  // Amount minimum (dalam IDR)
  MIN_AMOUNT: 10000,

  // Martingale limits
  MIN_MARTINGALE_STEP: 0,
  MAX_MARTINGALE_STEP: 10,
  MIN_MARTINGALE_MULTIPLIER: 1.1,
  MAX_MARTINGALE_MULTIPLIER: 5,

  // Status options
  STATUS: {
    PENDING: 'pending',
    ACTIVE: 'active',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  } as const,

  // Account types
  ACCOUNT_TYPES: {
    DEMO: 'demo',
    REAL: 'real',
  } as const,

  // Trend types
  TRENDS: {
    BUY: 'buy',
    SELL: 'sell',
  } as const,

  // Execution status
  EXECUTION_STATUS: {
    PENDING: 'pending',
    EXECUTED: 'executed',
    FAILED: 'failed',
    SKIPPED: 'skipped',
  } as const,

  // Execution results
  RESULTS: {
    WIN: 'win',
    LOSS: 'loss',
    DRAW: 'draw',
  } as const,

  // Cron schedule
  CRON_INTERVAL: '* * * * *', // Every minute

  // Profit rate default (85%)
  DEFAULT_PROFIT_RATE: 0.85,
};


