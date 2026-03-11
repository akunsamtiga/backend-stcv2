// src/affiliate-program/affiliate-program.module.ts

import { Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { AffiliateProgramService } from './affiliate-program.service';
import { AffiliateProgramController } from './affiliate-program.controller';
import { AffiliateProgramAdminController } from './affiliate-program-admin.controller';
import { AutotradeWhitelistController } from './autotrade-whitelist.controller';
import { AuthModule } from '../auth/auth.module';
import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [
    AuthModule,
    BalanceModule,
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
    AutotradeWhitelistController,   // ← tambahan: whitelist CRUD untuk affiliator
  ],
  providers: [AffiliateProgramService],
  exports: [AffiliateProgramService],
})
export class AffiliateProgramModule implements OnModuleInit {
  constructor(
    private moduleRef: ModuleRef,
    private affiliateProgramService: AffiliateProgramService,
  ) {}

  async onModuleInit() {
    setTimeout(async () => {
      // ── Inject AffiliateProgramService ke AuthService (lazy, hindari circular dep) ──
      try {
        const { AuthService } = await import('../auth/auth.service');
        const authService = this.moduleRef.get(AuthService, { strict: false });
        if (authService) {
          authService.affiliateProgramService = this.affiliateProgramService;
        }
      } catch (error) {
        // Ignore if not available
      }

      // ── Inject AffiliateProgramService ke GoogleAuthService ──
      try {
        const { GoogleAuthService } = await import('../auth/auth.service.google');
        const googleAuthService = this.moduleRef.get(GoogleAuthService, { strict: false });
        if (googleAuthService) {
          googleAuthService.affiliateProgramService = this.affiliateProgramService;
        }
      } catch (error) {
        // Ignore if not available
      }

      // ── Inject UserStatusService untuk auto-update status setelah saldo awal ──
      try {
        const { UserStatusService } = await import('../user/user-status.service');
        const userStatusService = this.moduleRef.get(UserStatusService, { strict: false });
        if (userStatusService) {
          this.affiliateProgramService.setUserStatusService(userStatusService);
        }
      } catch (error) {
        // Ignore if not available
      }
    }, 500);
  }
}