// src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { BalanceModule } from '../balance/balance.module';
import { UserModule } from '../user/user.module';
import { VoucherModule } from '../voucher/voucher.module';

@Module({
  imports: [
    FirebaseModule,
    BalanceModule,
    UserModule,
    VoucherModule, 
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}