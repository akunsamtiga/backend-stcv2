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
import * as admin from 'firebase-admin';

interface AuthenticatedSocket extends Socket {
  userId: string;
  isAdmin: boolean;
}

interface FirebaseListener {
  ref: admin.database.Reference;
  unsubscribe: () => void;
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

  private assetListeners: Map<string, FirebaseListener> = new Map();
  private clientSubscriptions: Map<string, Set<string>> = new Map();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private firebaseService: FirebaseService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('ðŸš€ WebSocket Gateway initialized');
    this.logger.log('ðŸ"¡ Firebase Realtime DB listeners ready');
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.query.token;
      
      if (!token) {
        this.logger.warn(`âŒ Socket ${client.id} rejected: No token`);
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.secret'),
      });

      (client as AuthenticatedSocket).userId = decoded.sub;
      (client as AuthenticatedSocket).isAdmin = decoded.role === 'super_admin' || decoded.role === 'admin';

      this.logger.log(`âœ… Socket connected: ${client.id} | User: ${decoded.sub}`);
      
      this.clientSubscriptions.set(client.id, new Set());

    } catch (error) {
      this.logger.error(`âŒ Socket ${client.id} authentication failed: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const authClient = client as AuthenticatedSocket;
    
    const subscriptions = this.clientSubscriptions.get(client.id);
    if (subscriptions) {
      subscriptions.forEach(assetId => {
        this.unsubscribeFromAsset(assetId);
      });
      this.clientSubscriptions.delete(client.id);
    }
    
    this.logger.log(`ðŸ"´ Socket disconnected: ${client.id} | User: ${authClient.userId}`);
  }

  @SubscribeMessage('price:subscribe')
  async handlePriceSubscribe(client: AuthenticatedSocket, payload: { assetIds: string[] }) {
    try {
      const db = this.firebaseService.getFirestore();
      const rtDb = this.firebaseService.getRealtimeDatabase();

      for (const assetId of payload.assetIds) {
        const assetDoc = await db.collection('assets').doc(assetId).get();
        
        if (!assetDoc.exists) {
          this.logger.warn(`âš ï¸ Asset ${assetId} not found`);
          continue;
        }

        const asset = assetDoc.data();
        const path = this.getAssetRealtimePath(asset);

        if (!this.assetListeners.has(assetId)) {
          await this.setupFirebaseListener(assetId, path);
        }

        const clientSubs = this.clientSubscriptions.get(client.id);
        if (clientSubs) {
          clientSubs.add(assetId);
        }

        client.join(`asset:${assetId}`);
      }

      client.emit('price:subscribed', { 
        assetIds: payload.assetIds,
        method: 'firebase-realtime-listener'
      });

      this.logger.log(`ðŸ"¡ Client ${client.id} subscribed to ${payload.assetIds.length} assets`);

    } catch (error) {
      this.logger.error(`âŒ Price subscription error: ${error.message}`);
      client.emit('error', { message: 'Failed to subscribe to prices' });
    }
  }

  private async setupFirebaseListener(assetId: string, path: string): Promise<void> {
    try {
      const rtDb = this.firebaseService.getRealtimeDatabase();
      const ref = rtDb.ref(`${path}/current_price`);

      const listener = ref.on('value', (snapshot) => {
        const priceData = snapshot.val();
        
        if (priceData) {
          this.server.to(`asset:${assetId}`).emit('price:update', {
            assetId,
            ...priceData,
            timestamp: Date.now(),
            method: 'firebase-push',
          });

          this.logger.debug(`ðŸ"¡ Firebase pushed: ${assetId} = ${priceData.price}`);
        }
      });

      this.assetListeners.set(assetId, {
        ref,
        unsubscribe: () => ref.off('value', listener),
      });

      this.logger.log(`âœ… Firebase listener setup: ${assetId} at ${path}`);

    } catch (error) {
      this.logger.error(`âŒ Failed to setup listener for ${assetId}: ${error.message}`);
    }
  }

  private unsubscribeFromAsset(assetId: string): void {
    let subscriberCount = 0;
    for (const subs of this.clientSubscriptions.values()) {
      if (subs.has(assetId)) {
        subscriberCount++;
      }
    }

    if (subscriberCount === 0) {
      const listener = this.assetListeners.get(assetId);
      if (listener) {
        listener.unsubscribe();
        this.assetListeners.delete(assetId);
        this.logger.debug(`ðŸ—'ï¸ Removed Firebase listener: ${assetId}`);
      }
    }
  }

  emitOrderCreated(userId: string, orderData: any) {
    const payload = {
      ...orderData,
      event: 'order:created',
      timestamp: Date.now(),
    };
    
    this.server.to(`user:${userId}`).emit('order:update', payload);
    this.logger.debug(`ðŸ"¤ Order created pushed: ${orderData.order?.id || 'unknown'}`);
  }

  emitOrderSettled(userId: string, settlementData: any) {
    const payload = {
      ...settlementData,
      event: 'order:settled',
      timestamp: Date.now(),
    };
    
    this.server.to(`user:${userId}`).emit('order:update', payload);
    this.logger.debug(`âš¡ Settlement pushed: ${settlementData.id} = ${settlementData.status}`);
  }

  @SubscribeMessage('user:subscribe')
  handleUserSubscribe(client: AuthenticatedSocket, payload: { userId: string }) {
    if (client.userId !== payload.userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    client.join(`user:${payload.userId}`);
    this.logger.log(`ðŸ"' User ${payload.userId} subscribed to own room`);
    client.emit('user:subscribed', { userId: payload.userId });
  }

  @SubscribeMessage('admin:subscribe')
  handleAdminSubscribe(client: AuthenticatedSocket) {
    if (!client.isAdmin) {
      client.emit('error', { message: 'Admin only' });
      return;
    }

    client.join('room:admin');
    this.logger.log(`ðŸ"' Admin ${client.userId} subscribed`);
    client.emit('admin:subscribed', { role: 'admin' });
  }

  emitAdminUpdate(event: string, data: any) {
    this.server.to('room:admin').emit(event, data);
  }

  private getAssetRealtimePath(asset: any): string {
    if (asset.category === 'crypto' && asset.cryptoConfig) {
      const quote = asset.cryptoConfig.quoteCurrency.toLowerCase().replace('usd', 'usdt');
      return `/crypto/${asset.cryptoConfig.baseCurrency.toLowerCase()}_${quote}`;
    }
    return asset.realtimeDbPath || `/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }
}