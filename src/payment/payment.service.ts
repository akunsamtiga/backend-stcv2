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
    const isProduction = this.configService.get('midtrans.isProduction');
    const serverKey = this.configService.get('midtrans.serverKey');
    const clientKey = this.configService.get('midtrans.clientKey');

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

    this.logger.log(
      `✅ Midtrans initialized (${isProduction ? 'PRODUCTION' : 'SANDBOX'})`
    );
  }

  // ============================================
  // CREATE DEPOSIT REQUEST
  // ============================================

  async createDeposit(userId: string, createDepositDto: CreateDepositDto) {
    const db = this.firebaseService.getFirestore();

    try {
      const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const user = userDoc.data() as User;

      const timestamp = Date.now();
      const orderId = `DEPOSIT-${userId.substring(0, 8)}-${timestamp}`;

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

      const parameter = {
        transaction_details: {
          order_id: orderId,
          gross_amount: createDepositDto.amount,
        },
        customer_details: {
          first_name: user.profile?.fullName || user.email.split('@')[0],
          email: user.email,
          phone: user.profile?.phoneNumber || '',
        },
        item_details: [
          {
            id: 'DEPOSIT',
            price: createDepositDto.amount,
            quantity: 1,
            name: 'Trading Account Deposit',
          },
        ],
        callbacks: {
          finish: `${this.configService.get('cors.origin').split(',')[0]}/deposit/success`,
          error: `${this.configService.get('cors.origin').split(',')[0]}/deposit/failed`,
          pending: `${this.configService.get('cors.origin').split(',')[0]}/deposit/pending`,
        },
      };

      const transaction = await this.snap.createTransaction(parameter);

      await db.collection('deposit_transactions').doc(depositId).update({
        snap_token: transaction.token,
        snap_redirect_url: transaction.redirect_url,
        updatedAt: new Date().toISOString(),
        midtrans_response: transaction,
      });

      this.logger.log(
        `✅ Deposit created: ${orderId} - User: ${userId} - Amount: Rp ${createDepositDto.amount.toLocaleString()}`
      );

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

    } catch (error) {
      this.logger.error(`❌ createDeposit error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // MIDTRANS WEBHOOK HANDLER
  // ============================================

  async handleWebhook(notification: MidtransWebhookDto) {
    const db = this.firebaseService.getFirestore();

    try {
      // 1. Verify signature
      if (!this.verifySignature(notification)) {
        throw new BadRequestException('Invalid signature');
      }

      const orderId = notification.order_id;
      const transactionStatus = notification.transaction_status;
      const fraudStatus = notification.fraud_status;

      this.logger.log(
        `📥 Webhook received: ${orderId} - Status: ${transactionStatus}`
      );

      // 2. Get deposit transaction
      const depositSnapshot = await db
        .collection('deposit_transactions')
        .where('order_id', '==', orderId)
        .limit(1)
        .get();

      if (depositSnapshot.empty) {
        throw new NotFoundException(`Deposit transaction not found: ${orderId}`);
      }

      const depositDoc = depositSnapshot.docs[0];
      const deposit = depositDoc.data() as DepositTransaction;

      // 3. Prevent duplicate processing
      if (deposit.status === 'success') {
        this.logger.warn(`⚠️ Duplicate webhook: ${orderId} already processed`);
        return { message: 'Transaction already processed' };
      }

      // 4. Process based on status
      if (transactionStatus === 'capture') {
        if (fraudStatus === 'accept') {
          await this.processSuccessfulDeposit(deposit, notification);
        }
      } else if (transactionStatus === 'settlement') {
        await this.processSuccessfulDeposit(deposit, notification);
      } else if (
        transactionStatus === 'cancel' ||
        transactionStatus === 'deny' ||
        transactionStatus === 'expire'
      ) {
        await this.processFailedDeposit(deposit, notification);
      } else if (transactionStatus === 'pending') {
        await this.processPendingDeposit(deposit, notification);
      }

      return { message: 'Webhook processed successfully' };

    } catch (error) {
      this.logger.error(`❌ handleWebhook error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // PROCESS SUCCESSFUL DEPOSIT
  // ============================================

  private async processSuccessfulDeposit(
    deposit: DepositTransaction,
    notification: MidtransWebhookDto,
  ) {
    const db = this.firebaseService.getFirestore();
    const timestamp = new Date().toISOString();

    try {
      // 1. Update deposit status
      await db.collection('deposit_transactions').doc(deposit.id).update({
        status: 'success',
        transaction_id: notification.transaction_id,
        payment_type: notification.payment_type,
        completedAt: timestamp,
        updatedAt: timestamp,
        midtrans_response: notification,
      });

      // 2. Credit balance
      await this.balanceService.createBalanceEntry(
        deposit.user_id,
        {
          accountType: BALANCE_ACCOUNT_TYPE.REAL,
          type: BALANCE_TYPES.DEPOSIT,
          amount: deposit.amount,
          description: `Deposit via Midtrans - ${notification.payment_type} - ${deposit.order_id}`,
        },
        true
      );

      // 3. Update user status (if eligible)
      const statusUpdate = await this.userStatusService.updateUserStatus(deposit.user_id);
      
      if (statusUpdate.changed) {
        this.logger.log(
          `🎉 User status upgraded: ${statusUpdate.oldStatus.toUpperCase()} → ${statusUpdate.newStatus.toUpperCase()}`
        );
      }

      this.logger.log(
        `✅ Deposit SUCCESS: ${deposit.order_id}\n` +
        `   User: ${deposit.userEmail}\n` +
        `   Amount: Rp ${deposit.amount.toLocaleString()}\n` +
        `   Payment: ${notification.payment_type}\n` +
        `   Status Upgrade: ${statusUpdate.changed ? 'YES' : 'NO'}`
      );

    } catch (error) {
      this.logger.error(`❌ processSuccessfulDeposit error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // PROCESS FAILED DEPOSIT
  // ============================================

  private async processFailedDeposit(
    deposit: DepositTransaction,
    notification: MidtransWebhookDto,
  ) {
    const db = this.firebaseService.getFirestore();
    const timestamp = new Date().toISOString();

    try {
      await db.collection('deposit_transactions').doc(deposit.id).update({
        status: 'failed',
        transaction_id: notification.transaction_id,
        payment_type: notification.payment_type,
        updatedAt: timestamp,
        midtrans_response: notification,
      });

      this.logger.log(
        `❌ Deposit FAILED: ${deposit.order_id}\n` +
        `   User: ${deposit.userEmail}\n` +
        `   Amount: Rp ${deposit.amount.toLocaleString()}\n` +
        `   Reason: ${notification.transaction_status}`
      );

    } catch (error) {
      this.logger.error(`❌ processFailedDeposit error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // PROCESS PENDING DEPOSIT
  // ============================================

  private async processPendingDeposit(
    deposit: DepositTransaction,
    notification: MidtransWebhookDto,
  ) {
    const db = this.firebaseService.getFirestore();

    try {
      await db.collection('deposit_transactions').doc(deposit.id).update({
        transaction_id: notification.transaction_id,
        payment_type: notification.payment_type,
        updatedAt: new Date().toISOString(),
        midtrans_response: notification,
      });

      this.logger.log(`⏳ Deposit PENDING: ${deposit.order_id}`);

    } catch (error) {
      this.logger.error(`❌ processPendingDeposit error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // VERIFY SIGNATURE
  // ============================================

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

  // ============================================
  // GET USER DEPOSITS
  // ============================================

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

  // ============================================
  // CHECK DEPOSIT STATUS
  // ============================================

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
        throw new NotFoundException('Deposit not found');
      }

      const deposit = snapshot.docs[0].data() as DepositTransaction;

      // Check real-time status from Midtrans
      const status = await this.coreApi.transaction.status(orderId);

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
        midtrans_status: status,
      };

    } catch (error) {
      this.logger.error(`❌ checkDepositStatus error: ${error.message}`);
      throw error;
    }
  }
}