// src/affiliate-program/affiliate-program.module.ts

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AffiliateProgramService } from './affiliate-program.service';
import { AffiliateProgramController } from './affiliate-program.controller';
import { AffiliateProgramAdminController } from './affiliate-program-admin.controller';
import { AuthModule } from '../auth/auth.module';
import { BalanceModule } from '../balance/balance.module'; // ← BARU

@Module({
  imports: [
    AuthModule,
    BalanceModule, // ← BARU: agar BalanceService tersedia untuk di-inject
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
  controllers: [
    AffiliateProgramController,
    AffiliateProgramAdminController,
  ],
  providers: [AffiliateProgramService],
  exports: [AffiliateProgramService],
})
export class AffiliateProgramModule {}
