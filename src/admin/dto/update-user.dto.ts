// src/admin/dto/update-user.dto.ts
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { USER_ROLES } from '../../common/constants';

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: USER_ROLES })
  @IsOptional()
  @IsEnum(USER_ROLES)
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
