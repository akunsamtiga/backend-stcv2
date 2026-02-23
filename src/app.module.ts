// src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { BalanceModule } from './balance/balance.module';
import { AssetsModule } from './assets/assets.module';
import { BinaryOrdersModule } from './binary-orders/binary-orders.module';
import { AdminModule } from './admin/admin.module';
import { FirebaseModule } from './firebase/firebase.module';
import { WebSocketModule } from './websocket/websocket.module';
import { HealthController } from './health.controller';
import { PaymentModule } from './payment/payment.module';
import { VoucherModule } from './voucher/voucher.module';
import { AssetScheduleModule } from './asset-schedule/asset-schedule.module';
import { OrderScheduleModule } from './order-schedule/order-schedule.module';
import { InformationModule } from './information/information.module';
import { AutoLoseSystemModule } from './auto-lose-system/auto-lose-system.module';
import { AffiliateProgramModule } from './affiliate-program/affiliate-program.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 100,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
    FirebaseModule,
    AuthModule,
    UserModule,
    BalanceModule,
    AssetsModule,
    AssetScheduleModule,
    OrderScheduleModule,
    BinaryOrdersModule,
    AdminModule,
    WebSocketModule,
    PaymentModule,
    VoucherModule,
    InformationModule,
    AutoLoseSystemModule,
    AffiliateProgramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}