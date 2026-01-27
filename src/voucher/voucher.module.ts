import { Module } from '@nestjs/common';
import { VoucherController } from './voucher.controller';
import { VoucherService } from './voucher.service';
import { AuthModule } from '../auth/auth.module'; // ✅ TAMBAHKAN INI

@Module({
  imports: [AuthModule], // ✅ TAMBAHKAN INI - untuk JwtAuthGuard
  controllers: [VoucherController],
  providers: [VoucherService],
  exports: [VoucherService],
})
export class VoucherModule {}