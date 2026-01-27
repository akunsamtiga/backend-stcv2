// src/voucher/voucher.module.ts
// ✅ CORRECT MODULE - Note the singular naming

import { Module } from '@nestjs/common';
import { VoucherController } from './voucher.controller';
import { VoucherService } from './voucher.service';

@Module({
  controllers: [VoucherController],
  providers: [VoucherService],
  exports: [VoucherService], // Export for use in PaymentModule or other modules
})
export class VoucherModule {}