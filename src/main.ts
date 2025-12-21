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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // ============================================
  // ⚡ ULTRA-FAST TIMEOUT CONFIGURATION
  // ============================================
  app.use((req: Request, res: Response, next: NextFunction) => {
    // ⚡ Aggressive timeouts for fast responses
    const path = req.path;
    
    // Different timeouts for different endpoints
    let timeout = 5000; // Default 5s
    
    if (path.includes('/binary-orders')) {
      timeout = 3000; // 3s for order operations (must be fast!)
    } else if (path.includes('/price')) {
      timeout = 2000; // 2s for price requests
    } else if (path.includes('/health')) {
      timeout = 1000; // 1s for health checks
    }
    
    req.setTimeout(timeout);
    res.setTimeout(timeout);
    
    // ⚡ Timeout handler
    req.on('timeout', () => {
      logger.warn(`⚠️ Request timeout (${timeout}ms): ${req.method} ${req.url}`);
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: 'Request timeout',
          timeout: `${timeout}ms`,
          statusCode: 408,
          timestamp: new Date().toISOString(),
          path: req.url,
        });
      }
    });
    
    next();
  });

  // ⚡ Keep-alive optimization
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=20, max=100');
    next();
  });

  // ⚡ Early response for preflight
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
    contentSecurityPolicy: false, // Disable for API
  }));

  app.use(compression({
    level: 6, // Balanced compression
    threshold: 1024, // Only compress > 1KB
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
      // ⚡ Disable detailed errors in production for speed
      disableErrorMessages: configService.get('nodeEnv') === 'production',
    }),
  );

  // ============================================
  // INTERCEPTORS & FILTERS
  // ============================================
  app.useGlobalInterceptors(new LoggingInterceptor());
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
    allowedHeaders: ['Content-Type', 'Authorization'],
    // ⚡ Cache preflight for 24 hours
    maxAge: 86400,
  });

  // ============================================
  // API PREFIX
  // ============================================
  const apiPrefix = configService.get('apiPrefix');
  const apiVersion = configService.get('apiVersion');
  app.setGlobalPrefix(`${apiPrefix}/${apiVersion}`);

  // ============================================
  // SWAGGER DOCUMENTATION
  // ============================================
  if (configService.get('nodeEnv') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Binary Option Trading API')
      .setDescription('⚡ Ultra-Fast Binary Option Trading System')
      .setVersion('3.1')
      .addBearerAuth()
      .addTag('auth', 'Authentication')
      .addTag('user', 'User management')
      .addTag('balance', 'Balance operations')
      .addTag('assets', 'Trading assets')
      .addTag('binary-orders', 'Binary option orders (Ultra-Fast)')
      .addTag('admin', 'Admin management')
      .addTag('health', 'Health & Performance')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'Binary Trading API',
      customCss: '.swagger-ui .topbar { display: none }',
    });
  }

  // ============================================
  // START SERVER
  // ============================================
  const port = configService.get('port');
  
  await app.listen(port, '0.0.0.0', () => {
    logger.log('');
    logger.log('⚡ ================================================');
    logger.log('⚡ BINARY OPTION TRADING - ULTRA-FAST MODE');
    logger.log('⚡ ================================================');
    logger.log(`⚡ Environment: ${configService.get('nodeEnv')}`);
    logger.log(`⚡ URL: http://localhost:${port}`);
    logger.log(`⚡ API: http://localhost:${port}/${apiPrefix}/${apiVersion}`);
    logger.log(`⚡ Docs: http://localhost:${port}/api/docs`);
    logger.log(`⚡ Health: http://localhost:${port}/${apiPrefix}/${apiVersion}/health`);
    logger.log('⚡ ================================================');
    logger.log('⚡ PERFORMANCE OPTIMIZATIONS:');
    logger.log('⚡   • Order Creation: < 500ms target');
    logger.log('⚡   • Price Fetch: < 200ms target');
    logger.log('⚡   • Settlement: Every 3 seconds');
    logger.log('⚡   • Multi-layer caching enabled');
    logger.log('⚡   • Connection pooling active');
    logger.log('⚡   • Keep-alive connections');
    logger.log('⚡ ================================================');
    logger.log('⚡ TIMEOUTS:');
    logger.log('⚡   • Binary Orders: 3s');
    logger.log('⚡   • Price Requests: 2s');
    logger.log('⚡   • Health Check: 1s');
    logger.log('⚡   • Others: 5s');
    logger.log('⚡ ================================================');
    logger.log('');
  });
}

bootstrap().catch(err => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application', err);
  process.exit(1);
});