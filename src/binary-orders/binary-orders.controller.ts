import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';
import { BinaryOrdersService } from './binary-orders.service';
import { CreateBinaryOrderDto } from './dto/create-binary-order.dto';
import { QueryBinaryOrderDto } from './dto/query-binary-order.dto';

@ApiTags('binary-orders')
@Controller('binary-orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BinaryOrdersController {
  constructor(private ordersService: BinaryOrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create new binary option order' })
  createOrder(
    @CurrentUser('sub') userId: string,
    @Body() createOrderDto: CreateBinaryOrderDto,
  ) {
    return this.ordersService.createOrder(userId, createOrderDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all binary orders with pagination' })
  getOrders(
    @CurrentUser('sub') userId: string,
    @Query() queryDto: QueryBinaryOrderDto,
  ) {
    return this.ordersService.getOrders(userId, queryDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get binary order by ID' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  getOrderById(
    @CurrentUser('sub') userId: string,
    @Param('id') orderId: string,
  ) {
    return this.ordersService.getOrderById(userId, orderId);
  }
}
