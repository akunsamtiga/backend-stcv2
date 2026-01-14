// src/admin/dto/create-user.dto.ts
import { IsEmail, IsString, IsEnum, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { USER_ROLES } from '../../common/constants';

export class CreateUserDto {
  @ApiProperty({ example: 'admin@trading.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain uppercase, lowercase, and number/special character',
  })
  password: string;

  @ApiProperty({ enum: USER_ROLES, example: 'admin' })
  @IsEnum(USER_ROLES)
  role: string;
}
