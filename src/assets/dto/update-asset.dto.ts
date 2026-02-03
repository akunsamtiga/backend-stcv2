// src/assets/dto/update-asset.dto.ts
import { PartialType, OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAssetDto } from './create-asset.dto';
import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';

// Create a base DTO without the icon field
class UpdateAssetDtoBase extends PartialType(
  OmitType(CreateAssetDto, ['symbol', 'icon'] as const)
) {}

// Extend with custom icon validation
export class UpdateAssetDto extends UpdateAssetDtoBase {
  @ApiPropertyOptional({ 
    example: 'https://example.com/icons/btc.png OR data:image/png;base64,iVBORw0KGgo...',
    description: 'Asset icon - URL or base64 image (max 5MB when encoded)'
  })
  @IsOptional()
  @IsString()
  @MaxLength(7000000) // ~5MB base64 (base64 is ~1.33x larger than binary)
  @Matches(
    /^(https?:\/\/.+|data:image\/(png|jpg|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*)$/,
    {
      message: 'Icon must be a valid URL or base64 image data (png, jpg, jpeg, gif, webp, svg)',
    }
  )
  icon?: string;
}