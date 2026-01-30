// src/asset-schedule/asset-schedule.module.ts

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AssetScheduleController } from './asset-schedule.controller';
import { AssetScheduleService } from './asset-schedule.service';

@Module({
  imports: [
    ScheduleModule.forRoot(), // Enable cron jobs
  ],
  controllers: [AssetScheduleController],
  providers: [AssetScheduleService],
  exports: [AssetScheduleService],
})
export class AssetScheduleModule {}