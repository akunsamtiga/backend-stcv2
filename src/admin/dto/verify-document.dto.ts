// src/admin/dto/verify-document.dto.ts

import { IsBoolean, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyDocumentDto {
  @ApiProperty({ 
    example: true,
    description: 'Approve (true) or reject (false) verification'
  })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ 
    example: 'Document verified successfully',
    description: 'Admin notes (optional)'
  })
  @IsOptional()
  @IsString()
  adminNotes?: string;

  @ApiPropertyOptional({ 
    example: 'Document unclear or invalid',
    description: 'Rejection reason (required if approve = false)'
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}