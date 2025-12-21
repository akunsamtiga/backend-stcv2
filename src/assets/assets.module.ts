import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    // Import JwtModule untuk JwtAuthGuard
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
  controllers: [AssetsController],
  providers: [AssetsService, PriceFetcherService],
  exports: [AssetsService, PriceFetcherService],
})
export class AssetsModule {}
