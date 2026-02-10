// src/information/dto/update-information.dto.ts

import { IsString, IsEnum, IsOptional, IsBoolean, IsArray, IsUrl, MinLength, MaxLength, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InformationType, InformationPriority } from './create-information.dto';

export class UpdateInformationDto {
  @ApiPropertyOptional({ 
    example: 'Welcome Bonus 100%!',
    description: 'Judul informasi',
    minLength: 3,
    maxLength: 200
  })
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Judul minimal 3 karakter' })
  @MaxLength(200, { message: 'Judul maksimal 200 karakter' })
  title?: string;

  @ApiPropertyOptional({ 
    example: 'Dapatkan bonus deposit hingga 100%',
    description: 'Sub judul informasi',
    maxLength: 300
  })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Sub judul maksimal 300 karakter' })
  subtitle?: string;

  @ApiPropertyOptional({ 
    example: 'Promosi spesial untuk member baru. Deposit pertama mendapat bonus 100%.',
    description: 'Deskripsi informasi',
    minLength: 10
  })
  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Deskripsi minimal 10 karakter' })
  description?: string;

  @ApiPropertyOptional({ 
    enum: InformationType,
    example: InformationType.PROMOTION,
    description: 'Tipe informasi'
  })
  @IsOptional()
  @IsEnum(InformationType, { message: 'Tipe informasi tidak valid' })
  type?: InformationType;

  @ApiPropertyOptional({ 
    enum: InformationPriority,
    example: InformationPriority.HIGH,
    description: 'Prioritas informasi'
  })
  @IsOptional()
  @IsEnum(InformationPriority, { message: 'Prioritas tidak valid' })
  priority?: InformationPriority;

  @ApiPropertyOptional({ 
    example: 'https://storage.googleapis.com/bucket/information/image.jpg',
    description: 'URL gambar banner'
  })
  @IsOptional()
  @IsUrl({}, { message: 'Format URL gambar tidak valid' })
  imageUrl?: string;

  @ApiPropertyOptional({ 
    example: 'information/1234567890_abc123.jpg',
    description: 'Storage path gambar'
  })
  @IsOptional()
  @IsString()
  imagePath?: string;

  @ApiPropertyOptional({ 
    example: 524288,
    description: 'Ukuran file gambar dalam bytes'
  })
  @IsOptional()
  @IsNumber()
  imageSize?: number;

  @ApiPropertyOptional({ 
    example: 'https://example.com/promo-details',
    description: 'URL link untuk detail'
  })
  @IsOptional()
  @IsUrl({}, { message: 'Format URL link tidak valid' })
  linkUrl?: string;

  @ApiPropertyOptional({ 
    example: 'Lihat Detail Promo',
    description: 'Text untuk link button'
  })
  @IsOptional()
  @IsString()
  linkText?: string;

  @ApiPropertyOptional({ 
    example: '2026-02-10T00:00:00Z',
    description: 'Tanggal mulai tampil (ISO 8601)'
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ 
    example: '2026-03-10T23:59:59Z',
    description: 'Tanggal selesai tampil (ISO 8601)'
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ 
    example: '2026-02-10T08:00:00Z',
    description: 'Tanggal publikasi (ISO 8601)'
  })
  @IsOptional()
  @IsString()
  publishDate?: string;

  @ApiPropertyOptional({ 
    example: true,
    description: 'Status aktif/tidak aktif'
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ 
    example: false,
    description: 'Pin informasi di bagian atas'
  })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ 
    example: ['gold', 'vip'],
    description: 'Target user berdasarkan status',
    isArray: true,
    enum: ['standard', 'gold', 'vip']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetUserStatus?: ('standard' | 'gold' | 'vip')[];

  @ApiPropertyOptional({ 
    example: ['user'],
    description: 'Target user berdasarkan role',
    isArray: true,
    enum: ['user', 'admin', 'super_admin']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetUserRoles?: ('user' | 'admin' | 'super_admin')[];
}