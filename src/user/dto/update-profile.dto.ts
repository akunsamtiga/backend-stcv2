// src/user/dto/update-profile.dto.ts
// ✅ Complete Profile Update DTOs

import { 
  IsString, IsOptional, IsEnum, IsBoolean, IsDateString, 
  ValidateNested, Matches, Length, IsUrl 
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// ✅ Address DTO
export class AddressDto {
  @ApiPropertyOptional({ example: 'Jl. Merdeka No. 123' })
  @IsOptional()
  @IsString()
  street?: string;

  @ApiPropertyOptional({ example: 'Jakarta' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'DKI Jakarta' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({ example: '12345' })
  @IsOptional()
  @IsString()
  @Length(5, 10)
  postalCode?: string;

  @ApiPropertyOptional({ example: 'Indonesia' })
  @IsOptional()
  @IsString()
  country?: string;
}

// ✅ Identity Document DTO
export class IdentityDocumentDto {
  @ApiPropertyOptional({ 
    enum: ['ktp', 'passport', 'sim'], 
    example: 'ktp' 
  })
  @IsOptional()
  @IsEnum(['ktp', 'passport', 'sim'])
  type?: string;

  @ApiPropertyOptional({ example: '3201234567890001' })
  @IsOptional()
  @IsString()
  @Length(5, 30)
  number?: string;

  @ApiPropertyOptional({ example: '2020-01-01' })
  @IsOptional()
  @IsDateString()
  issuedDate?: string;

  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

// ✅ Bank Account DTO
export class BankAccountDto {
  @ApiPropertyOptional({ example: 'Bank Mandiri' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @IsOptional()
  @IsString()
  @Length(5, 20)
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  accountHolderName?: string;
}

// ✅ Settings DTO
export class SettingsDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  smsNotifications?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  tradingAlerts?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  twoFactorEnabled?: boolean;

  @ApiPropertyOptional({ 
    enum: ['id', 'en'], 
    default: 'id' 
  })
  @IsOptional()
  @IsEnum(['id', 'en'])
  language?: string;

  @ApiPropertyOptional({ default: 'Asia/Jakarta' })
  @IsOptional()
  @IsString()
  timezone?: string;
}

// ✅ Main Update Profile DTO
export class UpdateProfileDto {
  // Personal Information
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @Length(3, 100)
  fullName?: string;

  @ApiPropertyOptional({ example: '+6281234567890' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be in valid format (E.164)'
  })
  phoneNumber?: string;

  @ApiPropertyOptional({ example: '1990-01-01' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ 
    enum: ['male', 'female', 'other'], 
    example: 'male' 
  })
  @IsOptional()
  @IsEnum(['male', 'female', 'other'])
  gender?: string;

  @ApiPropertyOptional({ example: 'Indonesian' })
  @IsOptional()
  @IsString()
  nationality?: string;

  // Address
  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  // Identity Document
  @ApiPropertyOptional({ type: IdentityDocumentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IdentityDocumentDto)
  identityDocument?: IdentityDocumentDto;

  // Bank Account
  @ApiPropertyOptional({ type: BankAccountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount?: BankAccountDto;

  // Settings
  @ApiPropertyOptional({ type: SettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettingsDto)
  settings?: SettingsDto;
}

// ✅ Upload Avatar DTO
export class UploadAvatarDto {
  @ApiPropertyOptional({ 
    example: 'https://storage.example.com/avatars/user123.jpg' 
  })
  @IsOptional()
  @IsUrl()
  url?: string;
}

// ✅ Verify Phone DTO
export class VerifyPhoneDto {
  @ApiPropertyOptional({ example: '+6281234567890' })
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/)
  phoneNumber: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsString()
  @Length(6, 6)
  verificationCode: string;
}

// ✅ Change Password DTO
export class ChangePasswordDto {
  @ApiPropertyOptional({ example: 'OldPassword123!' })
  @IsString()
  currentPassword: string;

  @ApiPropertyOptional({ example: 'NewPassword123!' })
  @IsString()
  @Length(8, 100)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain uppercase, lowercase, and number/special character',
  })
  newPassword: string;

  @ApiPropertyOptional({ example: 'NewPassword123!' })
  @IsString()
  confirmPassword: string;
}