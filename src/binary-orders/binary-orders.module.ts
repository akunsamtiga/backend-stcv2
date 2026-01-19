import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BinaryOrdersController } from './binary-orders.controller';
import { BinaryOrdersService } from './binary-orders.service';
import { BalanceModule } from '../balance/balance.module';
import { AssetsModule } from '../assets/assets.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { WebSocketModule } from '../websocket/websocket.module'; // ➕ Import WebSocketModule

@Module({
  imports: [
    BalanceModule,
    forwardRef(() => AssetsModule),
    forwardRef(() => WebSocketModule), // ➕ Tambahkan ini
    AuthModule,
    UserModule,
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
  controllers: [BinaryOrdersController],
  providers: [BinaryOrdersService],
  exports: [BinaryOrdersService],
})
export class BinaryOrdersModule {}