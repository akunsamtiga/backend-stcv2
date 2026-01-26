export class VoucherValidationResponse {
  valid: boolean;
  voucher?: {
    code: string;
    type: 'percentage' | 'fixed';
    value: number;
    minDeposit: number;
    bonusAmount: number;
    description?: string;
  };
  message?: string;
}