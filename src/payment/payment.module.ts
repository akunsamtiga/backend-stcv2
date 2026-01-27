//src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { BalanceModule } from '../balance/balance.module';
import { UserModule } from '../user/user.module';
import { VoucherModule } from '../voucher/voucher.module';
import { AuthModule } from '../auth/auth.module'; // ✅ TAMBAHKAN INI

@Module({
  imports: [
    FirebaseModule,
    BalanceModule,
    UserModule,
    VoucherModule,
    AuthModule, // ✅ TAMBAHKAN INI - untuk JwtAuthGuard di PaymentController
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}