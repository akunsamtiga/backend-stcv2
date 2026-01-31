// src/order-schedule/dto/update-order-schedule.dto.ts

import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateOrderScheduleDto, ScheduleStatus } from './create-order-schedule.dto';

export class UpdateOrderScheduleDto extends PartialType(CreateOrderScheduleDto) {
  @ApiPropertyOptional({ 
    enum: ScheduleStatus,
    example: ScheduleStatus.PAUSED,
    description: 'Update status schedule'
  })
  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;
}