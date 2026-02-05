// src/order-schedule/order-schedule.controller.ts

import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete,
  UseGuards,
  Request,
  Query,
  HttpCode,
  HttpStatus
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse, 
  ApiBearerAuth,
  ApiParam,
  ApiQuery
} from '@nestjs/swagger';
import { OrderScheduleService } from './order-schedule.service';
import { OrderScheduleExecutorService } from './order-schedule-executor.service';
import { CreateOrderScheduleDto } from './dto/create-order-schedule.dto';
import { UpdateOrderScheduleDto } from './dto/update-order-schedule.dto';
import { QueryOrderScheduleDto } from './dto/query-order-schedule.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Order Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('order-schedule')
export class OrderScheduleController {
  constructor(
    private readonly orderScheduleService: OrderScheduleService,
    private readonly orderScheduleExecutorService: OrderScheduleExecutorService,
  ) {}

  @Post()
  @ApiOperation({ 
    summary: 'Buat schedule order baru',
    description: 'User membuat jadwal order otomatis dengan pengaturan martingale dan stop loss/profit'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Schedule berhasil dibuat'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - validasi gagal'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized'
  })
  async create(
    @Request() req: any,
    @Body() createOrderScheduleDto: CreateOrderScheduleDto
  ) {
    const userId = req.user.sub;
    const userEmail = req.user.email;
    
    return this.orderScheduleService.create(userId, userEmail, createOrderScheduleDto);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Dapatkan semua schedule milik user',
    description: 'Mendapatkan daftar semua order schedule yang dibuat oleh user dengan filter optional'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Daftar schedule berhasil didapatkan'
  })
  async findAll(
    @Request() req: any,
    @Query() query: QueryOrderScheduleDto
  ) {
    const userId = req.user.sub;
    return this.orderScheduleService.findAll(userId, query);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Dapatkan detail schedule by ID',
    description: 'Mendapatkan detail lengkap dari satu order schedule'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Schedule ID',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Detail schedule berhasil didapatkan'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Schedule tidak ditemukan'
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Forbidden - bukan pemilik schedule'
  })
  async findOne(
    @Request() req: any,
    @Param('id') id: string
  ) {
    const userId = req.user.sub;
    return this.orderScheduleService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ 
    summary: 'Update schedule',
    description: 'Mengupdate pengaturan order schedule. Schedule yang sedang active harus di-pause terlebih dahulu'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Schedule ID'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Schedule berhasil diupdate'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - tidak bisa update schedule yang active'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Schedule tidak ditemukan'
  })
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() updateOrderScheduleDto: UpdateOrderScheduleDto
  ) {
    const userId = req.user.sub;
    return this.orderScheduleService.update(userId, id, updateOrderScheduleDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Hapus schedule',
    description: 'Menghapus order schedule. Schedule yang sedang active tidak bisa dihapus'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Schedule ID'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Schedule berhasil dihapus'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - tidak bisa hapus schedule yang active'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Schedule tidak ditemukan'
  })
  async remove(
    @Request() req: any,
    @Param('id') id: string
  ) {
    const userId = req.user.sub;
    return this.orderScheduleService.remove(userId, id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Aktifkan/Start schedule',
    description: 'Mengaktifkan order schedule untuk mulai dieksekusi sesuai jadwal'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Schedule ID'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Schedule berhasil diaktifkan'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Schedule tidak ditemukan'
  })
  async activate(
    @Request() req: any,
    @Param('id') id: string
  ) {
    const userId = req.user.sub;
    return this.orderScheduleService.activateSchedule(userId, id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Pause schedule',
    description: 'Menjeda order schedule. Schedule tidak akan dieksekusi sampai diaktifkan kembali'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Schedule ID'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Schedule berhasil di-pause'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Schedule tidak ditemukan'
  })
  async pause(
    @Request() req: any,
    @Param('id') id: string
  ) {
    const userId = req.user.sub;
    return this.orderScheduleService.pauseSchedule(userId, id);
  }

  @Get(':id/executions')
  @ApiOperation({ 
    summary: 'Dapatkan riwayat eksekusi',
    description: 'Mendapatkan history eksekusi order dari schedule tertentu'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Schedule ID'
  })
  @ApiQuery({ 
    name: 'limit', 
    required: false, 
    description: 'Jumlah maksimal data',
    example: 50
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Riwayat eksekusi berhasil didapatkan'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Schedule tidak ditemukan'
  })
  async getExecutions(
    @Request() req: any,
    @Param('id') id: string,
    @Query('limit') limit?: number
  ) {
    const userId = req.user.sub;
    return this.orderScheduleService.getExecutionHistory(userId, id, limit || 50);
  }

  @Get(':id/statistics')
  @ApiOperation({ 
    summary: 'Dapatkan statistik schedule',
    description: 'Mendapatkan statistik harian dari performa order schedule'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Schedule ID'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Statistik berhasil didapatkan'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Schedule tidak ditemukan'
  })
  async getStatistics(
    @Request() req: any,
    @Param('id') id: string
  ) {
    const userId = req.user.sub;
    return this.orderScheduleService.getStatistics(userId, id);
  }

  // ✅ Endpoint untuk manual trigger (admin only)
  @Post(':id/trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Manual trigger schedule',
    description: 'Trigger schedule execution manually for testing'
  })
  async manualTrigger(
    @Request() req: any,
    @Param('id') id: string,
    @Body('time') time: string
  ) {
    return this.orderScheduleExecutorService.manualTrigger(id, time);
  }
}