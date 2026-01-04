import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { AuthModule } from '../auth/auth.module';
import { ModuleRef } from '@nestjs/core';

@Module({
  imports: [
    AuthModule,
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
  controllers: [BalanceController],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule implements OnModuleInit {
  constructor(
    private moduleRef: ModuleRef,
    private balanceService: BalanceService,
  ) {}

  async onModuleInit() {
    setTimeout(async () => {
      try {
        const { UserStatusService } = await import('../user/user-status.service');
        const userStatusService = this.moduleRef.get(UserStatusService, { strict: false });
        if (userStatusService) {
          this.balanceService.setUserStatusService(userStatusService);
        }
      } catch (error) {
      }
    }, 1000);
  }
}