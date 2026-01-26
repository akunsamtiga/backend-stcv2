import { Controller, Post, Get, Body, Param, UseGuards, Headers, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody, ApiExcludeEndpoint } from '@nestjs/swagger';
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
  // CREATE DEPOSIT (Protected)
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
  // MIDTRANS WEBHOOK (PUBLIC - NO AUTH!)
  // ============================================

  @Post('webhook/midtrans')
  @UsePipes(new ValidationPipe({
    whitelist: false,           // ✅ Allow extra fields
    forbidNonWhitelisted: false, // ✅ Don't throw on extra fields
    transform: true,
    skipMissingProperties: true, // ✅ Skip if fields missing
  }))
  @ApiOperation({ 
    summary: 'Midtrans webhook handler',
    description: 'Receive payment notifications from Midtrans. This endpoint is PUBLIC and does not require authentication.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Webhook processed successfully',
    schema: {
      example: {
        message: 'Webhook processed successfully'
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid signature or bad request'
  })
  async handleMidtransWebhook(
    @Body() notification: MidtransWebhookDto,
    @Headers() headers: any
  ) {
    // ✅ LOG REQUEST untuk debugging
    console.log('🔔 ========================================');
    console.log('🔔 WEBHOOK REQUEST RECEIVED');
    console.log('🔔 ========================================');
    console.log('Headers:', JSON.stringify(headers, null, 2));
    console.log('Body:', JSON.stringify(notification, null, 2));
    console.log('🔔 ========================================');

    return this.paymentService.handleWebhook(notification);
  }

  // ============================================
  // GET USER DEPOSITS (Protected)
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
  // CHECK DEPOSIT STATUS (Protected)
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

  // ============================================
  // TEST WEBHOOK (Development Only)
  // ============================================

  @Post('webhook/test/:orderId')
  @ApiExcludeEndpoint()
  @ApiOperation({ 
    summary: '[DEV] Test webhook manually',
    description: 'Simulate Midtrans webhook for testing purposes'
  })
  async testWebhook(@Param('orderId') orderId: string) {
    const crypto = require('crypto');
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    
    // Cari transaksi untuk mendapatkan gross_amount yang benar
    const db = (this.paymentService as any).firebaseService.getFirestore();
    const snapshot = await db
      .collection('deposit_transactions')
      .where('order_id', '==', orderId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { error: 'Transaction not found' };
    }

    const transaction = snapshot.docs[0].data();
    const grossAmount = transaction.amount.toString();

    // Generate valid signature
    const hash = crypto
      .createHash('sha512')
      .update(`${orderId}200${grossAmount}${serverKey}`)
      .digest('hex');

    const mockNotification: MidtransWebhookDto = {
      transaction_time: new Date().toISOString(),
      transaction_status: 'settlement',
      transaction_id: `TEST-${Date.now()}`,
      status_message: 'Test webhook - Manual trigger',
      status_code: '200',
      signature_key: hash,
      payment_type: 'credit_card',
      order_id: orderId,
      merchant_id: process.env.MIDTRANS_MERCHANT_ID || '',
      gross_amount: grossAmount,
      fraud_status: 'accept',
    };

    console.log('🧪 ========================================');
    console.log('🧪 TESTING WEBHOOK MANUALLY');
    console.log('🧪 ========================================');
    console.log('Order ID:', orderId);
    console.log('Amount:', grossAmount);
    console.log('Signature:', hash);
    console.log('🧪 ========================================');

    return this.paymentService.handleWebhook(mockNotification);
  }
}

