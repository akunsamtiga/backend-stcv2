// src/assets/dto/upload-icon.dto.ts
import { IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadIconDto {
  @ApiProperty({ 
    example: 'data:image/png;base64,iVBORw0KGgo...',
    description: 'Base64 encoded image or URL (max 5MB). Supported formats: png, jpg, jpeg, gif, webp, svg'
  })
  @IsString()
  @MaxLength(7000000) // ~5MB base64
  @Matches(
    /^(https?:\/\/.+|data:image\/(png|jpg|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*)$/,
    {
      message: 'Icon must be a valid URL or base64 image data (png, jpg, jpeg, gif, webp, svg)',
    }
  )
  icon: string; // Changed from iconUrl to icon for consistency
}