// src/information/information.module.ts

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { InformationService } from './information.service';
import { InformationAdminController } from './information-admin.controller';
import { InformationUserController } from './information-user.controller';
import { AuthModule } from '../auth/auth.module';

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
    MulterModule.register({
      // ✅ NO LIMITS - Lebih fleksibel, tidak ada pembatasan ukuran file
    }),
  ],
  controllers: [InformationAdminController, InformationUserController],
  providers: [InformationService],
  exports: [InformationService],
})
export class InformationModule {}