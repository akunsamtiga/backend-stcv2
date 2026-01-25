// src/payment/payment.controller.ts
import { Controller, Post, Get, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { PaymentService } from './payment.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { MidtransWebhookDto } from './dto/midtrans-webhook.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  // ============================================
  // CREATE DEPOSIT
  // ============================================

  @Post('deposit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Create deposit transaction',
    description: 'Create deposit transaction and get Midtrans Snap token for payment'
  })
  @ApiBody({ type: CreateDepositDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Deposit created successfully',
    schema: {
      example: {
        success: true,
        data: {
          message: 'Deposit transaction created successfully',
          deposit: {
            id: 'deposit_id',
            order_id: 'DEPOSIT-user123-1234567890',
            amount: 100000,
            status: 'pending',
            snap_token: 'xxx-xxx-xxx',
            snap_redirect_url: 'https://app.midtrans.com/snap/v2/vtweb/xxx'
          }
        }
      }
    }
  })
  createDeposit(
    @CurrentUser('sub') userId: string,
    @Body() createDepositDto: CreateDepositDto,
  ) {
    return this.paymentService.createDeposit(userId, createDepositDto);
  }

  // ============================================
  // MIDTRANS WEBHOOK
  // ============================================

  @Post('webhook/midtrans')
  @ApiOperation({ 
    summary: 'Midtrans webhook handler',
    description: 'Receive payment notifications from Midtrans'
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  handleMidtransWebhook(@Body() notification: MidtransWebhookDto) {
    return this.paymentService.handleWebhook(notification);
  }

  // ============================================
  // GET USER DEPOSITS
  // ============================================

  @Get('deposits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Get user deposit history',
    description: 'Get all deposit transactions for current user'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Deposits retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          deposits: [
            {
              id: 'deposit_id',
              order_id: 'DEPOSIT-user123-1234567890',
              amount: 100000,
              status: 'success',
              payment_type: 'bank_transfer',
              description: 'Deposit to real account',
              createdAt: '2024-01-01T00:00:00.000Z',
              completedAt: '2024-01-01T00:05:00.000Z'
            }
          ],
          summary: {
            total: 10,
            success: 8,
            pending: 1,
            failed: 1
          }
        }
      }
    }
  })
  getUserDeposits(@CurrentUser('sub') userId: string) {
    return this.paymentService.getUserDeposits(userId);
  }

  // ============================================
  // CHECK DEPOSIT STATUS
  // ============================================

  @Get('deposit/:orderId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Check deposit status',
    description: 'Check status of specific deposit transaction'
  })
  @ApiResponse({ status: 200, description: 'Status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Deposit not found' })
  checkDepositStatus(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.paymentService.checkDepositStatus(userId, orderId);
  }
}