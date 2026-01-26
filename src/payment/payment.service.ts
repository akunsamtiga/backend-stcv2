// src/payment/payment.service.ts - FINAL FIX

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { FirebaseService } from '../firebase/firebase.service';
import { BalanceService } from '../balance/balance.service';
import { UserStatusService } from '../user/user-status.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { MidtransWebhookDto } from './dto/midtrans-webhook.dto';
import { COLLECTIONS, BALANCE_TYPES, BALANCE_ACCOUNT_TYPE } from '../common/constants';
import { User } from '../common/interfaces';

const midtransClient = require('midtrans-client');

interface DepositTransaction {
  id: string;
  user_id: string;
  order_id: string;
  amount: number;
  status: 'pending' | 'success' | 'failed' | 'expired';
  payment_type?: string;
  transaction_id?: string;
  snap_token?: string;
  snap_redirect_url?: string;
  description?: string;
  userEmail: string;
  userName?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  midtrans_response?: any;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private snap: any;
  private coreApi: any;

  constructor(
    private configService: ConfigService,
    private firebaseService: FirebaseService,
    private balanceService: BalanceService,
    private userStatusService: UserStatusService,
  ) {
    this.initializeMidtrans();
  }

  private initializeMidtrans() {
    try {
      const isProduction = this.configService.get('midtrans.isProduction');
      const serverKey = this.configService.get('midtrans.serverKey');
      const clientKey = this.configService.get('midtrans.clientKey');

      if (!serverKey || !clientKey) {
        this.logger.error('❌ Midtrans configuration missing!');
        this.logger.error('Please set MIDTRANS_SERVER_KEY and MIDTRANS_CLIENT_KEY in .env');
        throw new Error('Midtrans configuration incomplete');
      }

      this.logger.log('🔧 Initializing Midtrans...');
      this.logger.log(`   Mode: ${isProduction ? 'PRODUCTION' : 'SANDBOX'}`);
      this.logger.log(`   Server Key: ${serverKey.substring(0, 10)}...`);
      this.logger.log(`   Client Key: ${clientKey.substring(0, 10)}...`);

      this.snap = new midtransClient.Snap({
        isProduction,
        serverKey,
        clientKey,
      });

      this.coreApi = new midtransClient.CoreApi({
        isProduction,
        serverKey,
        clientKey,
      });

      this.logger.log(`✅ Midtrans initialized (${isProduction ? 'PRODUCTION' : 'SANDBOX'})`);
    } catch (error) {
      this.logger.error('❌ Failed to initialize Midtrans:', error.message);
      throw error;
    }
  }

  async createDeposit(userId: string, createDepositDto: CreateDepositDto) {
    const db = this.firebaseService.getFirestore();

    try {
      this.logger.log('🔥 Processing transaction request...');
      this.logger.log(`   User: ${userId}`);
      this.logger.log(`   Amount: Rp ${createDepositDto.amount.toLocaleString()}`);

      if (!this.snap || !this.coreApi) {
        throw new Error('Payment service not initialized. Please contact support.');
      }

      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      
      if (!user.email) {
        throw new BadRequestException('User email is required for transaction');
      }

      this.logger.log(`   Email: ${user.email}`);

      const timestamp = Date.now();
      
      const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
      const orderId = `TRX-${userId.substring(0, 6)}${randomCode}-${timestamp}`;

      const depositId = await this.firebaseService.generateId('deposit_transactions');
      const depositTransaction: DepositTransaction = {
        id: depositId,
        user_id: userId,
        order_id: orderId,
        amount: createDepositDto.amount,
        status: 'pending',
        description: createDepositDto.description || 'Credit top-up',
        userEmail: user.email,
        userName: user.profile?.fullName,
        createdAt: new Date().toISOString(),
      };

      await db.collection('deposit_transactions').doc(depositId).set(depositTransaction);
      this.logger.log(`✅ Transaction record created: ${depositId}`);

      const customerName = user.profile?.fullName || user.email.split('@')[0];
      const customerPhone = user.profile?.phoneNumber || '081234567890';
      
      const parameter = {
        transaction_details: {
          order_id: orderId,
          gross_amount: createDepositDto.amount,
        },
        customer_details: {
          first_name: customerName,
          email: user.email,
          phone: customerPhone,
        },
        item_details: [
          {
            id: `PKG${Math.floor(Math.random() * 900) + 100}`,
            price: createDepositDto.amount,
            quantity: 1,
            name: 'Pembelian Paket Digital',
          },
        ],
        callbacks: {
          finish: `${this.getFrontendUrl()}/payment/success`,
          error: `${this.getFrontendUrl()}/payment/failed`,
          pending: `${this.getFrontendUrl()}/payment/pending`,
        },
      };

      this.logger.log('📄 Creating payment transaction...');
      this.logger.log(`   Order ID: ${orderId}`);
      this.logger.log(`   Amount: Rp ${createDepositDto.amount.toLocaleString()}`);

      let transaction: any;
      try {
        transaction = await this.snap.createTransaction(parameter);
        this.logger.log('✅ Payment transaction created successfully');
      } catch (midtransError: any) {
        this.logger.error('❌ Midtrans API Error:', midtransError.message);
        this.logger.error('   Response:', JSON.stringify(midtransError.ApiResponse || {}));
        
        await db.collection('deposit_transactions').doc(depositId).update({
          status: 'failed',
          updatedAt: new Date().toISOString(),
          midtrans_response: {
            error: midtransError.message,
            response: midtransError.ApiResponse,
          },
        });

        throw new BadRequestException(
          `Payment gateway error: ${midtransError.message || 'Failed to create payment'}`
        );
      }

      await db.collection('deposit_transactions').doc(depositId).update({
        snap_token: transaction.token,
        snap_redirect_url: transaction.redirect_url,
        updatedAt: new Date().toISOString(),
        midtrans_response: transaction,
      });

      this.logger.log(
        `✅ Transaction created: ${orderId} - User: ${userId} - Amount: Rp ${createDepositDto.amount.toLocaleString()}`
      );

      return {
        message: 'Transaction created successfully',
        deposit: {
          id: depositId,
          order_id: orderId,
          amount: createDepositDto.amount,
          status: 'pending',
          snap_token: transaction.token,
          snap_redirect_url: transaction.redirect_url,
        },
      };

    } catch (error: any) {
      this.logger.error(`❌ createDeposit error: ${error.message}`);
      this.logger.error(`   Stack: ${error.stack}`);
      throw error;
    }
  }

  private getFrontendUrl(): string {
    const frontendUrl = this.configService.get('frontend.url');
    
    if (!frontendUrl) {
      this.logger.warn('⚠️ FRONTEND_URL not configured, using fallback');
      return 'http://localhost:3000';
    }
    
    this.logger.log(`🔗 Frontend URL: ${frontendUrl}`);
    return frontendUrl;
  }

  async handleWebhook(notification: MidtransWebhookDto) {
    const db = this.firebaseService.getFirestore();

    try {
      // ✅ FIX: Convert DTO to plain object immediately
      const notificationData = this.dtoToPlainObject(notification);

      if (!this.verifySignature(notification)) {
        throw new BadRequestException('Invalid signature');
      }

      const orderId = notification.order_id;
      const transactionStatus = notification.transaction_status;
      const fraudStatus = notification.fraud_status;

      this.logger.log(
        `🔥 Webhook received: ${orderId} - Status: ${transactionStatus}`
      );

      const depositSnapshot = await db
        .collection('deposit_transactions')
        .where('order_id', '==', orderId)
        .limit(1)
        .get();

      if (depositSnapshot.empty) {
        throw new NotFoundException(`Transaction not found: ${orderId}`);
      }

      const depositDoc = depositSnapshot.docs[0];
      const deposit = depositDoc.data() as DepositTransaction;

      if (deposit.status === 'success') {
        this.logger.warn(`⚠️ Duplicate webhook: ${orderId} already processed`);
        return { message: 'Transaction already processed' };
      }

      if (transactionStatus === 'capture') {
        if (fraudStatus === 'accept') {
          await this.processSuccessfulDeposit(deposit, notificationData);
        }
      } else if (transactionStatus === 'settlement') {
        await this.processSuccessfulDeposit(deposit, notificationData);
      } else if (
        transactionStatus === 'cancel' ||
        transactionStatus === 'deny' ||
        transactionStatus === 'expire'
      ) {
        await this.processFailedDeposit(deposit, notificationData);
      } else if (transactionStatus === 'pending') {
        await this.processPendingDeposit(deposit, notificationData);
      }

      return { message: 'Webhook processed successfully' };

    } catch (error) {
      this.logger.error(`❌ handleWebhook error: ${error.message}`);
      throw error;
    }
  }

  // ✅ NEW: Helper function to convert DTO to plain object
  private dtoToPlainObject(dto: MidtransWebhookDto): any {
    return {
      transaction_time: dto.transaction_time,
      transaction_status: dto.transaction_status,
      transaction_id: dto.transaction_id,
      status_message: dto.status_message,
      status_code: dto.status_code,
      signature_key: dto.signature_key,
      payment_type: dto.payment_type,
      order_id: dto.order_id,
      merchant_id: dto.merchant_id,
      gross_amount: dto.gross_amount,
      fraud_status: dto.fraud_status,
      currency: dto.currency,
      acquirer: dto.acquirer,
      settlement_time: dto.settlement_time,
    };
  }

  private async processSuccessfulDeposit(
    deposit: DepositTransaction,
    notificationData: any, // ✅ Changed from MidtransWebhookDto to any (plain object)
  ) {
    const db = this.firebaseService.getFirestore();
    const timestamp = new Date().toISOString();

    try {
      // ✅ FIX: Use plain object instead of DTO instance
      await db.collection('deposit_transactions').doc(deposit.id).update({
        status: 'success',
        transaction_id: notificationData.transaction_id,
        payment_type: notificationData.payment_type,
        completedAt: timestamp,
        updatedAt: timestamp,
        midtrans_response: notificationData, // ✅ Plain object, not DTO
      });

      await this.balanceService.createBalanceEntry(
        deposit.user_id,
        {
          accountType: BALANCE_ACCOUNT_TYPE.REAL,
          type: BALANCE_TYPES.DEPOSIT,
          amount: deposit.amount,
          description: `Credit via ${notificationData.payment_type} - ${deposit.order_id}`,
        },
        true
      );

      const statusUpdate = await this.userStatusService.updateUserStatus(deposit.user_id);
      
      if (statusUpdate.changed) {
        this.logger.log(
          `🎉 User status upgraded: ${statusUpdate.oldStatus.toUpperCase()} → ${statusUpdate.newStatus.toUpperCase()}`
        );
      }

      this.logger.log(
        `✅ Payment SUCCESS: ${deposit.order_id}\n` +
        `   User: ${deposit.userEmail}\n` +
        `   Amount: Rp ${deposit.amount.toLocaleString()}\n` +
        `   Payment: ${notificationData.payment_type}\n` +
        `   Status Upgrade: ${statusUpdate.changed ? 'YES' : 'NO'}`
      );

    } catch (error) {
      this.logger.error(`❌ processSuccessfulDeposit error: ${error.message}`);
      throw error;
    }
  }

  private async processFailedDeposit(
    deposit: DepositTransaction,
    notificationData: any, // ✅ Plain object
  ) {
    const db = this.firebaseService.getFirestore();
    const timestamp = new Date().toISOString();

    try {
      await db.collection('deposit_transactions').doc(deposit.id).update({
        status: 'failed',
        transaction_id: notificationData.transaction_id,
        payment_type: notificationData.payment_type,
        updatedAt: timestamp,
        midtrans_response: notificationData, // ✅ Plain object
      });

      this.logger.log(
        `❌ Payment FAILED: ${deposit.order_id}\n` +
        `   User: ${deposit.userEmail}\n` +
        `   Amount: Rp ${deposit.amount.toLocaleString()}\n` +
        `   Reason: ${notificationData.transaction_status}`
      );

    } catch (error) {
      this.logger.error(`❌ processFailedDeposit error: ${error.message}`);
      throw error;
    }
  }

  private async processPendingDeposit(
    deposit: DepositTransaction,
    notificationData: any, // ✅ Plain object
  ) {
    const db = this.firebaseService.getFirestore();

    try {
      await db.collection('deposit_transactions').doc(deposit.id).update({
        transaction_id: notificationData.transaction_id,
        payment_type: notificationData.payment_type,
        updatedAt: new Date().toISOString(),
        midtrans_response: notificationData, // ✅ Plain object
      });

      this.logger.log(`⏳ Payment PENDING: ${deposit.order_id}`);

    } catch (error) {
      this.logger.error(`❌ processPendingDeposit error: ${error.message}`);
      throw error;
    }
  }

  private verifySignature(notification: MidtransWebhookDto): boolean {
    const serverKey = this.configService.get('midtrans.serverKey');
    const orderId = notification.order_id;
    const statusCode = notification.status_code;
    const grossAmount = notification.gross_amount;
    const signatureKey = notification.signature_key;

    const hash = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
      .digest('hex');

    return hash === signatureKey;
  }

  async getUserDeposits(userId: string) {
    const db = this.firebaseService.getFirestore();

    try {
      const snapshot = await db
        .collection('deposit_transactions')
        .where('user_id', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      const deposits = snapshot.docs.map(doc => {
        const data = doc.data() as DepositTransaction;
        return {
          id: data.id,
          order_id: data.order_id,
          amount: data.amount,
          status: data.status,
          payment_type: data.payment_type,
          description: data.description,
          createdAt: data.createdAt,
          completedAt: data.completedAt,
        };
      });

      return {
        deposits,
        summary: {
          total: deposits.length,
          success: deposits.filter(d => d.status === 'success').length,
          pending: deposits.filter(d => d.status === 'pending').length,
          failed: deposits.filter(d => d.status === 'failed').length,
        },
      };

    } catch (error) {
      this.logger.error(`❌ getUserDeposits error: ${error.message}`);
      throw error;
    }
  }

  async checkDepositStatus(userId: string, orderId: string) {
    const db = this.firebaseService.getFirestore();

    try {
      const snapshot = await db
        .collection('deposit_transactions')
        .where('order_id', '==', orderId)
        .where('user_id', '==', userId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        throw new NotFoundException('Transaction not found');
      }

      const deposit = snapshot.docs[0].data() as DepositTransaction;

      let midtransStatus: any;
      try {
        midtransStatus = await this.coreApi.transaction.status(orderId);
      } catch (error: any) {
        this.logger.warn(`⚠️ Failed to get Midtrans status: ${error.message}`);
        midtransStatus = { error: 'Failed to get status from payment gateway' };
      }

      return {
        deposit: {
          id: deposit.id,
          order_id: deposit.order_id,
          amount: deposit.amount,
          status: deposit.status,
          payment_type: deposit.payment_type,
          createdAt: deposit.createdAt,
          completedAt: deposit.completedAt,
        },
        midtrans_status: midtransStatus,
      };

    } catch (error) {
      this.logger.error(`❌ checkDepositStatus error: ${error.message}`);
      throw error;
    }
  }
}