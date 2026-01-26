// src/payment/payment.service.ts - ENHANCED VERSION

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
        throw new Error('Midtrans configuration incomplete');
      }

      this.logger.log('🔧 Initializing Midtrans...');
      this.logger.log(`   Mode: ${isProduction ? 'PRODUCTION' : 'SANDBOX'}`);

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

      this.logger.log(`✅ Midtrans initialized`);
    } catch (error) {
      this.logger.error('❌ Failed to initialize Midtrans:', error.message);
      throw error;
    }
  }

  async createDeposit(userId: string, createDepositDto: CreateDepositDto) {
    const db = this.firebaseService.getFirestore();

    try {
      this.logger.log('🔥 Creating deposit transaction...');
      this.logger.log(`   User: ${userId}`);
      this.logger.log(`   Amount: Rp ${createDepositDto.amount.toLocaleString()}`);

      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;
      
      if (!user.email) {
        throw new BadRequestException('User email is required');
      }

      const timestamp = Date.now();
      const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
      const orderId = `DEPOSIT-${userId.substring(0, 6)}-${timestamp}`;

      const depositId = await this.firebaseService.generateId('deposit_transactions');
      const depositTransaction: DepositTransaction = {
        id: depositId,
        user_id: userId,
        order_id: orderId,
        amount: createDepositDto.amount,
        status: 'pending',
        description: createDepositDto.description || 'Deposit to real account',
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
            id: 'REAL_DEPOSIT',
            price: createDepositDto.amount,
            quantity: 1,
            name: 'Real Account Deposit',
          },
        ],
        callbacks: {
          finish: `${this.getFrontendUrl()}/payment/success`,
          error: `${this.getFrontendUrl()}/payment/failed`,
          pending: `${this.getFrontendUrl()}/payment/pending`,
        },
      };

      this.logger.log('📄 Creating Snap transaction...');
      const transaction = await this.snap.createTransaction(parameter);

      await db.collection('deposit_transactions').doc(depositId).update({
        snap_token: transaction.token,
        snap_redirect_url: transaction.redirect_url,
        updatedAt: new Date().toISOString(),
        midtrans_response: transaction,
      });

      this.logger.log(`✅ Deposit created: ${orderId}`);

      return {
        message: 'Deposit transaction created successfully',
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
      throw error;
    }
  }

  private getFrontendUrl(): string {
    return this.configService.get('frontend.url') || 'http://localhost:3000';
  }

  async handleWebhook(notification: MidtransWebhookDto) {
    const db = this.firebaseService.getFirestore();

    try {
      // ✅ LOG WEBHOOK RECEIVED
      this.logger.log('🔔 ========================================');
      this.logger.log('🔔 MIDTRANS WEBHOOK RECEIVED');
      this.logger.log('🔔 ========================================');
      this.logger.log(`   Order ID: ${notification.order_id || 'MISSING'}`);
      this.logger.log(`   Transaction Status: ${notification.transaction_status || 'MISSING'}`);
      this.logger.log(`   Payment Type: ${notification.payment_type || 'MISSING'}`);
      this.logger.log(`   Gross Amount: ${notification.gross_amount || 'MISSING'}`);
      this.logger.log(`   Transaction ID: ${notification.transaction_id || 'MISSING'}`);
      this.logger.log('🔔 ========================================');

      // ✅ VALIDATE REQUIRED FIELDS
      if (!notification.order_id || !notification.transaction_status || !notification.gross_amount || !notification.signature_key) {
        this.logger.error('❌ Missing required webhook fields!');
        throw new BadRequestException('Missing required webhook fields');
      }

      const notificationData = this.dtoToPlainObject(notification);

      // ✅ VERIFY SIGNATURE
      if (!this.verifySignature(notification)) {
        this.logger.error('❌ Invalid signature!');
        throw new BadRequestException('Invalid signature');
      }
      this.logger.log('✅ Signature verified');

      const orderId = notification.order_id;
      const transactionStatus = notification.transaction_status;
      const fraudStatus = notification.fraud_status || 'accept'; // ✅ Default value

      // ✅ FIND TRANSACTION
      const depositSnapshot = await db
        .collection('deposit_transactions')
        .where('order_id', '==', orderId)
        .limit(1)
        .get();

      if (depositSnapshot.empty) {
        this.logger.error(`❌ Transaction not found: ${orderId}`);
        throw new NotFoundException(`Transaction not found: ${orderId}`);
      }

      const depositDoc = depositSnapshot.docs[0];
      const deposit = depositDoc.data() as DepositTransaction;

      this.logger.log(`📦 Transaction found: ${deposit.id}`);
      this.logger.log(`   User: ${deposit.user_id}`);
      this.logger.log(`   Amount: Rp ${deposit.amount.toLocaleString()}`);
      this.logger.log(`   Current Status: ${deposit.status}`);

      // ✅ CHECK IF ALREADY PROCESSED
      if (deposit.status === 'success') {
        this.logger.warn(`⚠️ Duplicate webhook: ${orderId} already processed`);
        return { message: 'Transaction already processed' };
      }

      // ✅ PROCESS BASED ON STATUS
      if (transactionStatus === 'capture') {
        if (fraudStatus === 'accept') {
          this.logger.log('✅ Processing CAPTURE (fraud: accept)');
          await this.processSuccessfulDeposit(deposit, notificationData);
        } else {
          this.logger.warn(`⚠️ Fraud status: ${fraudStatus}`);
        }
      } else if (transactionStatus === 'settlement') {
        this.logger.log('✅ Processing SETTLEMENT');
        await this.processSuccessfulDeposit(deposit, notificationData);
      } else if (
        transactionStatus === 'cancel' ||
        transactionStatus === 'deny' ||
        transactionStatus === 'expire'
      ) {
        this.logger.log(`❌ Processing FAILED: ${transactionStatus}`);
        await this.processFailedDeposit(deposit, notificationData);
      } else if (transactionStatus === 'pending') {
        this.logger.log('⏳ Processing PENDING');
        await this.processPendingDeposit(deposit, notificationData);
      }

      this.logger.log('🔔 ========================================');
      this.logger.log('🔔 WEBHOOK PROCESSING COMPLETE');
      this.logger.log('🔔 ========================================');

      return { message: 'Webhook processed successfully' };

    } catch (error) {
      this.logger.error('🔔 ========================================');
      this.logger.error(`❌ handleWebhook error: ${error.message}`);
      this.logger.error('🔔 ========================================');
      throw error;
    }
  }


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
    notificationData: any,
  ) {
    const db = this.firebaseService.getFirestore();
    const timestamp = new Date().toISOString();

    try {
      this.logger.log('💰 ========================================');
      this.logger.log('💰 PROCESSING SUCCESSFUL DEPOSIT');
      this.logger.log('💰 ========================================');
      this.logger.log(`   Order ID: ${deposit.order_id}`);
      this.logger.log(`   User ID: ${deposit.user_id}`);
      this.logger.log(`   Amount: Rp ${deposit.amount.toLocaleString()}`);
      this.logger.log(`   Payment Type: ${notificationData.payment_type}`);

      // Step 1: Update deposit status
      this.logger.log('📝 Step 1: Updating deposit transaction status...');
      await db.collection('deposit_transactions').doc(deposit.id).update({
        status: 'success',
        transaction_id: notificationData.transaction_id,
        payment_type: notificationData.payment_type,
        completedAt: timestamp,
        updatedAt: timestamp,
        midtrans_response: notificationData,
      });
      this.logger.log('✅ Deposit status updated to SUCCESS');

      // Step 2: Create balance entry
      this.logger.log('💵 Step 2: Creating balance entry...');
      await this.balanceService.createBalanceEntry(
        deposit.user_id,
        {
          accountType: BALANCE_ACCOUNT_TYPE.REAL,
          type: BALANCE_TYPES.DEPOSIT,
          amount: deposit.amount,
          description: `Deposit via ${notificationData.payment_type} - ${deposit.order_id}`,
        },
        true,  // critical
        true   // fromMidtrans = true
      );
      this.logger.log('✅ Balance entry created');

      // Step 3: Update user status
      this.logger.log('👤 Step 3: Updating user status...');
      const statusUpdate = await this.userStatusService.updateUserStatus(deposit.user_id);
      
      if (statusUpdate.changed) {
        this.logger.log(
          `🎉 User status upgraded: ${statusUpdate.oldStatus.toUpperCase()} → ${statusUpdate.newStatus.toUpperCase()}`
        );
      } else {
        this.logger.log(`ℹ️ User status unchanged: ${statusUpdate.newStatus.toUpperCase()}`);
      }

      this.logger.log('💰 ========================================');
      this.logger.log('💰 DEPOSIT SUCCESS COMPLETE!');
      this.logger.log('💰 ========================================');
      this.logger.log(`   User: ${deposit.userEmail}`);
      this.logger.log(`   Amount: Rp ${deposit.amount.toLocaleString()}`);
      this.logger.log(`   Payment: ${notificationData.payment_type}`);
      this.logger.log(`   Status Upgrade: ${statusUpdate.changed ? 'YES ✅' : 'NO'}`);
      this.logger.log('💰 ========================================');

    } catch (error) {
      this.logger.error('💰 ========================================');
      this.logger.error(`❌ processSuccessfulDeposit error: ${error.message}`);
      this.logger.error('💰 ========================================');
      throw error;
    }
  }

  private async processFailedDeposit(
    deposit: DepositTransaction,
    notificationData: any,
  ) {
    const db = this.firebaseService.getFirestore();
    const timestamp = new Date().toISOString();

    try {
      await db.collection('deposit_transactions').doc(deposit.id).update({
        status: 'failed',
        transaction_id: notificationData.transaction_id,
        payment_type: notificationData.payment_type,
        updatedAt: timestamp,
        midtrans_response: notificationData,
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
    notificationData: any,
  ) {
    const db = this.firebaseService.getFirestore();

    try {
      await db.collection('deposit_transactions').doc(deposit.id).update({
        transaction_id: notificationData.transaction_id,
        payment_type: notificationData.payment_type,
        updatedAt: new Date().toISOString(),
        midtrans_response: notificationData,
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

    // ✅ LOG DETAIL UNTUK DEBUG
    this.logger.log('🔐 ========================================');
    this.logger.log('🔐 VERIFYING SIGNATURE');
    this.logger.log('🔐 ========================================');
    this.logger.log(`   Order ID: ${orderId}`);
    this.logger.log(`   Status Code: ${statusCode}`);
    this.logger.log(`   Gross Amount: ${grossAmount}`);
    this.logger.log(`   Server Key: ${serverKey ? serverKey.substring(0, 10) + '...' : 'MISSING'}`);
    this.logger.log(`   Signature String: ${orderId}${statusCode}${grossAmount}${serverKey}`);

    const hash = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
      .digest('hex');

    const isValid = hash === signatureKey;
    
    if (!isValid) {
      this.logger.error('❌ SIGNATURE MISMATCH!');
      this.logger.error(`   Expected: ${hash}`);
      this.logger.error(`   Received: ${signatureKey}`);
    } else {
      this.logger.log('✅ Signature valid!');
    }

    this.logger.log('🔐 ========================================');

    return isValid;
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