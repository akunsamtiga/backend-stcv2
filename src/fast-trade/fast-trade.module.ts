// src/fast-trade/fast-trade.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FastTradeController } from './fast-trade.controller';
import { FastTradeService } from './fast-trade.service';
import { FastTradeExecutorService } from './fast-trade-executor.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';
import { BalanceModule } from '../balance/balance.module';
import { UserModule } from '../user/user.module';
import { WebSocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    FirebaseModule,
    AuthModule,
    BalanceModule,
    UserModule,
    forwardRef(() => AssetsModule),
    forwardRef(() => WebSocketModule),
  ],
  controllers: [FastTradeController],
  providers: [
    FastTradeService,
    FastTradeExecutorService,
  ],
  exports: [
    FastTradeService,
    FastTradeExecutorService,
  ],
})
export class FastTradeModule {}