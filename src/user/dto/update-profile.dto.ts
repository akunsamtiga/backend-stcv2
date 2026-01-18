// src/user/dto/update-profile.dto.ts
import { 
  IsString, IsOptional, IsEnum, IsBoolean, IsDateString, 
  ValidateNested, Matches, Length, IsUrl, IsNumber, Min, Max 
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ============================================
// PHOTO UPLOAD DTOs - 4MB LIMIT
// ============================================

export class PhotoUploadDto {
  @ApiProperty({ 
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    description: 'Base64 data URL or HTTPS URL of the uploaded photo'
  })
  @IsString()
  @Matches(/^(data:image\/(jpeg|jpg|png|webp);base64,|https:\/\/)/, {
    message: 'Photo URL must be a valid base64 data URL or HTTPS URL'
  })
  url: string;

  @ApiPropertyOptional({ 
    example: 4194304,
    description: 'File size in bytes (max 4MB)'
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'File size must be a positive number' })
  @Max(4194304, { message: 'File size must not exceed 4MB (4,194,304 bytes)' })
  fileSize?: number;

  @ApiPropertyOptional({ 
    example: 'image/jpeg',
    description: 'MIME type - Must be image/jpeg, image/jpg, image/png, or image/webp'
  })
  @IsOptional()
  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp)$/i, {
    message: 'File must be JPEG, JPG, PNG, or WEBP format'
  })
  mimeType?: string;
}

// ============================================
// PROFILE SECTION DTOs
// ============================================

export class AddressDto {
  @ApiPropertyOptional({ 
    example: 'Jl. Merdeka No. 123',
    description: 'Street address'
  })
  @IsOptional()
  @IsString()
  @Length(5, 200, { message: 'Street address must be between 5 and 200 characters' })
  street?: string;

  @ApiPropertyOptional({ 
    example: 'Jakarta',
    description: 'City name'
  })
  @IsOptional()
  @IsString()
  @Length(2, 100, { message: 'City must be between 2 and 100 characters' })
  city?: string;

  @ApiPropertyOptional({ 
    example: 'DKI Jakarta',
    description: 'Province/State'
  })
  @IsOptional()
  @IsString()
  @Length(2, 100, { message: 'Province must be between 2 and 100 characters' })
  province?: string;

  @ApiPropertyOptional({ 
    example: '12345',
    description: 'Postal code (5-10 digits)'
  })
  @IsOptional()
  @IsString()
  @Length(5, 10, { message: 'Postal code must be between 5 and 10 characters' })
  @Matches(/^[0-9]+$/, { message: 'Postal code must contain only numbers' })
  postalCode?: string;

  @ApiPropertyOptional({ 
    example: 'Indonesia',
    description: 'Country name'
  })
  @IsOptional()
  @IsString()
  @Length(2, 100, { message: 'Country must be between 2 and 100 characters' })
  country?: string;
}

export class IdentityDocumentDto {
  @ApiPropertyOptional({ 
    enum: ['ktp', 'passport', 'sim'], 
    example: 'ktp',
    description: 'Type of identity document - KTP (ID Card), Passport, or SIM (Driver License)'
  })
  @IsOptional()
  @IsEnum(['ktp', 'passport', 'sim'], {
    message: 'Identity type must be either ktp, passport, or sim'
  })
  type?: string;

  @ApiPropertyOptional({ 
    example: '3201234567890001',
    description: 'Identity document number (5-30 characters)'
  })
  @IsOptional()
  @IsString()
  @Length(5, 30, { message: 'Identity number must be between 5 and 30 characters' })
  @Matches(/^[A-Za-z0-9-]+$/, { 
    message: 'Identity number can only contain letters, numbers, and hyphens' 
  })
  number?: string;

  @ApiPropertyOptional({ 
    example: '2020-01-01',
    description: 'Issue date in YYYY-MM-DD format'
  })
  @IsOptional()
  @IsDateString({}, { message: 'Issue date must be in valid YYYY-MM-DD format' })
  issuedDate?: string;

  @ApiPropertyOptional({ 
    example: '2025-01-01',
    description: 'Expiry date in YYYY-MM-DD format'
  })
  @IsOptional()
  @IsDateString({}, { message: 'Expiry date must be in valid YYYY-MM-DD format' })
  expiryDate?: string;

  @ApiPropertyOptional({ 
    type: PhotoUploadDto,
    description: 'Front photo of identity document (HTTPS URL, max 4MB, JPEG/PNG/WEBP)'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhotoUploadDto)
  photoFront?: PhotoUploadDto;

  @ApiPropertyOptional({ 
    type: PhotoUploadDto,
    description: 'Back photo of identity document (HTTPS URL, max 4MB, JPEG/PNG/WEBP)'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhotoUploadDto)
  photoBack?: PhotoUploadDto;
}

export class BankAccountDto {
  @ApiPropertyOptional({ 
    example: 'Bank Mandiri',
    description: 'Bank name'
  })
  @IsOptional()
  @IsString()
  @Length(3, 100, { message: 'Bank name must be between 3 and 100 characters' })
  bankName?: string;

  @ApiPropertyOptional({ 
    example: '1234567890',
    description: 'Bank account number (5-20 digits)'
  })
  @IsOptional()
  @IsString()
  @Length(5, 20, { message: 'Account number must be between 5 and 20 characters' })
  @Matches(/^[0-9]+$/, { message: 'Account number must contain only numbers' })
  accountNumber?: string;

  @ApiPropertyOptional({ 
    example: 'John Doe',
    description: 'Account holder name (must match ID)'
  })
  @IsOptional()
  @IsString()
  @Length(3, 100, { message: 'Account holder name must be between 3 and 100 characters' })
  accountHolderName?: string;
}

export class SettingsDto {
  @ApiPropertyOptional({ 
    default: true,
    description: 'Enable email notifications'
  })
  @IsOptional()
  @IsBoolean({ message: 'Email notifications must be true or false' })
  emailNotifications?: boolean;

  @ApiPropertyOptional({ 
    default: true,
    description: 'Enable SMS notifications'
  })
  @IsOptional()
  @IsBoolean({ message: 'SMS notifications must be true or false' })
  smsNotifications?: boolean;

  @ApiPropertyOptional({ 
    default: true,
    description: 'Enable trading alerts'
  })
  @IsOptional()
  @IsBoolean({ message: 'Trading alerts must be true or false' })
  tradingAlerts?: boolean;

  @ApiPropertyOptional({ 
    default: false,
    description: 'Enable two-factor authentication'
  })
  @IsOptional()
  @IsBoolean({ message: 'Two-factor enabled must be true or false' })
  twoFactorEnabled?: boolean;

  @ApiPropertyOptional({ 
    enum: ['id', 'en'], 
    default: 'id',
    description: 'Preferred language - id (Indonesian) or en (English)'
  })
  @IsOptional()
  @IsEnum(['id', 'en'], { message: 'Language must be either id or en' })
  language?: string;

  @ApiPropertyOptional({ 
    default: 'Asia/Jakarta',
    description: 'Timezone (IANA timezone format)'
  })
  @IsOptional()
  @IsString()
  @Length(3, 50, { message: 'Timezone must be between 3 and 50 characters' })
  timezone?: string;
}

// ============================================
// MAIN UPDATE PROFILE DTO
// ============================================

export class UpdateProfileDto {
  // Personal Information
  @ApiPropertyOptional({ 
    example: 'John Doe',
    description: 'Full name (3-100 characters)'
  })
  @IsOptional()
  @IsString()
  @Length(3, 100, { message: 'Full name must be between 3 and 100 characters' })
  @Matches(/^[a-zA-Z\s.'-]+$/, { 
    message: 'Full name can only contain letters, spaces, dots, hyphens, and apostrophes' 
  })
  fullName?: string;

  @ApiPropertyOptional({ 
    example: '+6281234567890',
    description: 'Phone number in E.164 format (e.g., +6281234567890)'
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be in valid E.164 format (e.g., +6281234567890)'
  })
  phoneNumber?: string;

  @ApiPropertyOptional({ 
    example: '1990-01-01',
    description: 'Date of birth in YYYY-MM-DD format'
  })
  @IsOptional()
  @IsDateString({}, { message: 'Date of birth must be in valid YYYY-MM-DD format' })
  dateOfBirth?: string;

  @ApiPropertyOptional({ 
    enum: ['male', 'female', 'other'], 
    example: 'male',
    description: 'Gender - male, female, or other'
  })
  @IsOptional()
  @IsEnum(['male', 'female', 'other'], { 
    message: 'Gender must be either male, female, or other' 
  })
  gender?: string;

  @ApiPropertyOptional({ 
    example: 'Indonesian',
    description: 'Nationality'
  })
  @IsOptional()
  @IsString()
  @Length(3, 100, { message: 'Nationality must be between 3 and 100 characters' })
  nationality?: string;

  // Address
  @ApiPropertyOptional({ 
    type: AddressDto,
    description: 'Complete address information'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  // Identity Document
  @ApiPropertyOptional({ 
    type: IdentityDocumentDto,
    description: 'Identity document information (KTP/Passport/SIM)'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => IdentityDocumentDto)
  identityDocument?: IdentityDocumentDto;

  // Bank Account
  @ApiPropertyOptional({ 
    type: BankAccountDto,
    description: 'Bank account information for withdrawals'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount?: BankAccountDto;

  // Settings
  @ApiPropertyOptional({ 
    type: SettingsDto,
    description: 'User preferences and settings'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettingsDto)
  settings?: SettingsDto;
}

// ============================================
// UPLOAD SPECIFIC DTOs - 4MB LIMIT
// ============================================

export class UploadAvatarDto {
  @ApiProperty({ 
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    description: 'Base64 data URL or HTTPS URL of uploaded avatar/profile photo'
  })
  @IsString()
  @Matches(/^(data:image\/(jpeg|jpg|png|webp);base64,|https:\/\/)/, {
    message: 'Avatar URL must be a valid base64 data URL or HTTPS URL'
  })
  url: string;

  @ApiPropertyOptional({ 
    example: 4194304,
    description: 'File size in bytes (max 4MB)'
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'File size must be a positive number' })
  @Max(4194304, { message: 'Avatar file size must not exceed 4MB (4,194,304 bytes)' })
  fileSize?: number;

  @ApiPropertyOptional({ 
    example: 'image/jpeg',
    description: 'MIME type - Must be image/jpeg, image/jpg, image/png, or image/webp'
  })
  @IsOptional()
  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp)$/i, {
    message: 'Avatar must be JPEG, JPG, PNG, or WEBP format'
  })
  mimeType?: string;
}

export class UploadKTPDto {
  @ApiProperty({ 
    type: PhotoUploadDto,
    description: 'Front side photo of KTP/Identity Card (HTTPS URL, max 4MB, JPEG/PNG/WEBP)'
  })
  @ValidateNested()
  @Type(() => PhotoUploadDto)
  photoFront: PhotoUploadDto;

  @ApiPropertyOptional({ 
    type: PhotoUploadDto,
    description: 'Back side photo of KTP/Identity Card (optional for some ID types)'
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhotoUploadDto)
  photoBack?: PhotoUploadDto;
}

export class UploadSelfieDto {
  @ApiProperty({ 
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    description: 'Base64 data URL or HTTPS URL of uploaded selfie photo for identity verification'
  })
  @IsString()
  @Matches(/^(data:image\/(jpeg|jpg|png|webp);base64,|https:\/\/)/, {
    message: 'Selfie URL must be a valid base64 data URL or HTTPS URL'
  })
  url: string;

  @ApiPropertyOptional({ 
    example: 4194304,
    description: 'File size in bytes (max 4MB)'
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'File size must be a positive number' })
  @Max(4194304, { message: 'Selfie file size must not exceed 4MB (4,194,304 bytes)' })
  fileSize?: number;

  @ApiPropertyOptional({ 
    example: 'image/jpeg',
    description: 'MIME type - Must be image/jpeg, image/jpg, image/png, or image/webp'
  })
  @IsOptional()
  @IsString()
  @Matches(/^image\/(jpeg|jpg|png|webp)$/i, {
    message: 'Selfie must be JPEG, JPG, PNG, or WEBP format'
  })
  mimeType?: string;
}

// ============================================
// VERIFICATION DTOs
// ============================================

export class VerifyPhoneDto {
  @ApiProperty({ 
    example: '+6281234567890',
    description: 'Phone number in E.164 format'
  })
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be in valid E.164 format'
  })
  phoneNumber: string;

  @ApiProperty({ 
    example: '123456',
    description: '6-digit verification code sent via SMS'
  })
  @IsString()
  @Length(6, 6, { message: 'Verification code must be exactly 6 digits' })
  @Matches(/^[0-9]{6}$/, { message: 'Verification code must contain only numbers' })
  verificationCode: string;
}

export class ChangePasswordDto {
  @ApiProperty({ 
    example: 'OldPassword123!',
    description: 'Current password'
  })
  @IsString()
  @Length(1, 100, { message: 'Current password is required' })
  currentPassword: string;

  @ApiProperty({ 
    example: 'NewPassword123!',
    description: 'New password (min 8 characters, must contain uppercase, lowercase, and number/special character)'
  })
  @IsString()
  @Length(8, 100, { message: 'New password must be at least 8 characters long' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'New password must contain at least one uppercase letter, one lowercase letter, and one number or special character',
  })
  newPassword: string;

  @ApiProperty({ 
    example: 'NewPassword123!',
    description: 'Confirm new password (must match new password)'
  })
  @IsString()
  @Length(8, 100, { message: 'Confirm password must be at least 8 characters long' })
  confirmPassword: string;
}

// ============================================
// ADMIN VERIFICATION DTOs
// ============================================

export class AdminVerifyIdentityDto {
  @ApiProperty({ 
    example: 'user_id_here',
    description: 'User ID to verify'
  })
  @IsString()
  userId: string;

  @ApiProperty({ 
    example: true,
    description: 'Approve or reject verification'
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ 
    example: 'Identity document verified successfully',
    description: 'Admin notes/reason for approval or rejection'
  })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: 'Notes must not exceed 500 characters' })
  notes?: string;
}

export class AdminVerifySelfieDto {
  @ApiProperty({ 
    example: 'user_id_here',
    description: 'User ID to verify'
  })
  @IsString()
  userId: string;

  @ApiProperty({ 
    example: true,
    description: 'Approve or reject selfie verification'
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ 
    example: 'Selfie matches identity document',
    description: 'Admin notes/reason for approval or rejection'
  })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: 'Notes must not exceed 500 characters' })
  notes?: string;
}

export class AdminVerifyBankAccountDto {
  @ApiProperty({ 
    example: 'user_id_here',
    description: 'User ID to verify'
  })
  @IsString()
  userId: string;

  @ApiProperty({ 
    example: true,
    description: 'Approve or reject bank account verification'
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ 
    example: 'Bank account verified',
    description: 'Admin notes/reason for approval or rejection'
  })
  @IsOptional()
  @IsString()
  @Length(0, 500, { message: 'Notes must not exceed 500 characters' })
  notes?: string;
}