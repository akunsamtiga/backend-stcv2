// src/auth/dto/google-login.dto.ts

import { IsString, IsNotEmpty, IsEmail, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({ 
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFl...',
    description: 'Firebase ID Token from Google Sign-In'
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiPropertyOptional({ 
    example: 'John Doe',
    description: 'User display name from Google (optional, will be extracted from token)'
  })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ 
    example: 'https://lh3.googleusercontent.com/...',
    description: 'User photo URL from Google (optional, will be extracted from token)'
  })
  @IsOptional()
  @IsString()
  photoURL?: string;

  @ApiPropertyOptional({ 
    example: 'REF123ABC',
    description: 'Referral code from friend (optional)'
  })
  @IsOptional()
  @IsString()
  referralCode?: string;
}
