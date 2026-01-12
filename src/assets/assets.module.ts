// src/assets/assets.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { CryptoCompareService } from './services/cryptocompare.service';
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
    CryptoCompareService,
    CryptoPriceSchedulerService, // ✅ Already included
  ],
  exports: [
    AssetsService, 
    PriceFetcherService,
    CryptoCompareService,
    CryptoPriceSchedulerService,
  ],
})
export class AssetsModule {}