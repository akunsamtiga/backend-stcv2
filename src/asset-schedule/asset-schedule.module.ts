// src/asset-schedule/asset-schedule.module.ts

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssetScheduleController } from './asset-schedule.controller';
import { AssetScheduleService } from './asset-schedule.service';

@Module({
  imports: [
    ScheduleModule.forRoot(), // Enable cron jobs
    
    // ✅ PERBAIKAN: Tambahkan JwtModule untuk mendukung JwtAuthGuard
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '7d'),
        },
      }),
    }),
  ],
  controllers: [AssetScheduleController],
  providers: [AssetScheduleService],
  exports: [AssetScheduleService],
})
export class AssetScheduleModule {}