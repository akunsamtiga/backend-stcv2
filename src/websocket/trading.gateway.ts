import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';

// Interface untuk autentikasi socket
interface AuthenticatedSocket extends Socket {
  userId: string;
  isAdmin: boolean;
}

@WebSocketGateway({
  cors: {
    origin: '*', // Sesuaikan dengan frontend domain
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

  async handleConnection(client: Socket, ...args: any[]) {
    try {
      const token = client.handshake.auth.token || client.handshake.query.token;
      
      if (!token) {
        this.logger.warn(`❌ Socket ${client.id} rejected: No token`);
        client.disconnect();
        return;
      }

      // Verify JWT
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.secret'),
      });

      (client as AuthenticatedSocket).userId = decoded.sub;
      (client as AuthenticatedSocket).isAdmin = decoded.role === 'super_admin' || decoded.role === 'admin';

      this.logger.log(`✅ Socket connected: ${client.id} | User: ${decoded.sub}`);
      
      // Kirim snapshot asset prices saat connect
      await this.sendInitialPriceSnapshot(client);

    } catch (error) {
      this.logger.error(`❌ Socket ${client.id} authentication failed: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const authClient = client as AuthenticatedSocket;
    this.logger.log(`📴 Socket disconnected: ${client.id} | User: ${authClient.userId}`);
  }

  // Emit price update ke semua client yang terhubung
  emitPriceUpdate(assetId: string, priceData: any) {
    const payload = {
      assetId,
      ...priceData,
      timestamp: Date.now(),
    };
    
    this.server.emit('price:update', payload);
    this.logger.debug(`📡 Price pushed: ${assetId} = ${priceData.price}`);
  }

  // Emit order yang baru dibuat
  emitOrderCreated(userId: string, orderData: any) {
    const payload = {
      ...orderData,
      event: 'order:created',
      timestamp: Date.now(),
    };
    
    // Hanya kirim ke user yang bersangkutan (room)
    this.server.to(`user:${userId}`).emit('order:update', payload);
    this.logger.debug(`📤 Order created pushed: ${orderData.id}`);
  }

  // Emit settlement result
  emitOrderSettled(userId: string, settlementData: any) {
    const payload = {
      ...settlementData,
      event: 'order:settled',
      timestamp: Date.now(),
    };
    
    this.server.to(`user:${userId}`).emit('order:update', payload);
    this.logger.debug(`⚡ Settlement pushed: ${settlementData.id} = ${settlementData.status}`);
  }

  // Emit update untuk admin
  emitAdminUpdate(event: string, data: any) {
    this.server.to('room:admin').emit(event, data);
  }

  // Client subscribe ke room user
  @SubscribeMessage('user:subscribe')
  handleUserSubscribe(client: AuthenticatedSocket, payload: { userId: string }) {
    if (client.userId !== payload.userId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    client.join(`user:${payload.userId}`);
    this.logger.log(`🔒 User ${payload.userId} subscribed to own room`);
    client.emit('user:subscribed', { userId: payload.userId });
  }

  // Admin subscribe
  @SubscribeMessage('admin:subscribe')
  handleAdminSubscribe(client: AuthenticatedSocket) {
    if (!client.isAdmin) {
      client.emit('error', { message: 'Admin only' });
      return;
    }

    client.join('room:admin');
    this.logger.log(`🔒 Admin ${client.userId} subscribed`);
    client.emit('admin:subscribed', { role: 'admin' });
  }

  // Client request price manual (will be pushed via subscription)
  @SubscribeMessage('price:subscribe')
  async handlePriceSubscribe(client: AuthenticatedSocket, payload: { assetIds: string[] }) {
    const assets = await this.firebaseService.getFirestore()
      .collection('assets')
      .where('id', 'in', payload.assetIds)
      .get();

    assets.docs.forEach(doc => {
      client.join(`asset:${doc.id}`);
    });

    client.emit('price:subscribed', { assetIds: payload.assetIds });

    // Langsung kirim snapshot
    for (const assetId of payload.assetIds) {
      const priceData = await this.getCurrentPriceSnapshot(assetId);
      if (priceData) {
        client.emit('price:update', { assetId, ...priceData });
      }
    }
  }

  private async sendInitialPriceSnapshot(client: Socket) {
    // Bisa diexpand untuk kirim snapshot market
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
      
      const snapshot = await this.firebaseService.getRealtimeDatabase()
        .ref(`${path}/current_price`)
        .once('value');

      return snapshot.val();
    } catch {
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