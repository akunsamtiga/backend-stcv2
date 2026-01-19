import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TradingGateway } from './trading.gateway';
import { FirebaseModule } from '../firebase/firebase.module';
import { AssetsModule } from '../assets/assets.module';
import { BinaryOrdersModule } from '../binary-orders/binary-orders.module';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
      }),
    }),
    FirebaseModule,
    AssetsModule,
    BinaryOrdersModule,
  ],
  providers: [TradingGateway],
  exports: [TradingGateway],
})
export class WebSocketModule {}