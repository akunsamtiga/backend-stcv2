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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiConsumes, ApiBody } from '@nestjs/swagger';
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

  @Post('upload-image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({ 
    summary: 'Upload image for information',
    description: 'Upload gambar untuk information (max 5MB, format: JPEG, PNG, GIF, WebP)'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Image file (JPEG, PNG, GIF, WebP, max 5MB)'
        },
      },
    },
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Image uploaded successfully',
    schema: {
      example: {
        success: true,
        message: 'Image uploaded successfully',
        data: {
          url: 'https://storage.googleapis.com/bucket/information/1234567890_abc123.jpg',
          path: 'information/1234567890_abc123.jpg',
          size: 524288
        }
      }
    }
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid file type or size' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized' 
  })
  @ApiResponse({ 
    status: 403, 
    description: 'Forbidden - Admin only' 
  })
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }

    const adminId = req.user.userId;
    const adminEmail = req.user.email;

    const result = await this.informationService.uploadImage(file, adminId, adminEmail);

    return {
      success: true,
      message: 'Image uploaded successfully',
      data: result,
    };
  }

  @Delete('delete-image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Delete image from storage',
    description: 'Hapus gambar dari Firebase Storage berdasarkan path'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          example: 'information/1234567890_abc123.jpg',
          description: 'Storage path dari gambar yang akan dihapus'
        },
      },
      required: ['imagePath']
    },
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Image deleted successfully' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid image path' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized' 
  })
  async deleteImage(
    @Body('imagePath') imagePath: string,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!imagePath) {
      throw new BadRequestException('Image path is required');
    }

    const adminEmail = req.user.email;

    await this.informationService.deleteImage(imagePath, adminEmail);

    return {
      success: true,
      message: 'Image deleted successfully',
    };
  }

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