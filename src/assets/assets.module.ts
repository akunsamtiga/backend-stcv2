// src/assets/assets.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { BinanceService } from './services/binance.service';  // ✅ Changed from CoinGeckoService
import { CryptoPriceSchedulerService } from './services/crypto-price-scheduler.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
        signOptions: {
          expiresIn: configService.get('jwt.expiresIn'),
        },
      }),
    }),
  ],
  controllers: [AssetsController],
  providers: [
    AssetsService, 
    PriceFetcherService,
    BinanceService,  // ✅ Changed from CoinGeckoService
    CryptoPriceSchedulerService,
  ],
  exports: [
    AssetsService, 
    PriceFetcherService,
    BinanceService,  // ✅ Changed from CoinGeckoService
    CryptoPriceSchedulerService,
  ],
})
export class AssetsModule {}