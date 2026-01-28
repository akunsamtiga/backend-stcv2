import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { BinanceService } from './services/binance.service';
import { CryptoPriceSchedulerService } from './services/crypto-price-scheduler.service';
import { SimulatorPriceRelayService } from './services/simulator-price-relay.service';
import { InitializeAssetCandlesHelper } from './helpers/initialize-asset-candles.helper';
import { AuthModule } from '../auth/auth.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { EventEmitterModule } from '@nestjs/event-emitter'; // PASTIKAN INI ADA

@Module({
  imports: [
    EventEmitterModule.forRoot(),
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
    SimulatorPriceRelayService,
    InitializeAssetCandlesHelper,
  ],
  exports: [
    AssetsService,
    PriceFetcherService,
    BinanceService,
    CryptoPriceSchedulerService,
    SimulatorPriceRelayService,
    InitializeAssetCandlesHelper,
  ],
})
export class AssetsModule {}