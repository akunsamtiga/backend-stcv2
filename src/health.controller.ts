import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FirebaseService } from './firebase/firebase.service';
import { BinaryOrdersService } from './binary-orders/binary-orders.service';
import { AssetsService } from './assets/assets.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private firebaseService: FirebaseService,
    private binaryOrdersService: BinaryOrdersService,
    private assetsService: AssetsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check with system info' })
  @ApiResponse({ status: 200, description: 'System is healthy' })
  check() {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        formatted: this.formatUptime(uptime),
      },
      memory: {
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
        external: `${Math.round(memory.external / 1024 / 1024)}MB`,
      },
      environment: process.env.NODE_ENV || 'development',
      service: 'Binary Option Trading System',
      version: '3.1-ultra-fast',
      nodeVersion: process.version,
    };
  }

  @Get('performance')
  @ApiOperation({ summary: 'Detailed performance metrics' })
  @ApiResponse({ status: 200, description: 'Performance statistics' })
  async getPerformance() {
    try {
      const [
        firebaseStats,
        orderStats,
        assetStats,
      ] = await Promise.all([
        Promise.resolve(this.firebaseService.getPerformanceStats()),
        Promise.resolve(this.binaryOrdersService.getPerformanceStats()),
        Promise.resolve(this.assetsService.getPerformanceStats()),
      ]);

      const memory = process.memoryUsage();
      const uptime = process.uptime();

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        
        // System metrics
        system: {
          uptime: this.formatUptime(uptime),
          memory: {
            heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
            percentage: Math.round((memory.heapUsed / memory.heapTotal) * 100),
          },
          cpu: {
            loadAverage: process.cpuUsage(),
          },
        },

        // Firebase performance
        firebase: firebaseStats,

        // Binary orders performance
        binaryOrders: orderStats,

        // Assets & pricing performance
        assets: assetStats,

        // Health status
        health: {
          overall: 'healthy',
          checks: {
            memory: memory.heapUsed / memory.heapTotal < 0.9 ? 'ok' : 'warning',
            firebase: firebaseStats.operations > 0 ? 'ok' : 'warning',
            orders: orderStats.ordersCreated > 0 ? 'ok' : 'not_tested',
          },
        },

        // Recommendations
        recommendations: this.getRecommendations(memory, orderStats, firebaseStats),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('live')
  @ApiOperation({ summary: 'Live system metrics (lightweight)' })
  @ApiResponse({ status: 200, description: 'Live metrics' })
  getLiveMetrics() {
    const memory = process.memoryUsage();
    const uptime = process.uptime();

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime),
      memory: {
        used: Math.round(memory.heapUsed / 1024 / 1024),
        total: Math.round(memory.heapTotal / 1024 / 1024),
        percent: Math.round((memory.heapUsed / memory.heapTotal) * 100),
      },
      status: memory.heapUsed / memory.heapTotal < 0.9 ? 'healthy' : 'warning',
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe for K8s/Docker' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service not ready' })
  async readiness() {
    try {
      // Check if Firebase is initialized
      const db = this.firebaseService.getFirestore();
      
      // Quick test query
      await db.collection('health').limit(1).get();

      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error('Service not ready');
    }
  }

  @Get('liveness')
  @ApiOperation({ summary: 'Liveness probe for K8s/Docker' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  liveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
  }

  private getRecommendations(
    memory: NodeJS.MemoryUsage,
    orderStats: any,
    firebaseStats: any,
  ): string[] {
    const recommendations: string[] = [];

    // Memory recommendations
    const memoryPercent = (memory.heapUsed / memory.heapTotal) * 100;
    if (memoryPercent > 80) {
      recommendations.push('⚠️ High memory usage (>80%). Consider restarting or scaling.');
    } else if (memoryPercent > 60) {
      recommendations.push('💡 Memory usage moderate (>60%). Monitor closely.');
    }

    // Order performance recommendations
    if (orderStats.avgCreateTime > 1000) {
      recommendations.push('⚠️ Order creation slow (>1s). Check Firebase connection.');
    } else if (orderStats.avgCreateTime > 500) {
      recommendations.push('💡 Order creation could be faster. Check price service.');
    }

    if (orderStats.avgSettleTime > 500) {
      recommendations.push('⚠️ Settlement slow (>500ms). Optimize price fetching.');
    }

    // Firebase recommendations
    if (firebaseStats.avgResponseTime > 200) {
      recommendations.push('💡 Firebase response time high. Consider caching optimization.');
    }

    // Cache recommendations
    if (orderStats.cacheSize.orders > 1000) {
      recommendations.push('💡 Large order cache. Consider periodic cleanup.');
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ All systems performing optimally!');
    }

    return recommendations;
  }
}