// src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter'; // ✅ FIX: import EventEmitterModule
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { BalanceModule } from '../balance/balance.module';
import { UserModule } from '../user/user.module';
import { VoucherModule } from '../voucher/voucher.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    FirebaseModule,
    BalanceModule,
    UserModule,
    VoucherModule,
    AuthModule,
    // ✅ FIX: EventEmitterModule sudah di-register secara global di AppModule,
    // tapi EventEmitter2 perlu tersedia di sini agar bisa di-inject ke PaymentService.
    // Karena EventEmitterModule.forRoot() bersifat global, EventEmitter2 sudah
    // tersedia secara otomatis — tidak perlu import ulang di sini.
    // Baris di bawah HANYA diperlukan jika EventEmitterModule belum global di AppModule:
    // EventEmitterModule.forRoot(),
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}