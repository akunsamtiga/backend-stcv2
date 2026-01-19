import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { BinanceService } from './services/binance.service';  
import { CryptoPriceSchedulerService } from './services/crypto-price-scheduler.service';
import { AuthModule } from '../auth/auth.module';
import { WebSocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => WebSocketModule),
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
    BinanceService,  
    CryptoPriceSchedulerService,
  ],
  exports: [
    AssetsService, 
    PriceFetcherService,
    BinanceService,  
    CryptoPriceSchedulerService,
  ],
})
export class AssetsModule {}