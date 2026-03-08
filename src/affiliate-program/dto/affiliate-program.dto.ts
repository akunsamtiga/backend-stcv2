// src/affiliate-program/dto/affiliate-program.dto.ts

import {
  IsString, IsNumber, IsOptional,
  Min, Max, IsBoolean, IsInt, Matches, Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Super Admin: assign a user as affiliator.
 *
 * ⚠️ CATATAN SISTEM KOMISI BARU:
 * Field `revenueSharePercentage` tidak lagi digunakan untuk menentukan komisi.
 * Komisi sekarang dihitung DINAMIS berdasarkan dua fase:
 *
 * FASE 1 — Affiliator Baru (< 2 bulan sejak tanggal assign):
 *   → Flat 80% dari semua loss invitee yang sudah deposit
 *
 * FASE 2 — Affiliator Lama (≥ 2 bulan):
 *   → Tier berdasarkan jumlah user AKTIF (transaksi real dalam 30 hari):
 *       0–50 aktif  → 50%
 *      51–70 aktif  → 60%
 *      71–100 aktif → 70%
 *     101+   aktif  → 80%
 */
export class AssignAffiliatorDto {
  @ApiPropertyOptional({
    example: 'JOHNDOE',
    description: `Kode affiliate kustom (opsional).
    Jika diisi: 3–20 karakter, hanya huruf/angka/tanda hubung/underscore, disimpan dalam huruf besar.
    Jika tidak diisi: kode otomatis digenerate (format: AFF + 8 karakter alfanumerik).`,
    minLength: 3,
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @Length(3, 20, { message: 'Kode kustom harus antara 3–20 karakter' })
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Kode kustom hanya boleh mengandung huruf, angka, tanda hubung, dan underscore',
  })
  customCode?: string;

  /**
   * @deprecated Tidak digunakan dalam sistem komisi dinamis.
   * Komisi ditentukan otomatis berdasarkan fase (baru/lama) dan jumlah user aktif.
   * Field ini disimpan sebagai snapshot tapi tidak mempengaruhi perhitungan komisi.
   */
  @ApiPropertyOptional({
    example: 80,
    description: `[DEPRECATED — TIDAK DIGUNAKAN] Persentase revenue share.
    Sistem komisi sekarang bersifat dinamis:
    - 2 bulan pertama: 80% flat
    - Setelah 2 bulan: 50–80% berdasarkan jumlah user aktif per bulan`,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  revenueSharePercentage?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Jumlah undangan yang harus deposit untuk membuka akses penarikan komisi (default: 5)',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  unlockThreshold?: number = 5;

  @ApiPropertyOptional({
    example: 500000,
    description: `Saldo awal akun REAL yang langsung ditambahkan saat assign affiliator (opsional).
    Jika diisi, sistem akan membuat entri balance dengan type 'deposit' di akun real user.
    Minimal: Rp 1. Jika tidak diisi atau 0, tidak ada saldo yang ditambahkan.`,
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  initialRealBalance?: number;
}

/** Super Admin: update affiliator program config */
export class UpdateAffiliatorConfigDto {
  /**
   * @deprecated Tidak digunakan dalam sistem komisi dinamis.
   * Hanya untuk override manual jika diperlukan oleh admin.
   */
  @ApiPropertyOptional({
    example: 50,
    description: `[DEPRECATED] Persentase revenue share (1-100). 
    Dalam sistem dinamis, komisi dihitung otomatis — field ini hanya untuk override manual.`,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  revenueSharePercentage?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Jumlah undangan yang harus deposit untuk membuka akses penarikan komisi',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  unlockThreshold?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Aktifkan atau nonaktifkan program affiliator ini',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Query parameters for listing affiliators */
export class GetAffiliatorsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter program aktif/tidak aktif' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}