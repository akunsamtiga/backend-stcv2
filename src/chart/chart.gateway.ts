// src/chart/chart.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { ChartService } from './chart.service';
import { SubscribeChartDto, TimeframeEnum } from './dto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  subscribedCharts?: Map<string, string>; // assetId_timeframe -> intervalId
}

@WebSocketGateway({
  namespace: 'chart',
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class ChartGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChartGateway.name);
  
  @WebSocketServer()
  server: Server;

  // Track active subscriptions untuk cleanup
  private clientSubscriptions: Map<string, Map<string, NodeJS.Timeout>> = new Map();

  constructor(
    private chartService: ChartService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('📊 Chart WebSocket Gateway initialized');
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Validasi JWT dari handshake
      const token = client.handshake.auth.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.secret'),
      });

      client.userId = payload.sub;
      client.subscribedCharts = new Map();
      this.clientSubscriptions.set(client.id, new Map());
      
      this.logger.debug(`Client connected: ${client.id} (User: ${payload.sub})`);
      
      client.emit('connected', { 
        message: 'Connected to Chart Stream',
        timestamp: Date.now(),
      });

    } catch (error) {
      this.logger.error(`Connection rejected: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    // Cleanup semua subscription
    const subscriptions = this.clientSubscriptions.get(client.id);
    if (subscriptions) {
      subscriptions.forEach((intervalId) => {
        clearInterval(intervalId);
      });
      this.clientSubscriptions.delete(client.id);
    }
    
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Subscribe ke real-time chart updates
   * Frontend emit: { assetId: 'xxx', timeframe: '1m' }
   */
  @SubscribeMessage('subscribe_chart')
  async handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SubscribeChartDto,
  ) {
    try {
      const { assetId, timeframe } = data;
      const subscriptionKey = `${assetId}_${timeframe}`;
      
      // Cek jika sudah subscribe
      if (client.subscribedCharts?.has(subscriptionKey)) {
        client.emit('error', { message: `Already subscribed to ${subscriptionKey}` });
        return;
      }

      // Kirim historis data dulu
      const historicalData = await this.chartService.getOHLC(assetId, timeframe, 100);
      client.emit('historical_data', {
        assetId,
        timeframe,
        data: historicalData.data,
      });

      // Setup interval untuk polling real-time (setiap 1 detik)
      const intervalId = setInterval(async () => {
        try {
          const latestCandle = await this.chartService.getCurrentCandle(assetId, timeframe);
          
          if (latestCandle) {
            client.emit('candle_update', {
              assetId,
              timeframe,
              candle: latestCandle,
              timestamp: Date.now(),
            });
          }
        } catch (error) {
          this.logger.error(`Error fetching candle: ${error.message}`);
        }
      }, 1000);

      // Simpan subscription
      client.subscribedCharts?.set(subscriptionKey, subscriptionKey);
      this.clientSubscriptions.get(client.id)?.set(subscriptionKey, intervalId);
      
      this.logger.debug(`Client ${client.id} subscribed to ${assetId} ${timeframe}`);
      
      client.emit('subscribed', {
        assetId,
        timeframe,
        message: `Subscribed to ${timeframe} chart for ${assetId}`,
      });

    } catch (error) {
      this.logger.error(`Subscribe error: ${error.message}`);
      client.emit('error', { message: error.message });
    }
  }

  /**
   * Unsubscribe dari chart
   */
  @SubscribeMessage('unsubscribe_chart')
  handleUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SubscribeChartDto,
  ) {
    const { assetId, timeframe } = data;
    const subscriptionKey = `${assetId}_${timeframe}`;
    
    const intervalId = this.clientSubscriptions.get(client.id)?.get(subscriptionKey);
    if (intervalId) {
      clearInterval(intervalId);
      this.clientSubscriptions.get(client.id)?.delete(subscriptionKey);
      client.subscribedCharts?.delete(subscriptionKey);
      
      this.logger.debug(`Client ${client.id} unsubscribed from ${subscriptionKey}`);
      client.emit('unsubscribed', { assetId, timeframe });
    }
  }

  /**
   * Broadcast ke semua subscriber saat ada candle baru (dipanggil dari service lain)
   */
  broadcastCandleUpdate(assetId: string, timeframe: string, candle: any) {
    this.server.to(`chart_${assetId}_${timeframe}`).emit('candle_update', {
      assetId,
      timeframe,
      candle,
      timestamp: Date.now(),
    });
  }

  /**
   * Request snapshot data sekali (tanpa subscription)
   */
  @SubscribeMessage('get_snapshot')
  async handleSnapshot(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SubscribeChartDto & { limit?: number },
  ) {
    try {
      const { assetId, timeframe, limit = 50 } = data;
      const ohlcData = await this.chartService.getOHLC(assetId, timeframe, limit);
      
      client.emit('snapshot_data', {
        assetId,
        timeframe,
        data: ohlcData.data,
        timestamp: Date.now(),
      });
    } catch (error) {
      client.emit('error', { message: error.message });
    }
  }
}