// src/auth/auth.controller.ts

import { Controller, Post, Body, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './auth.service.google';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private googleAuthService: GoogleAuthService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({ status: 201, description: 'User successfully registered' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  // ============================================
  // GOOGLE SIGN-IN
  // ============================================

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Google Sign-In',
    description: 'Sign in or register using Google account. Automatically creates account on first sign-in.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Google Sign-In successful',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Google Sign-In successful',
          isNewUser: false,
          user: {
            id: 'user_id',
            email: 'user@gmail.com',
            role: 'user',
            status: 'standard',
            profile: {
              fullName: 'John Doe',
              avatar: 'https://lh3.googleusercontent.com/...'
            },
            referralCode: 'ABC123XY',
            loginCount: 5,
            lastLoginAt: '2024-01-01T00:00:00.000Z'
          },
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
        }
      }
    }
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Invalid Google credentials or email not verified' 
  })
  googleSignIn(@Body() googleLoginDto: GoogleLoginDto) {
    return this.googleAuthService.googleSignIn(googleLoginDto);
  }

  @Get('google/status')
  @ApiOperation({ 
    summary: 'Check Google Sign-In configuration',
    description: 'Check if Google Sign-In is properly configured'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns Google Sign-In configuration status' 
  })
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
