// src/ctc/ctc.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CtcController } from './ctc.controller';
import { CtcService } from './ctc.service';
import { CtcExecutorService } from './ctc-executor.service';
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
  controllers: [CtcController],
  providers: [
    CtcService,
    CtcExecutorService,
  ],
  exports: [
    CtcService,
    CtcExecutorService,
  ],
})
export class CtcModule {}