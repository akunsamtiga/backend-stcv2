import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';

interface AuthenticatedSocket extends Socket {
  userId: string;
  isAdmin: boolean;
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

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private firebaseService: FirebaseService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('🚀 WebSocket Gateway initialized');
    this.logger.log('📡 Price & Order streaming ready');
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
      
      this.logger.log(`✅ Socket connected: ${client.id} | User: ${decoded.sub}`);
      
      client.emit('connected', {
        userId: decoded.sub,
        timestamp: Date.now(),
      });

    } catch (error) {
      this.logger.error(`❌ Socket ${client.id} authentication failed: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const authClient = client as AuthenticatedSocket;
    this.logger.log(`🔴 Socket disconnected: ${client.id} | User: ${authClient.userId}`);
  }

  emitPriceUpdate(assetId: string, priceData: any) {
    const payload = {
      assetId,
      ...priceData,
      timestamp: Date.now(),
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

      const asset = assetDoc.data();
      const path = this.getAssetRealtimePath(asset);
      
      const priceData = await this.firebaseService.getRealtimeDbValue(
        `${path}/current_price`,
        true
      );

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
}
