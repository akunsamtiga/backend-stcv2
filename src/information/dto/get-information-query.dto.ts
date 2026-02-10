// src/information/dto/get-information-query.dto.ts

import { IsOptional, IsInt, Min, Max, IsBoolean, IsEnum, IsString } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InformationType, InformationPriority } from './create-information.dto';

export class GetInformationQueryDto {
  @ApiPropertyOptional({ 
    default: 1,
    description: 'Nomor halaman'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ 
    default: 20,
    description: 'Jumlah item per halaman'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ 
    description: 'Filter berdasarkan status aktif',
    type: Boolean
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ 
    description: 'Filter berdasarkan pinned',
    type: Boolean
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isPinned?: boolean;

  @ApiPropertyOptional({ 
    enum: InformationType,
    description: 'Filter berdasarkan tipe informasi'
  })
  @IsOptional()
  @IsEnum(InformationType)
  type?: InformationType;

  @ApiPropertyOptional({ 
    enum: InformationPriority,
    description: 'Filter berdasarkan prioritas'
  })
  @IsOptional()
  @IsEnum(InformationPriority)
  priority?: InformationPriority;

  @ApiPropertyOptional({ 
    description: 'Pencarian berdasarkan judul atau deskripsi'
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ 
    enum: ['createdAt', 'updatedAt', 'publishDate', 'title', 'priority'],
    default: 'createdAt',
    description: 'Sorting berdasarkan field'
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ 
    enum: ['asc', 'desc'],
    default: 'desc',
    description: 'Urutan sorting'
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}