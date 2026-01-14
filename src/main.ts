// src/main.ts

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TimezoneUtil } from './common/utils';

// ✅ CRITICAL: Set timezone globally BEFORE anything else
process.env.TZ = 'Asia/Jakarta';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    bufferLogs: true,
    abortOnError: false,
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // ✅ Log timezone configuration
  const timezone = configService.get('timezone') || 'Asia/Jakarta';
  logger.log('');
  logger.log('🌍 ================================================');
  logger.log('🌍 TIMEZONE CONFIGURATION');
  logger.log('🌍 ================================================');
  logger.log(`🌍 Configured Timezone: ${timezone}`);
  logger.log(`🌍 Process TZ: ${process.env.TZ}`);
  logger.log(`🌍 Current Time (WIB): ${TimezoneUtil.formatDateTime()}`);
  logger.log(`🌍 Current Time (ISO): ${TimezoneUtil.toISOString()}`);
  logger.log(`🌍 Unix Timestamp: ${TimezoneUtil.getCurrentTimestamp()}`);
  logger.log('🌍 ================================================');
  logger.log('');

  // ============================================
  // TIMEOUT CONFIGURATION
  // ============================================
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    
    let timeout = 3000;
    
    if (path.includes('/binary-orders')) {
      timeout = 2000;
    } else if (path.includes('/price')) {
      timeout = 1500;
    } else if (path.includes('/health')) {
      timeout = 800;
    } else if (path.includes('/auth/login') || path.includes('/auth/register')) {
      timeout = 5000;
    }
    
    req.setTimeout(timeout);
    res.setTimeout(timeout);
    
    req.on('timeout', () => {
      logger.warn(`⚠️ Request timeout (${timeout}ms): ${req.method} ${req.url}`);
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: 'Request timeout',
          timeout: `${timeout}ms`,
          statusCode: 408,
          timestamp: TimezoneUtil.toISOString(), // ✅ Use TimezoneUtil
          timestampWIB: TimezoneUtil.formatDateTime(), // ✅ Add WIB time
          path: req.url,
        });
      }
    });
    
    next();
  });

  // Keep-alive
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=60, max=1000');
    next();
  });

  // Preflight
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });

  // ============================================
  // SECURITY & COMPRESSION
  // ============================================
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(compression({
    level: 6,
    threshold: 512,
    filter: (req, res) => {
      if (req.headers['accept'] === 'text/event-stream') {
        return false;
      }
      return compression.filter(req, res);
    },
  }));

  // ============================================
  // VALIDATION
  // ============================================
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: configService.get('nodeEnv') === 'production',
      skipMissingProperties: false,
      skipNullProperties: false,
      skipUndefinedProperties: false,
    }),
  );

  // ============================================
  // INTERCEPTORS
  // ============================================
  const nodeEnv = configService.get('nodeEnv');
  
  if (nodeEnv === 'development') {
    app.useGlobalInterceptors(new LoggingInterceptor());
  }
  
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // ============================================
  // CORS
  // ============================================
  const corsOrigin = configService.get('cors.origin');
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // ============================================
  // API PREFIX
  // ============================================
  const apiPrefix = configService.get('apiPrefix');
  const apiVersion = configService.get('apiVersion');
  app.setGlobalPrefix(`${apiPrefix}/${apiVersion}`);

  // ============================================
  // SWAGGER
  // ============================================
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Binary Option Trading API')
      .setDescription('⚡ ULTRA-FAST Binary Option Trading System with Timezone Support')
      .setVersion('3.2')
      .addBearerAuth()
      .addTag('auth', 'Authentication')
      .addTag('user', 'User management')
      .addTag('balance', 'Balance operations')
      .addTag('assets', 'Trading assets')
      .addTag('binary-orders', 'Binary option orders (ULTRA-FAST)')
      .addTag('admin', 'Admin management')
      .addTag('health', 'Health & Performance')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'Binary Trading API',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // ============================================
  // SERVER STARTUP
  // ============================================
  const port = configService.get('port');
  
  await app.listen(port, '0.0.0.0', () => {
    logger.log('');
    logger.log('⚡ ================================================');
    logger.log('⚡ BINARY OPTION TRADING - ULTRA-FAST MODE v3.2');
    logger.log('⚡ ================================================');
    logger.log(`⚡ Environment: ${configService.get('nodeEnv')}`);
    logger.log(`⚡ URL: http://localhost:${port}`);
    logger.log(`⚡ API: http://localhost:${port}/${apiPrefix}/${apiVersion}`);
    if (nodeEnv !== 'production') {
      logger.log(`⚡ Docs: http://localhost:${port}/api/docs`);
    }
    logger.log(`⚡ Health: http://localhost:${port}/${apiPrefix}/${apiVersion}/health`);
    logger.log('⚡ ================================================');
    logger.log('⚡ TIMEZONE SYNC:');
    logger.log(`⚡   • Backend: ${timezone} (WIB = UTC+7)`);
    logger.log(`⚡   • Simulator: Asia/Jakarta (WIB = UTC+7)`);
    logger.log(`⚡   • Current: ${TimezoneUtil.formatDateTime()}`);
    logger.log('⚡ ================================================');
    logger.log('⚡ PERFORMANCE OPTIMIZATIONS:');
    logger.log('⚡   • Order Creation: < 300ms target');
    logger.log('⚡   • Price Fetch: < 100ms target');
    logger.log('⚡   • Settlement: Every 2 seconds');
    logger.log('⚡   • Multi-layer caching');
    logger.log('⚡   • 15-connection pool');
    logger.log('⚡ ================================================');
    logger.log('⚡ AGGRESSIVE TIMEOUTS:');
    logger.log('⚡   • Binary Orders: 2s');
    logger.log('⚡   • Price Requests: 1.5s');
    logger.log('⚡   • Health Check: 800ms');
    logger.log('⚡   • Auth: 5s');
    logger.log('⚡ ================================================');
    logger.log('');
  });

  // ✅ GRACEFUL SHUTDOWN
  process.on('SIGTERM', async () => {
    logger.log('⚠️ SIGTERM received, shutting down gracefully...');
    await app.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.log('⚠️ SIGINT received, shutting down gracefully...');
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch(err => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application', err);
  process.exit(1);
});