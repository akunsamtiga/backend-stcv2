// src/information/information-user.controller.ts

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  Post,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { InformationService } from './information.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Request interface for JWT authenticated requests
interface AuthenticatedRequest {
  user: {
    userId: string;
    email: string;
    role: string;
    status: string;
  };
}

@ApiTags('information')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('information')
export class InformationUserController {
  constructor(private readonly informationService: InformationService) {}

  @Get()
  @ApiOperation({ 
    summary: 'Get active information for user',
    description: 'User dapat melihat informasi aktif yang ditargetkan untuk mereka berdasarkan status dan role'
  })
  @ApiQuery({ 
    name: 'page', 
    required: false, 
    type: Number, 
    description: 'Page number',
    example: 1
  })
  @ApiQuery({ 
    name: 'limit', 
    required: false, 
    type: Number, 
    description: 'Items per page',
    example: 20
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Active information retrieved successfully' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing token' 
  })
  async getActiveInformation(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Request() req: AuthenticatedRequest,
  ) {
    const userStatus = req.user.status || 'standard';
    const userRole = req.user.role || 'user';

    const result = await this.informationService.getActiveInformation(
      userStatus,
      userRole,
      Number(page),
      Number(limit),
    );

    return {
      success: true,
      message: 'Active information retrieved successfully',
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
    summary: 'Get information detail by ID',
    description: 'User dapat melihat detail informasi berdasarkan ID'
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

    // Increment view count in background (fire and forget)
    this.informationService.incrementViewCount(id).catch(() => {});

    return {
      success: true,
      message: 'Information retrieved successfully',
      data: information,
    };
  }

  @Post(':id/click')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Track information click',
    description: 'Track ketika user mengklik link/button pada informasi'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Information ID',
    example: 'abc123xyz'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Click tracked successfully' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Information not found' 
  })
  async trackClick(@Param('id') id: string) {
    // Increment click count in background (fire and forget)
    this.informationService.incrementClickCount(id).catch(() => {});

    return {
      success: true,
      message: 'Click tracked successfully',
    };
  }
}