// src/information/dto/create-information.dto.ts

import { IsString, IsEnum, IsOptional, IsBoolean, IsArray, IsUrl, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InformationType {
  ANNOUNCEMENT = 'announcement',
  PROMOTION = 'promotion',
  NEWS = 'news',
  MAINTENANCE = 'maintenance',
  UPDATE = 'update',
  WARNING = 'warning',
}

export enum InformationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export class CreateInformationDto {
  @ApiProperty({ 
    example: 'Welcome Bonus 100%!',
    description: 'Judul informasi (wajib)',
    minLength: 3,
    maxLength: 200
  })
  @IsString()
  @MinLength(3, { message: 'Judul minimal 3 karakter' })
  @MaxLength(200, { message: 'Judul maksimal 200 karakter' })
  title: string;

  @ApiPropertyOptional({ 
    example: 'Dapatkan bonus deposit hingga 100%',
    description: 'Sub judul informasi (opsional)',
    maxLength: 300
  })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Sub judul maksimal 300 karakter' })
  subtitle?: string;

  @ApiProperty({ 
    example: 'Promosi spesial untuk member baru. Deposit pertama mendapat bonus 100%. Syarat dan ketentuan berlaku.',
    description: 'Deskripsi informasi (wajib)',
    minLength: 10
  })
  @IsString()
  @MinLength(10, { message: 'Deskripsi minimal 10 karakter' })
  description: string;

  @ApiProperty({ 
    enum: InformationType,
    example: InformationType.PROMOTION,
    description: 'Tipe informasi'
  })
  @IsEnum(InformationType, { message: 'Tipe informasi tidak valid' })
  type: InformationType;

  @ApiPropertyOptional({ 
    enum: InformationPriority,
    example: InformationPriority.HIGH,
    description: 'Prioritas informasi',
    default: InformationPriority.MEDIUM
  })
  @IsOptional()
  @IsEnum(InformationPriority, { message: 'Prioritas tidak valid' })
  priority?: InformationPriority;

  @ApiPropertyOptional({ 
    example: 'https://example.com/promo-banner.jpg',
    description: 'URL gambar banner (opsional)'
  })
  @IsOptional()
  @IsUrl({}, { message: 'Format URL gambar tidak valid' })
  imageUrl?: string;

  @ApiPropertyOptional({ 
    example: 'https://example.com/promo-details',
    description: 'URL link untuk detail (opsional)'
  })
  @IsOptional()
  @IsUrl({}, { message: 'Format URL link tidak valid' })
  linkUrl?: string;

  @ApiPropertyOptional({ 
    example: 'Lihat Detail Promo',
    description: 'Text untuk link button (opsional)'
  })
  @IsOptional()
  @IsString()
  linkText?: string;

  @ApiPropertyOptional({ 
    example: '2026-02-10T00:00:00Z',
    description: 'Tanggal mulai tampil (opsional, ISO 8601)'
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ 
    example: '2026-03-10T23:59:59Z',
    description: 'Tanggal selesai tampil (opsional, ISO 8601)'
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ 
    example: '2026-02-10T08:00:00Z',
    description: 'Tanggal publikasi (opsional, ISO 8601)'
  })
  @IsOptional()
  @IsString()
  publishDate?: string;

  @ApiPropertyOptional({ 
    example: true,
    description: 'Status aktif/tidak aktif',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ 
    example: false,
    description: 'Pin informasi di bagian atas',
    default: false
  })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ 
    example: ['gold', 'vip'],
    description: 'Target user berdasarkan status (opsional)',
    isArray: true,
    enum: ['standard', 'gold', 'vip']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetUserStatus?: ('standard' | 'gold' | 'vip')[];

  @ApiPropertyOptional({ 
    example: ['user'],
    description: 'Target user berdasarkan role (opsional)',
    isArray: true,
    enum: ['user', 'admin', 'super_admin']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetUserRoles?: ('user' | 'admin' | 'super_admin')[];
}