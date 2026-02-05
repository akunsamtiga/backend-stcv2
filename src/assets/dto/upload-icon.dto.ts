// src/assets/dto/upload-icon.dto.ts
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadIconDto {
  @ApiProperty({ 
    example: 'data:image/png;base64,iVBORw0KGgo...',
    description: 'Base64 encoded image or URL (max 10MB). Supported formats: png, jpg, jpeg, gif, webp, svg'
  })
  @IsString()
  @IsNotEmpty({ message: 'Icon cannot be empty' })
  @MaxLength(10000000, { message: 'Icon size exceeds maximum allowed (10MB)' }) 
  icon: string;
}