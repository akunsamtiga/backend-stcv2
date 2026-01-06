// src/auth/dto/register.dto.ts
// ✅ ENHANCED: Registration with optional profile fields

import { 
  IsEmail, IsString, MinLength, Matches, IsOptional, 
  Length, IsDateString, IsEnum 
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  // ============================================
  // REQUIRED FIELDS
  // ============================================

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
    description: 'Referral code from friend (optional)'
  })
  @IsOptional()
  @IsString()
  referralCode?: string;

  // ============================================
  // OPTIONAL PROFILE FIELDS
  // ============================================

  @ApiPropertyOptional({ 
    example: 'John Doe',
    description: 'Full name (optional, can be set later)'
  })
  @IsOptional()
  @IsString()
  @Length(3, 100)
  fullName?: string;

  @ApiPropertyOptional({ 
    example: '+6281234567890',
    description: 'Phone number in E.164 format (optional)'
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be in valid format (E.164)'
  })
  phoneNumber?: string;

  @ApiPropertyOptional({ 
    example: '1990-01-01',
    description: 'Date of birth in YYYY-MM-DD format (optional)'
  })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ 
    enum: ['male', 'female', 'other'],
    example: 'male',
    description: 'Gender (optional)'
  })
  @IsOptional()
  @IsEnum(['male', 'female', 'other'])
  gender?: string;

  @ApiPropertyOptional({ 
    example: 'Indonesian',
    description: 'Nationality (optional)'
  })
  @IsOptional()
  @IsString()
  nationality?: string;
}