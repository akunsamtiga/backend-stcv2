// src/order-schedule/order-schedule.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OrderScheduleService } from './order-schedule.service';
import { OrderScheduleExecutorService } from './order-schedule-executor.service';
import { OrderScheduleController } from './order-schedule.controller';
import { FirebaseModule } from '../firebase/firebase.module';
import { AuthModule } from '../auth/auth.module';
import { AssetsModule } from '../assets/assets.module';
import { BalanceModule } from '../balance/balance.module'; // ✅ FIX: tambah BalanceModule

@Module({
  imports: [
    ScheduleModule.forRoot(),
    FirebaseModule,
    AuthModule,
    forwardRef(() => AssetsModule),
    BalanceModule, 
  ],
  controllers: [OrderScheduleController],
  providers: [
    OrderScheduleService,
    OrderScheduleExecutorService,
  ],
  exports: [OrderScheduleService, OrderScheduleExecutorService],
})
export class OrderScheduleModule {}