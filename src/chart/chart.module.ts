// src/chart/chart.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChartController } from './chart.controller';
import { ChartService } from './chart.service';
import { ChartGateway } from './chart.gateway';
import { AssetsModule } from '../assets/assets.module';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [
    ConfigModule,
    FirebaseModule,
    forwardRef(() => AssetsModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
      }),
    }),
  ],
  controllers: [ChartController],
  providers: [ChartService, ChartGateway],
  exports: [ChartService, ChartGateway],
})
export class ChartModule {}