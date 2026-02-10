// src/information/information-admin.controller.ts

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
  Request,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { InformationService } from './information.service';
import { CreateInformationDto } from './dto/create-information.dto';
import { UpdateInformationDto } from './dto/update-information.dto';
import { GetInformationQueryDto } from './dto/get-information-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// Request interface for JWT authenticated requests
interface AuthenticatedRequest {
  user: {
    userId: string;
    email: string;
    role: string;
    status: string;
  };
}

@ApiTags('admin/information')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@Controller('admin/information')
export class InformationAdminController {
  constructor(private readonly informationService: InformationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ 
    summary: 'Create new information',
    description: 'Admin/Super Admin dapat membuat informasi baru (promosi, pengumuman, dll)'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Information created successfully' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid input data' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing token' 
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Forbidden - Requires admin or super_admin role' 
  })
  async createInformation(
    @Body() createDto: CreateInformationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const adminId = req.user.userId;
    const adminEmail = req.user.email;

    const information = await this.informationService.createInformation(
      createDto,
      adminId,
      adminEmail,
    );

    return {
      success: true,
      message: 'Information created successfully',
      data: information,
    };
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all information (Admin)',
    description: 'Admin dapat melihat semua informasi dengan filter dan pagination'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Information list retrieved successfully' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized' 
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Forbidden - Admin only' 
  })
  async getAllInformation(@Query() query: GetInformationQueryDto) {
    const result = await this.informationService.getAllInformation(query);

    return {
      success: true,
      message: 'Information list retrieved successfully',
      data: result.items,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    };
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get information by ID',
    description: 'Admin dapat melihat detail informasi berdasarkan ID'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Information ID',
    example: 'abc123xyz'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Information retrieved successfully' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Information not found' 
  })
  async getInformationById(@Param('id') id: string) {
    const information = await this.informationService.getInformationById(id);

    return {
      success: true,
      message: 'Information retrieved successfully',
      data: information,
    };
  }

  @Put(':id')
  @ApiOperation({ 
    summary: 'Update information',
    description: 'Admin dapat mengupdate informasi yang sudah ada'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Information ID',
    example: 'abc123xyz'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Information updated successfully' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid input data' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Information not found' 
  })
  async updateInformation(
    @Param('id') id: string,
    @Body() updateDto: UpdateInformationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const adminId = req.user.userId;
    const adminEmail = req.user.email;

    const information = await this.informationService.updateInformation(
      id,
      updateDto,
      adminId,
      adminEmail,
    );

    return {
      success: true,
      message: 'Information updated successfully',
      data: information,
    };
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ 
    summary: 'Toggle information active status',
    description: 'Admin dapat mengaktifkan/menonaktifkan informasi'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Information ID',
    example: 'abc123xyz'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Information status toggled successfully' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Information not found' 
  })
  async toggleActiveStatus(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const adminId = req.user.userId;
    const adminEmail = req.user.email;

    const information = await this.informationService.toggleActiveStatus(
      id,
      adminId,
      adminEmail,
    );

    return {
      success: true,
      message: `Information ${information.isActive ? 'activated' : 'deactivated'} successfully`,
      data: information,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Delete information',
    description: 'Admin dapat menghapus informasi permanen'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Information ID',
    example: 'abc123xyz'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Information deleted successfully' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Information not found' 
  })
  async deleteInformation(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const adminEmail = req.user.email;

    await this.informationService.deleteInformation(id, adminEmail);

    return {
      success: true,
      message: 'Information deleted successfully',
    };
  }
}