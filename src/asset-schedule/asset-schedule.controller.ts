// src/asset-schedule/asset-schedule.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';
import { USER_ROLES } from '../common/constants';
import { AssetScheduleService } from './asset-schedule.service';
import { CreateAssetScheduleDto } from './dto/create-asset-schedule.dto';
import { UpdateAssetScheduleDto } from './dto/update-asset-schedule.dto';
import { GetAssetSchedulesQueryDto } from './dto/get-asset-schedules-query.dto';

@ApiTags('asset-schedule')
@Controller('asset-schedule')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AssetScheduleController {
  constructor(private readonly assetScheduleService: AssetScheduleService) {}

  // ============================================
  // CREATE SCHEDULE
  // ============================================

  @Post()
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Create new asset schedule (Admin/Super Admin only)',
    description: 'Schedule when an asset will trend up (buy) or down (sell) at specific time and timeframe',
  })
  @ApiResponse({
    status: 201,
    description: 'Schedule created successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'schedule_123',
          assetSymbol: 'BTCUSD',
          scheduledTime: '2024-02-01T12:14:00.000Z',
          trend: 'sell',
          timeframe: '1m',
          notes: 'Schedule untuk manipulasi market',
          isActive: true,
          status: 'pending',
          createdBy: 'admin_123',
          createdByEmail: 'admin@trading.com',
          createdAt: '2024-01-30T10:00:00.000Z',
          updatedAt: '2024-01-30T10:00:00.000Z',
        },
        message: 'Asset schedule created successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid data or scheduled time in the past',
  })
  @ApiResponse({
    status: 404,
    description: 'Asset not found or inactive',
  })
  async createSchedule(
    @Body() createDto: CreateAssetScheduleDto,
    @CurrentUser() user: any,
  ) {
    return this.assetScheduleService.createSchedule(
      createDto,
      user.uid,
      user.email,
    );
  }

  // ============================================
  // GET ALL SCHEDULES
  // ============================================

  @Get()
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Get all asset schedules with filters (Admin/Super Admin only)',
    description: 'Retrieve all asset schedules with optional filtering and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Schedules retrieved successfully',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'schedule_123',
            assetSymbol: 'BTCUSD',
            scheduledTime: '2024-02-01T12:14:00.000Z',
            trend: 'sell',
            timeframe: '1m',
            notes: 'Schedule untuk manipulasi market',
            isActive: true,
            status: 'pending',
            createdBy: 'admin_123',
            createdByEmail: 'admin@trading.com',
            createdAt: '2024-01-30T10:00:00.000Z',
            updatedAt: '2024-01-30T10:00:00.000Z',
          },
        ],
        pagination: {
          page: 1,
          limit: 50,
          total: 100,
          totalPages: 2,
        },
      },
    },
  })
  async getSchedules(@Query() queryDto: GetAssetSchedulesQueryDto) {
    return this.assetScheduleService.getSchedules(queryDto);
  }

  // ============================================
  // GET SCHEDULE BY ID
  // ============================================

  @Get(':id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Get schedule by ID (Admin/Super Admin only)',
    description: 'Retrieve specific schedule details',
  })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({
    status: 200,
    description: 'Schedule retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Schedule not found',
  })
  async getScheduleById(@Param('id') id: string) {
    return this.assetScheduleService.getScheduleById(id);
  }

  // ============================================
  // GET UPCOMING SCHEDULES
  // ============================================

  @Get('upcoming/next-24h')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Get upcoming schedules (next 24 hours) (Admin/Super Admin only)',
    description: 'Retrieve all pending schedules that will be executed in the next 24 hours',
  })
  @ApiResponse({
    status: 200,
    description: 'Upcoming schedules retrieved successfully',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'schedule_123',
            assetSymbol: 'BTCUSD',
            scheduledTime: '2024-01-31T12:14:00.000Z',
            trend: 'sell',
            timeframe: '1m',
            status: 'pending',
          },
        ],
        total: 5,
      },
    },
  })
  async getUpcomingSchedules() {
    return this.assetScheduleService.getUpcomingSchedules();
  }

  // ============================================
  // GET STATISTICS
  // ============================================

  @Get('stats/overview')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Get schedule statistics (Admin/Super Admin only)',
    description: 'Get overview of all schedules with status breakdown',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          total: 150,
          todayTotal: 10,
          pending: 25,
          executed: 100,
          failed: 5,
          cancelled: 20,
        },
      },
    },
  })
  async getStatistics() {
    return this.assetScheduleService.getStatistics();
  }

  // ============================================
  // UPDATE SCHEDULE
  // ============================================

  @Put(':id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Update asset schedule (Admin/Super Admin only)',
    description: 'Update pending schedule details. Cannot update executed or failed schedules.',
  })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({
    status: 200,
    description: 'Schedule updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot update executed/failed schedule',
  })
  @ApiResponse({
    status: 404,
    description: 'Schedule not found',
  })
  async updateSchedule(
    @Param('id') id: string,
    @Body() updateDto: UpdateAssetScheduleDto,
    @CurrentUser() user: any,
  ) {
    return this.assetScheduleService.updateSchedule(id, updateDto, user.uid);
  }

  // ============================================
  // CANCEL SCHEDULE
  // ============================================

  @Put(':id/cancel')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel pending schedule (Admin/Super Admin only)',
    description: 'Cancel a pending schedule. Cannot cancel executed or failed schedules.',
  })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({
    status: 200,
    description: 'Schedule cancelled successfully',
    schema: {
      example: {
        success: true,
        message: 'Schedule cancelled successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot cancel non-pending schedule',
  })
  @ApiResponse({
    status: 404,
    description: 'Schedule not found',
  })
  async cancelSchedule(@Param('id') id: string) {
    return this.assetScheduleService.cancelSchedule(id);
  }

  // ============================================
  // DELETE SCHEDULE
  // ============================================

  @Delete(':id')
  @Roles(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete asset schedule (Admin/Super Admin only)',
    description: 'Permanently delete a schedule from the database',
  })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({
    status: 200,
    description: 'Schedule deleted successfully',
    schema: {
      example: {
        success: true,
        message: 'Schedule deleted successfully',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Schedule not found',
  })
  async deleteSchedule(@Param('id') id: string) {
    return this.assetScheduleService.deleteSchedule(id);
  }
}