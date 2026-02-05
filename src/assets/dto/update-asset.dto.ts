// src/assets/dto/update-asset.dto.ts
import { PartialType, OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAssetDto } from './create-asset.dto';
import { IsString, IsOptional, MaxLength } from 'class-validator';

class UpdateAssetDtoBase extends PartialType(
  OmitType(CreateAssetDto, ['symbol', 'icon'] as const)
) {}

export class UpdateAssetDto extends UpdateAssetDtoBase {
  @ApiPropertyOptional({ 
    example: 'https://example.com/icons/btc.png OR data:image/png;base64,iVBORw0KGgo...',
    description: 'Asset icon - URL or base64 image (max 10MB when encoded). Accepts: png, jpg, jpeg, gif, webp, svg'
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000000) 
  icon?: string;
}