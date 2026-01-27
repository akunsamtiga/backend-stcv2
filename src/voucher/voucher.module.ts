// src/voucher/voucher.module.ts
import { Module } from '@nestjs/common';
import { VoucherController } from './voucher.controller';
import { VoucherService } from './voucher.service';

@Module({
  controllers: [VoucherController],
  providers: [VoucherService],
  exports: [VoucherService], // ✅ PENTING: Export VoucherService
})
export class VoucherModule {}