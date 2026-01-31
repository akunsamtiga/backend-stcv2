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
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';
import { PriceFetcherService } from '../assets/services/price-fetcher.service';
import { Asset } from '../common/interfaces';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  isAdmin?: boolean;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class TradingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TradingGateway.name);
  
  @WebSocketServer()
  server: Server;

  private assetSubscriptions: Map<string, Set<string>> = new Map();
  private connectedClients: Map<string, string> = new Map();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private firebaseService: FirebaseService,
    @Inject(forwardRef(() => PriceFetcherService))
    private priceFetcherService: PriceFetcherService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('🚀 WebSocket Gateway initialized');
    this.logger.log('📡 Price & Order streaming ready');
    this.logger.log('⚡ Price broadcast: Every 1 second');
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.query.token;
      
      if (!token) {
        this.logger.warn(`❌ Socket ${client.id} rejected: No token`);
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.secret'),
      });

      (client as AuthenticatedSocket).userId = decoded.sub;
      (client as AuthenticatedSocket).isAdmin = decoded.role === 'super_admin' || decoded.role === 'admin';

      client.join(`user:${decoded.sub}`);
      this.connectedClients.set(client.id, decoded.sub);
      
      this.logger.log(`✅ Socket connected: ${client.id} | User: ${decoded.sub}`);
      
      client.emit('connected', {
        userId: decoded.sub,
        timestamp: Date.now(),
        serverTime: new Date().toISOString(),
      });

    } catch (error) {
      this.logger.error(`❌ Socket ${client.id} authentication failed: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const authClient = client as AuthenticatedSocket;
    const userId = this.connectedClients.get(client.id);
    
    this.assetSubscriptions.forEach((subscribers, assetId) => {
      if (subscribers.has(client.id)) {
        subscribers.delete(client.id);
        
        if (subscribers.size === 0) {
          this.assetSubscriptions.delete(assetId);
        }
      }
    });

    this.connectedClients.delete(client.id);
    
    this.logger.log(`🔴 Socket disconnected: ${client.id} | User: ${userId || authClient.userId}`);
    
    if (this.connectedClients.size % 10 === 0) {
      this.logger.debug(
        `📊 Connected: ${this.connectedClients.size} clients, ` +
        `Subscriptions: ${this.assetSubscriptions.size} assets`
      );
    }
  }

  @Cron('* * * * * *')
  async handlePriceBroadcast() {
    try {
      if (this.connectedClients.size === 0) {
        return;
      }

      const priceStats = this.priceFetcherService.getPerformanceStats();
      
      this.server.emit('prices:bulk_update', {
        timestamp: Date.now(),
        serverTime: new Date().toISOString(),
        updateInterval: 1000,
        stats: {
          mockPricesCount: priceStats.mockPricesCount || 0,
          cryptoPricesCount: priceStats.cryptoStats?.capacity?.currentAssets || 0,
        }
      });
      
      const now = Date.now();
      const logKey = Math.floor(now / 10000);
      const lastLogKey = Math.floor((now - 1000) / 10000);
      
      if (logKey !== lastLogKey) {
        this.logger.debug(
          `📡 Broadcasting prices to ${this.connectedClients.size} clients, ` +
          `${this.assetSubscriptions.size} asset subscriptions`
        );
      }
    } catch (error) {
      this.logger.error('❌ Failed to broadcast prices:', error);
    }
  }

  @SubscribeMessage('request_price')
  async handlePriceRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { assetId: string; bypassCache?: boolean },
  ): Promise<void> {
    try {
      const { assetId, bypassCache = true } = data;
      
      const assetDoc = await this.firebaseService.getFirestore()
        .collection('assets')
        .doc(assetId)
        .get();

      if (!assetDoc.exists) {
        client.emit('price_error', {
          assetId,
          error: 'Asset not found',
        });
        return;
      }

      const asset = assetDoc.data() as Asset;
      
      const priceData = await this.priceFetcherService.getCurrentPriceRealtime(
        asset,
        bypassCache
      );
      
      if (!priceData) {
        client.emit('price_error', {
          assetId,
          error: 'Price unavailable',
        });
        return;
      }
      
      client.emit('price_response', {
        assetId,
        price: priceData.price,
        timestamp: priceData.timestamp,
        datetime: priceData.datetime,
        cached: !bypassCache,
        serverTime: new Date().toISOString(),
      });
      
    } catch (error) {
      this.logger.error(`Failed to fetch price for asset ${data.assetId}:`, error);
      client.emit('price_error', {
        assetId: data.assetId,
        error: error.message,
      });
    }
  }

  @SubscribeMessage('request_prices_batch')
  async handleBatchPriceRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { assetIds: string[]; bypassCache?: boolean },
  ): Promise<void> {
    try {
      const { assetIds, bypassCache = true } = data;
      
      if (!Array.isArray(assetIds) || assetIds.length === 0) {
        client.emit('price_error', {
          error: 'Invalid assetIds array',
        });
        return;
      }
      
      const MAX_BATCH_SIZE = 50;
      if (assetIds.length > MAX_BATCH_SIZE) {
        client.emit('price_error', {
          error: `Batch size exceeds maximum (${MAX_BATCH_SIZE})`,
        });
        return;
      }
      
      const pricePromises = assetIds.map(async assetId => {
        try {
          const assetDoc = await this.firebaseService.getFirestore()
            .collection('assets')
            .doc(assetId)
            .get();

          if (!assetDoc.exists) {
            return { assetId, price: null, error: 'Asset not found' };
          }

          const asset = assetDoc.data() as Asset;
          const priceData = await this.priceFetcherService.getCurrentPriceRealtime(
            asset,
            bypassCache
          );

          if (!priceData) {
            return { assetId, price: null, error: 'Price unavailable' };
          }

          return {
            assetId,
            price: priceData.price,
            timestamp: priceData.timestamp,
            datetime: priceData.datetime,
          };
        } catch (error) {
          return { assetId, price: null, error: error.message };
        }
      });
      
      const results = await Promise.all(pricePromises);
      
      const prices: Record<string, any> = {};
      const errors: Record<string, string> = {};
      
      results.forEach(result => {
        if (result.price !== null) {
          prices[result.assetId] = {
            price: result.price,
            timestamp: result.timestamp,
            datetime: result.datetime,
          };
        } else {
          errors[result.assetId] = result.error || 'Price unavailable';
        }
      });
      
      client.emit('prices_batch_response', {
        prices,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        timestamp: Date.now(),
        serverTime: new Date().toISOString(),
        cached: !bypassCache,
      });
      
    } catch (error) {
      this.logger.error('Failed to fetch batch prices:', error);
      client.emit('price_error', {
        error: error.message,
      });
    }
  }

  @SubscribeMessage('subscribe_asset')
  handleAssetSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { assetId: string },
  ): void {
    const { assetId } = data;
    
    if (!this.assetSubscriptions.has(assetId)) {
      this.assetSubscriptions.set(assetId, new Set());
    }
    
    this.assetSubscriptions.get(assetId)!.add(client.id);
    
    this.logger.debug(
      `Client ${client.id} (${client.userId}) subscribed to asset ${assetId}`
    );
    
    client.emit('subscribe_confirmed', { 
      assetId,
      timestamp: Date.now(),
    });
  }

  @SubscribeMessage('unsubscribe_asset')
  handleAssetUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { assetId: string },
  ): void {
    const { assetId } = data;
    
    if (this.assetSubscriptions.has(assetId)) {
      this.assetSubscriptions.get(assetId)!.delete(client.id);
      
      if (this.assetSubscriptions.get(assetId)!.size === 0) {
        this.assetSubscriptions.delete(assetId);
      }
    }
    
    this.logger.debug(
      `Client ${client.id} (${client.userId}) unsubscribed from asset ${assetId}`
    );
    
    client.emit('unsubscribe_confirmed', { 
      assetId,
      timestamp: Date.now(),
    });
  }

  emitPriceUpdate(assetId: string, priceData: any) {
    const payload = {
      assetId,
      ...priceData,
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
    };
    
    this.server.to(`asset:${assetId}`).emit('price:update', payload);
    this.logger.debug(`📡 Price pushed to asset:${assetId} - ${priceData.price}`);
  }

  @SubscribeMessage('price:subscribe')
  async handlePriceSubscribe(client: AuthenticatedSocket, payload: { assetIds: string[] }) {
    try {
      payload.assetIds.forEach(assetId => {
        client.join(`asset:${assetId}`);
        this.logger.debug(`📌 ${client.userId} subscribed to asset:${assetId}`);
      });

      client.emit('price:subscribed', { 
        assetIds: payload.assetIds,
        timestamp: Date.now(),
      });

      for (const assetId of payload.assetIds) {
        const priceData = await this.getCurrentPriceSnapshot(assetId);
        if (priceData) {
          client.emit('price:snapshot', { 
            assetId, 
            ...priceData,
            timestamp: Date.now(),
          });
        }
      }
    } catch (error) {
      this.logger.error(`❌ Price subscription error: ${error.message}`);
      client.emit('error', { message: 'Failed to subscribe to prices' });
    }
  }

  @SubscribeMessage('price:unsubscribe')
  handlePriceUnsubscribe(client: AuthenticatedSocket, payload: { assetIds: string[] }) {
    payload.assetIds.forEach(assetId => {
      client.leave(`asset:${assetId}`);
      this.logger.debug(`📍 ${client.userId} unsubscribed from asset:${assetId}`);
    });

    client.emit('price:unsubscribed', { 
      assetIds: payload.assetIds,
      timestamp: Date.now(),
    });
  }

  emitOrderUpdate(userId: string, data: any) {
    const payload = {
      ...data,
      timestamp: Date.now(),
      serverTime: new Date().toISOString(),
    };
    
    this.server.to(`user:${userId}`).emit('order:update', payload);
  }

  emitOrderCreated(userId: string, orderData: any) {
    const payload = {
      ...orderData,
      event: 'order:created',
      timestamp: Date.now(),
    };
    
    this.server.to(`user:${userId}`).emit('order:update', payload);
    this.logger.debug(`📤 Order created pushed to user:${userId}`);
  }

  emitOrderSettled(userId: string, settlementData: any) {
    const payload = {
      ...settlementData,
      event: 'order:settled',
      timestamp: Date.now(),
    };
    
    this.server.to(`user:${userId}`).emit('order:update', payload);
    this.logger.debug(`⚡ Settlement pushed to user:${userId} - ${settlementData.id}`);
  }

  @SubscribeMessage('admin:subscribe')
  handleAdminSubscribe(client: AuthenticatedSocket) {
    if (!client.isAdmin) {
      client.emit('error', { message: 'Admin only' });
      return;
    }

    client.join('room:admin');
    this.logger.log(`🔐 Admin ${client.userId} subscribed`);
    client.emit('admin:subscribed', { role: 'admin', timestamp: Date.now() });
  }

  emitAdminUpdate(event: string, data: any) {
    this.server.to('room:admin').emit(event, {
      ...data,
      timestamp: Date.now(),
    });
  }

  private async getCurrentPriceSnapshot(assetId: string): Promise<any | null> {
    try {
      const assetDoc = await this.firebaseService.getFirestore()
        .collection('assets')
        .doc(assetId)
        .get();

      if (!assetDoc.exists) return null;

      const asset = assetDoc.data() as Asset;
      
      const priceData = await this.priceFetcherService.getCurrentPrice(asset, true);
      
      return priceData;
    } catch (error) {
      this.logger.debug(`Failed to get price snapshot for ${assetId}: ${error.message}`);
      return null;
    }
  }

  private getAssetRealtimePath(asset: any): string {
    if (asset.category === 'crypto' && asset.cryptoConfig) {
      const quote = asset.cryptoConfig.quoteCurrency.toLowerCase().replace('usd', 'usdt');
      return `/crypto/${asset.cryptoConfig.baseCurrency.toLowerCase()}_${quote}`;
    }
    return asset.realtimeDbPath || `/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }

  getWebSocketStats(): {
    connectedClients: number;
    subscribedAssets: number;
    totalSubscriptions: number;
  } {
    let totalSubscriptions = 0;
    
    this.assetSubscriptions.forEach(subscribers => {
      totalSubscriptions += subscribers.size;
    });
    
    return {
      connectedClients: this.connectedClients.size,
      subscribedAssets: this.assetSubscriptions.size,
      totalSubscriptions,
    };
  }
}