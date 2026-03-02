// src/auth/dto/register.dto.ts

import { 
  IsEmail, IsString, MinLength, Matches, IsOptional, 
  Length, IsDateString, IsEnum 
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ 
    example: 'user@example.com',
    description: 'User email address (required)'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @ApiProperty({ 
    example: 'SecurePass123!', 
    minLength: 8,
    description: 'Password (min 8 chars, must contain uppercase, lowercase, and number/special char)'
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain uppercase, lowercase, and number/special character',
  })
  password: string;

  @ApiPropertyOptional({ 
    example: 'REF123ABC',
    description: 'Referral code from friend (optional)',
    required: false 
  })
  @IsOptional()
  @IsString()
  referralCode?: string;

  @ApiPropertyOptional({ 
    example: 'AFFAB12CD34',
    description: 'Affiliate code from an affiliator (optional)',
    required: false
  })
  @IsOptional()
  @IsString()
  affiliateCode?: string;

  @ApiPropertyOptional({ 
    example: 'John Doe',
    description: 'Full name (optional, can be set later)',
    required: false
  })
  @IsOptional()
  @IsString()
  @Length(3, 100)
  fullName?: string;

  @ApiPropertyOptional({ 
    example: '081234567890',
    description: 'Nomor HP Indonesia. Format yang diterima: 081234567890 | +6281234567890 | 6281234567890',
    required: false
  })
  @IsOptional()
  @IsString()
  // ✅ FIX: Regex sebelumnya /^\+?[1-9]\d{1,14}$/ menolak angka 0 di awal,
  // sehingga format umum Indonesia seperti 081234567890 selalu gagal validasi.
  // Regex baru menerima tiga format nomor HP Indonesia:
  //   - 081234567890       (format lokal, diawali 0)
  //   - +6281234567890     (format E.164 dengan +)
  //   - 6281234567890      (format E.164 tanpa +)
  // Panjang digit setelah kode negara/awalan: 8–12 digit (provider Indonesia)
  @Matches(/^(\+62|62|0)[0-9]{8,12}$/, {
    message: 'Nomor HP harus format Indonesia yang valid: 081234567890, +6281234567890, atau 6281234567890',
  })
  phoneNumber?: string;

  @ApiPropertyOptional({ 
    example: '1990-01-01',
    description: 'Date of birth in YYYY-MM-DD format (optional)',
    required: false
  })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ 
    enum: ['male', 'female', 'other'],
    example: 'male',
    description: 'Gender (optional)',
    required: false
  })
  @IsOptional()
  @IsEnum(['male', 'female', 'other'])
  gender?: string;

  @ApiPropertyOptional({ 
    example: 'Indonesian',
    description: 'Nationality (optional)',
    required: false
  })
  @IsOptional()
  @IsString()
  nationality?: string;
}