import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MidtransWebhookDto {
  @ApiProperty({ 
    example: '2024-01-26 10:30:00',
    description: 'Transaction time from Midtrans'
  })
  @IsString()
  transaction_time: string;

  @ApiProperty({ 
    example: 'settlement',
    description: 'Transaction status: capture, settlement, pending, deny, cancel, expire'
  })
  @IsString()
  transaction_status: string;

  @ApiProperty({ 
    example: 'abc123xyz',
    description: 'Unique transaction ID from Midtrans'
  })
  @IsString()
  transaction_id: string;

  @ApiProperty({ 
    example: 'midtrans payment notification',
    description: 'Status message from Midtrans'
  })
  @IsString()
  status_message: string;

  @ApiProperty({ 
    example: '200',
    description: 'HTTP status code'
  })
  @IsString()
  status_code: string;

  @ApiProperty({ 
    example: 'abc123...',
    description: 'SHA512 signature for verification'
  })
  @IsString()
  signature_key: string;

  @ApiProperty({ 
    example: 'gopay',
    description: 'Payment method: credit_card, gopay, bank_transfer, etc'
  })
  @IsString()
  payment_type: string;

  @ApiProperty({ 
    example: 'DEPOSIT-123-1234567890',
    description: 'Order ID from your system'
  })
  @IsString()
  order_id: string;

  @ApiProperty({ 
    example: 'G933954115',
    description: 'Your Midtrans merchant ID'
  })
  @IsString()
  merchant_id: string;

  @ApiProperty({ 
    example: '100000',
    description: 'Transaction amount'
  })
  @IsString()
  gross_amount: string;

  @ApiPropertyOptional({ 
    example: 'accept',
    description: 'Fraud detection status: accept, challenge, deny'
  })
  @IsOptional()
  @IsString()
  fraud_status?: string;

  @ApiPropertyOptional({ 
    example: 'IDR',
    description: 'Currency code'
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ 
    example: 'mandiri',
    description: 'Acquiring bank'
  })
  @IsOptional()
  @IsString()
  acquirer?: string;

  @ApiPropertyOptional({ 
    example: '2024-01-26 10:35:00',
    description: 'Settlement time'
  })
  @IsOptional()
  @IsString()
  settlement_time?: string;
}