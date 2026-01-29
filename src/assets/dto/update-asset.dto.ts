// src/assets/dto/update-asset.dto.ts
import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateAssetDto } from './create-asset.dto';

export class UpdateAssetDto extends PartialType(
  OmitType(CreateAssetDto, ['symbol'] as const)
) {}