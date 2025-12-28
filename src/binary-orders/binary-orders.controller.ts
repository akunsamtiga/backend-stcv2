// src/binary-orders/binary-orders.controller.ts
// ✅ UPDATED: Simplified to pass QueryBinaryOrderDto directly

import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { BinaryOrdersService } from './binary-orders.service';
import { CreateBinaryOrderDto } from './dto/create-binary-order.dto';
import { QueryBinaryOrderDto } from './dto/query-binary-order.dto';
import { BALANCE_ACCOUNT_TYPE, ORDER_STATUS } from '../common/constants';

@ApiTags('binary-orders')
@Controller('binary-orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BinaryOrdersController {
  constructor(private ordersService: BinaryOrdersService) {}

  @Post()
  @ApiOperation({ 
    summary: 'Create new binary option order',
    description: 'Create a new binary option order for real or demo account'
  })
  createOrder(
    @CurrentUser('sub') userId: string,
    @Body() createOrderDto: CreateBinaryOrderDto,
  ) {
    return this.ordersService.createOrder(userId, createOrderDto);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all binary orders with pagination',
    description: 'Supports filtering by status and account type. Returns paginated list of orders.'
  })
  @ApiQuery({ 
    name: 'status', 
    required: false, 
    enum: ORDER_STATUS,
    description: 'Filter by order status'
  })
  @ApiQuery({ 
    name: 'accountType', 
    required: false, 
    enum: BALANCE_ACCOUNT_TYPE,
    description: 'Filter by account type (real or demo)'
  })
  @ApiQuery({ 
    name: 'page', 
    required: false, 
    type: Number,
    description: 'Page number (default: 1)'
  })
  @ApiQuery({ 
    name: 'limit', 
    required: false, 
    type: Number,
    description: 'Items per page (default: 20, max: 100)'
  })
  getOrders(
    @CurrentUser('sub') userId: string,
    @Query() queryDto: QueryBinaryOrderDto,
  ) {
    // ✅ Pass entire DTO directly to service
    return this.ordersService.getOrders(userId, queryDto);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get binary order by ID',
    description: 'Get detailed information about a specific order'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'Order ID' 
  })
  getOrderById(
    @CurrentUser('sub') userId: string,
    @Param('id') orderId: string,
  ) {
    return this.ordersService.getOrderById(userId, orderId);
  }
}