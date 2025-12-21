import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { FirebaseService, BatchOperation } from '../firebase/firebase.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { QueryBalanceDto } from './dto/query-balance.dto';
import { COLLECTIONS, BALANCE_TYPES } from '../common/constants';
import { CalculationUtil } from '../common/utils';
import { Balance } from '../common/interfaces';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(private firebaseService: FirebaseService) {}

  async createBalanceEntry(userId: string, createBalanceDto: CreateBalanceDto) {
    const db = this.firebaseService.getFirestore();

    if (createBalanceDto.type === BALANCE_TYPES.WITHDRAWAL) {
      const currentBalance = await this.getCurrentBalance(userId);
      if (currentBalance < createBalanceDto.amount) {
        throw new BadRequestException('Insufficient balance for withdrawal');
      }
    }

    const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
    const balanceData = {
      id: balanceId,
      user_id: userId,
      type: createBalanceDto.type,
      amount: createBalanceDto.amount,
      description: createBalanceDto.description || '',
      createdAt: new Date().toISOString(),
    };

    await db.collection(COLLECTIONS.BALANCE).doc(balanceId).set(balanceData);

    const currentBalance = await this.getCurrentBalance(userId);

    this.logger.log(`Balance updated for user ${userId}: ${createBalanceDto.type} ${createBalanceDto.amount}`);

    return {
      message: 'Balance transaction recorded successfully',
      transaction: balanceData,
      currentBalance,
    };
  }

  async createMultipleBalanceEntries(
    userId: string,
    entries: CreateBalanceDto[],
  ) {
    const db = this.firebaseService.getFirestore();

    // Check balance for withdrawals
    const currentBalance = await this.getCurrentBalance(userId);
    const totalWithdrawals = entries
      .filter(e => e.type === BALANCE_TYPES.WITHDRAWAL)
      .reduce((sum, e) => sum + e.amount, 0);

    if (totalWithdrawals > currentBalance) {
      throw new BadRequestException('Insufficient balance for withdrawals');
    }

    // Prepare batch operations
    const operations: BatchOperation[] = [];
    const timestamp = new Date().toISOString();

    for (const entry of entries) {
      const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);
      
      operations.push({
        type: 'set',
        collection: COLLECTIONS.BALANCE,
        docId: balanceId,
        data: {
          id: balanceId,
          user_id: userId,
          type: entry.type,
          amount: entry.amount,
          description: entry.description || '',
          createdAt: timestamp,
        },
      });
    }

    // Execute batch write
    await this.firebaseService.batchWrite(operations);

    const newBalance = await this.getCurrentBalance(userId);

    this.logger.log(`Batch balance update for user ${userId}: ${entries.length} entries`);

    return {
      message: `${entries.length} balance transactions recorded successfully`,
      newBalance,
    };
  }

  async getCurrentBalance(userId: string): Promise<number> {
    const db = this.firebaseService.getFirestore();

    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .get();

    const transactions = snapshot.docs.map(doc => doc.data() as Balance);
    return CalculationUtil.calculateBalance(transactions);
  }

  async getBalanceHistory(userId: string, queryDto: QueryBalanceDto) {
    const db = this.firebaseService.getFirestore();
    const { page = 1, limit = 20 } = queryDto;

    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const allTransactions = snapshot.docs.map(doc => doc.data() as Balance);
    const total = allTransactions.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const transactions = allTransactions.slice(startIndex, endIndex);

    const currentBalance = await this.getCurrentBalance(userId);

    return {
      currentBalance,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getBalanceSummary(userId: string) {
    const db = this.firebaseService.getFirestore();

    const snapshot = await db.collection(COLLECTIONS.BALANCE)
      .where('user_id', '==', userId)
      .get();

    const transactions = snapshot.docs.map(doc => doc.data() as Balance);

    const summary = {
      currentBalance: CalculationUtil.calculateBalance(transactions),
      totalDeposits: transactions
        .filter(t => t.type === BALANCE_TYPES.DEPOSIT)
        .reduce((sum, t) => sum + t.amount, 0),
      totalWithdrawals: transactions
        .filter(t => t.type === BALANCE_TYPES.WITHDRAWAL)
        .reduce((sum, t) => sum + t.amount, 0),
      totalWins: transactions
        .filter(t => t.type === BALANCE_TYPES.WIN)
        .reduce((sum, t) => sum + t.amount, 0),
      totalLosses: transactions
        .filter(t => t.type === BALANCE_TYPES.LOSE)
        .reduce((sum, t) => sum + t.amount, 0),
      transactionCount: transactions.length,
    };

    return summary;
  }

  /**
   * Bulk create balance entries with batch write
   * Used internally by other services (e.g., binary orders settlement)
   */
  async bulkCreateBalanceEntries(
    entries: Array<{
      userId: string;
      type: string;
      amount: number;
      description: string;
    }>,
  ): Promise<void> {
    const operations: BatchOperation[] = [];
    const timestamp = new Date().toISOString();

    for (const entry of entries) {
      const balanceId = await this.firebaseService.generateId(COLLECTIONS.BALANCE);

      operations.push({
        type: 'set',
        collection: COLLECTIONS.BALANCE,
        docId: balanceId,
        data: {
          id: balanceId,
          user_id: entry.userId,
          type: entry.type,
          amount: entry.amount,
          description: entry.description,
          createdAt: timestamp,
        },
      });
    }

    await this.firebaseService.batchWrite(operations);
    this.logger.log(`Bulk created ${entries.length} balance entries`);
  }
}
