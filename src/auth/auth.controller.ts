// src/auth/auth.controller.ts

import {
  Controller, Post, Body, HttpCode, HttpStatus,
  Get, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './auth.service.google';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private googleAuthService: GoogleAuthService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({
    status: 201,
    description: 'User successfully registered. Email verifikasi dikirim otomatis.',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Registration successful with real and demo accounts',
          user: {
            id: 'user_id',
            email: 'user@example.com',
            role: 'user',
            status: 'standard',
            emailVerified: false,
          },
          emailVerification: {
            required: true,
            message: 'Email verifikasi telah dikirim ke user@example.com. Silakan cek inbox Anda.',
          },
          token: 'eyJ...',
        },
      },
    },
  })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Response includes emailVerified status.',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Login successful',
          user: {
            id: 'user_id',
            email: 'user@example.com',
            role: 'user',
            status: 'standard',
            emailVerified: false,
          },
          emailVerification: {
            required: false,
            message: 'Email Anda belum diverifikasi. Silakan cek inbox atau minta kirim ulang.',
          },
          token: 'eyJ...',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  // ─── Email Verification ────────────────────────────────────────────────────

  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verifikasi email via token',
    description: 'User klik link dari email → token dikirim sebagai query param. Token berlaku 24 jam.',
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'Token verifikasi dari email',
    example: 'a1b2c3d4e5f6...',
  })
  @ApiResponse({
    status: 200,
    description: 'Email berhasil diverifikasi',
    schema: {
      example: {
        success: true,
        data: { message: 'Email berhasil diverifikasi' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Token tidak valid atau sudah kadaluarsa' })
  verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Kirim ulang email verifikasi',
    description: 'Hanya bisa dipanggil 1x per menit. Akan error jika email sudah terverifikasi.',
  })
  @ApiResponse({
    status: 200,
    description: 'Email verifikasi berhasil dikirim ulang',
    schema: {
      example: {
        success: true,
        data: { message: 'Email verifikasi telah dikirim ulang. Periksa inbox Anda.' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Email sudah terverifikasi atau rate limit' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  resendVerification(@CurrentUser('sub') userId: string) {
    return this.authService.resendVerificationEmail(userId);
  }

  // ─── Google Auth ───────────────────────────────────────────────────────────

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Google Sign-In',
    description: 'Sign in or register using Google account. Email otomatis terverifikasi.',
  })
  @ApiResponse({ status: 200, description: 'Google Sign-In successful' })
  @ApiResponse({ status: 401, description: 'Invalid Google credentials or email not verified' })
  googleSignIn(@Body() googleLoginDto: GoogleLoginDto) {
    return this.googleAuthService.googleSignIn(googleLoginDto);
  }

  @Get('google/status')
  @ApiOperation({ summary: 'Check Google Sign-In configuration' })
  @ApiResponse({ status: 200, description: 'Returns Google Sign-In configuration status' })
  checkGoogleSignInStatus() {
    return {
      enabled: true,
      provider: 'firebase',
      message: 'Google Sign-In is enabled via Firebase Authentication',
      instructions: {
        frontend: [
          '1. Initialize Firebase in your frontend app',
          '2. Use signInWithPopup(auth, googleProvider)',
          '3. Get idToken from user.getIdToken()',
          '4. Send idToken to POST /api/v1/auth/google',
        ],
        example: {
          firebase: 'const result = await signInWithPopup(auth, googleProvider);',
          token: 'const idToken = await result.user.getIdToken();',
          api: 'POST /api/v1/auth/google with { idToken }',
        },
      },
    };
  }
}