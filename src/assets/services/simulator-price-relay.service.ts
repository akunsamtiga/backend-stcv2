import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { FirebaseService } from '../../firebase/firebase.service';
import { AssetsService } from '../assets.service';
import { TradingGateway } from '../../websocket/trading.gateway';
import { ASSET_CATEGORY } from '../../common/constants';
import { Asset } from '../../common/interfaces';

@Injectable()
export class SimulatorPriceRelayService implements OnModuleInit {
  private readonly logger = new Logger(SimulatorPriceRelayService.name);
  
  private normalAssets: Asset[] = [];
  private isRunning = false;
  private relayInterval: NodeJS.Timeout | null = null;
  
  private relayCount = 0;
  private errorCount = 0;
  private lastSuccessTime = 0;
  
  // ✅ Tambahkan listener
  private assetsListenerUnsubscribe: (() => void) | null = null;

  constructor(
    private firebaseService: FirebaseService,
    private assetsService: AssetsService,
    private tradingGateway: TradingGateway,
  ) {}

  async onModuleInit() {
    setTimeout(async () => {
      await this.initialize();
    }, 6000); // Delay 6 detik (setelah crypto scheduler)
  }

  private async initialize() {
    try {
      await this.loadNormalAssets();
      
      if (this.normalAssets.length > 0) {
        await this.startRelay();
      } else {
        this.logger.warn('⚠️ No normal assets found, relay not started');
      }
      
      // ✅ Setup listener setelah init
      this.setupAssetsListener();
      
    } catch (error) {
      this.logger.error(`❌ Relay initialization failed: ${error.message}`);
    }
  }

  // ✅ METHOD BARU: Real-time listener
  private setupAssetsListener(): void {
    try {
      this.logger.log('📡 Setting up normal assets listener...');
      
      const unsubscribe = this.firebaseService.getFirestore()
        .collection('assets')
        .where('category', '==', ASSET_CATEGORY.NORMAL)
        .where('isActive', '==', true)
        .onSnapshot(
          snapshot => {
            const changes = snapshot.docChanges();
            
            if (changes.length > 0) {
              this.logger.log(`📡 Detected ${changes.length} changes in normal assets`);
              
              this.loadNormalAssets().then(() => {
                if (this.normalAssets.length > 0 && !this.isRunning) {
                  this.startRelay();
                }
              });
            }
          },
          error => {
            this.logger.error(`❌ Normal assets listener error: ${error.message}`);
          }
        );
      
      this.assetsListenerUnsubscribe = unsubscribe;
      this.logger.log('✅ Normal assets listener active');
      
    } catch (error) {
      this.logger.error(`❌ Failed to setup normal assets listener: ${error.message}`);
    }
  }

  // ✅ FIXED: Event handler lengkap
  @OnEvent('simulator.asset.new')
  async handleNewSimulatorAsset(payload: { 
    assetId: string; 
    symbol: string; 
    realtimeDbPath: string;
    simulatorSettings?: any;
  }) {
    this.logger.log(`🆕 New simulator asset detected via event: ${payload.symbol}`);
    
    try {
      // Reload assets
      await this.loadNormalAssets();
      
      // Jika relay belum jalan, start sekarang
      if (!this.isRunning && this.normalAssets.length > 0) {
        this.logger.log('🚀 Starting relay for new asset...');
        await this.startRelay();
      } else {
        this.logger.log(`📡 Relay already running with ${this.normalAssets.length} assets`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to handle new simulator asset: ${error.message}`);
    }
  }

  @OnEvent('asset.refresh.requested')
  async handleRefreshRequest() {
    this.logger.log('🔄 Manual refresh requested for simulator relay');
    await this.loadNormalAssets();
    if (this.normalAssets.length > 0 && !this.isRunning) {
      await this.startRelay();
    }
  }

  @Cron('*/1 * * * *') // ✅ Setiap 1 menit
  async refreshAssets() {
    const previousCount = this.normalAssets.length;
    await this.loadNormalAssets();
    const currentCount = this.normalAssets.length;
    
    if (previousCount !== currentCount) {
      this.logger.log(`🔄 Assets changed: ${previousCount} → ${currentCount}`);
    }
    
    if (previousCount === 0 && currentCount > 0 && !this.isRunning) {
      this.logger.log('✅ Assets detected, starting relay...');
      await this.startRelay();
    } else if (currentCount === 0 && this.isRunning) {
      this.logger.warn('⚠️ No more assets, stopping relay...');
      this.stopRelay();
    }
  }

  private async loadNormalAssets() {
    try {
      const { assets } = await this.assetsService.getAllAssets(true);
      
      this.normalAssets = assets.filter(a => a.category === ASSET_CATEGORY.NORMAL);
      
      this.logger.log(`📡 Loaded ${this.normalAssets.length} normal assets for relay`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to load normal assets: ${error.message}`);
      this.normalAssets = [];
    }
  }

  private async startRelay() {
    if (this.isRunning) {
      this.logger.warn('⚠️ Relay already running');
      return;
    }
    
    if (this.normalAssets.length === 0) {
      this.logger.warn('⚠️ Cannot start relay: no normal assets');
      return;
    }
    
    this.isRunning = true;
    
    this.logger.log('🚀 Starting simulator price relay...');
    this.logger.log(`   Assets: ${this.normalAssets.map(a => a.symbol).join(', ')}`);
    
    this.relayInterval = setInterval(async () => {
      await this.relayPrices();
    }, 1000);
    
    this.logger.log('✅ Simulator price relay started');
  }

  private stopRelay() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.relayInterval) {
      clearInterval(this.relayInterval);
      this.relayInterval = null;
    }
    
    this.logger.log('🛑 Simulator price relay stopped');
  }

  private async relayPrices() {
    if (this.normalAssets.length === 0) return;
    
    const results = await Promise.allSettled(
      this.normalAssets.map(asset => this.relayAssetPrice(asset))
    );
    
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failCount = results.filter(r => r.status === 'rejected').length;
    
    if (failCount > 0) {
      this.errorCount += failCount;
    }
    
    if (successCount > 0) {
      this.relayCount += successCount;
      this.lastSuccessTime = Date.now();
    }
  }

  private async relayAssetPrice(asset: Asset): Promise<void> {
    try {
      const path = this.getAssetPath(asset);
      
      const priceData = await this.firebaseService.getRealtimeDbValue(
        `${path}/current_price`,
        true
      );
      
      if (!priceData || !priceData.price) {
        return;
      }
      
      this.tradingGateway.emitPriceUpdate(asset.id, {
        price: priceData.price,
        timestamp: priceData.timestamp,
        datetime: priceData.datetime,
        volume24h: 0,
        changePercent24h: priceData.change || 0,
        high24h: priceData.price,
        low24h: priceData.price,
      });
      
    } catch (error) {
      this.logger.debug(`Relay failed for ${asset.symbol}: ${error.message}`);
      throw error;
    }
  }

  private getAssetPath(asset: Asset): string {
    if (asset.realtimeDbPath) {
      return asset.realtimeDbPath.startsWith('/') 
        ? asset.realtimeDbPath 
        : `/${asset.realtimeDbPath}`;
    }
    
    if (asset.dataSource === 'mock') {
      return `/mock/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }
    
    if (asset.dataSource === 'api' && asset.apiEndpoint) {
      return `/api/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }
    
    return `/${asset.symbol.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }

  getStatus() {
    const timeSinceLastSuccess = this.lastSuccessTime > 0 
      ? Math.floor((Date.now() - this.lastSuccessTime) / 1000)
      : null;
    
    return {
      isRunning: this.isRunning,
      normalAssets: this.normalAssets.length,
      relayCount: this.relayCount,
      errorCount: this.errorCount,
      lastSuccess: timeSinceLastSuccess !== null 
        ? `${timeSinceLastSuccess}s ago`
        : 'Never',
      isHealthy: this.isRunning && timeSinceLastSuccess !== null && timeSinceLastSuccess < 10,
      assets: this.normalAssets.map(a => ({
        symbol: a.symbol,
        path: this.getAssetPath(a),
      })),
    };
  }

  async onModuleDestroy() {
    this.stopRelay();
    if (this.assetsListenerUnsubscribe) {
      this.assetsListenerUnsubscribe();
    }
  }
}