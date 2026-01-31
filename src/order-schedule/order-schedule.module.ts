// src/order-schedule/order-schedule.module.ts

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OrderScheduleService } from './order-schedule.service';
import { OrderScheduleExecutorService } from './order-schedule-executor.service';
import { OrderScheduleController } from './order-schedule.controller';
import { FirebaseModule } from '../firebase/firebase.module'; // ✅ TAMBAHKAN INI

@Module({
  imports: [
    ScheduleModule.forRoot(), // Enable cron jobs
    FirebaseModule,           // ✅ TAMBAHKAN INI - PENTING!
  ],
  controllers: [OrderScheduleController],
  providers: [
    OrderScheduleService,
    OrderScheduleExecutorService,
  ],
  exports: [OrderScheduleService, OrderScheduleExecutorService],
})
export class OrderScheduleModule {}