// src/voucher/voucher.module.ts
import { Module } from '@nestjs/common';
import { VoucherController } from './voucher.controller';
import { VoucherService } from './voucher.service';
import { AuthModule } from '../auth/auth.module';
import { FirebaseModule } from '../firebase/firebase.module'; // ✅ ADDED

@Module({
  imports: [
    AuthModule,
    FirebaseModule, // ✅ ADDED - Required for VoucherService
  ],
  controllers: [VoucherController],
  providers: [VoucherService],
  exports: [VoucherService],
})
export class VoucherModule {}