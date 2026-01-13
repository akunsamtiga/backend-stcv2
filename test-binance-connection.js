// test-binance-connection.js
// ✅ Standalone test script for Binance API connection

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';
const TEST_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
  'SOLUSDT', 'DOTUSDT', 'DOGEUSDT', 'MATICUSDT', 'LTCUSDT'
];

class BinanceConnectionTester {
  constructor() {
    this.successCount = 0;
    this.failedCount = 0;
    this.errors = [];
  }

  async testConnection() {
    console.log('🧪 ================================================');
    console.log('🧪 BINANCE API CONNECTION TEST');
    console.log('🧪 ================================================');
    console.log(`🧪 Base URL: ${BINANCE_BASE_URL}`);
    console.log(`🧪 Timestamp: ${new Date().toISOString()}`);
    console.log('🧪 ================================================\n');

    // Test 1: Ping endpoint
    await this.testPing();
    
    // Test 2: Server Time
    await this.testServerTime();
    
    // Test 3: Exchange Info (rate limits & symbols)
    await this.testExchangeInfo();
    
    // Test 4: Ticker data for multiple symbols
    await this.testTickerData();
    
    // Test 5: Test specific crypto pairs
    await this.testCryptoPairs();
    
    // Summary
    this.printSummary();
  }

  async testPing() {
    console.log('📡 Test 1: Ping Endpoint');
    try {
      const start = Date.now();
      const response = await axios.get(`${BINANCE_BASE_URL}/ping`);
      const duration = Date.now() - start;
      
      console.log(`✅ Ping successful in ${duration}ms`);
      console.log(`   Status: ${response.status}`);
      console.log(`   Data: ${JSON.stringify(response.data)}\n`);
      this.successCount++;
    } catch (error) {
      console.log(`❌ Ping failed: ${error.message}\n`);
      this.failedCount++;
      this.errors.push({ test: 'Ping', error: error.message });
    }
  }

  async testServerTime() {
    console.log('📡 Test 2: Server Time');
    try {
      const response = await axios.get(`${BINANCE_BASE_URL}/time`);
      const serverTime = response.data.serverTime;
      const localTime = Date.now();
      const diff = Math.abs(localTime - serverTime);
      
      console.log(`✅ Server time retrieved`);
      console.log(`   Server Time: ${new Date(serverTime).toISOString()}`);
      console.log(`   Local Time:  ${new Date(localTime).toISOString()}`);
      console.log(`   Difference:  ${diff}ms ${diff > 1000 ? '⚠️ High latency!' : '✅ OK'}\n`);
      this.successCount++;
    } catch (error) {
      console.log(`❌ Server time failed: ${error.message}\n`);
      this.failedCount++;
      this.errors.push({ test: 'Server Time', error: error.message });
    }
  }

  async testExchangeInfo() {
    console.log('📡 Test 3: Exchange Info (Symbols & Rate Limits)');
    try {
      const response = await axios.get(`${BINANCE_BASE_URL}/exchangeInfo`);
      const symbols = response.data.symbols;
      const rateLimits = response.data.rateLimits;
      
      console.log(`✅ Exchange info retrieved`);
      console.log(`   Total Symbols: ${symbols.length}`);
      console.log(`   Rate Limits: ${JSON.stringify(rateLimits, null, 2)}`);
      
      // Check for our target symbols
      const ourSymbols = symbols.filter(s => 
        TEST_SYMBOLS.includes(s.symbol)
      );
      console.log(`   Found ${ourSymbols.length}/${TEST_SYMBOLS.length} target symbols`);
      
      // Show first 5 symbols as sample
      console.log(`   Sample symbols: ${symbols.slice(0, 5).map(s => s.symbol).join(', ')}\n`);
      this.successCount++;
    } catch (error) {
      console.log(`❌ Exchange info failed: ${error.message}\n`);
      this.failedCount++;
      this.errors.push({ test: 'Exchange Info', error: error.message });
    }
  }

  async testTickerData() {
    console.log('📡 Test 4: 24hr Ticker Data');
    
    for (const symbol of TEST_SYMBOLS.slice(0, 3)) { // Test first 3 symbols
      try {
        const start = Date.now();
        const response = await axios.get(`${BINANCE_BASE_URL}/ticker/24hr`, {
          params: { symbol }
        });
        const duration = Date.now() - start;
        
        const data = response.data;
        console.log(`✅ ${symbol} - ${duration}ms`);
        console.log(`   Price: $${parseFloat(data.lastPrice).toFixed(2)}`);
        console.log(`   Change: ${parseFloat(data.priceChangePercent).toFixed(2)}%`);
        console.log(`   Volume: ${parseFloat(data.volume).toFixed(2)}`);
        console.log(`   High: $${parseFloat(data.highPrice).toFixed(2)}`);
        console.log(`   Low: $${parseFloat(data.lowPrice).toFixed(2)}\n`);
        this.successCount++;
      } catch (error) {
        console.log(`❌ ${symbol} failed: ${error.message}`);
        if (error.response?.data) {
          console.log(`   Response: ${JSON.stringify(error.response.data)}\n`);
        }
        this.failedCount++;
        this.errors.push({ test: `Ticker ${symbol}`, error: error.message });
      }
    }
  }

  async testCryptoPairs() {
    console.log('📡 Test 5: Crypto Pairs from Your Backend Format');
    
    // Test conversion from base/quote to Binance format
    const testPairs = [
      { base: 'BTC', quote: 'USD' },
      { base: 'ETH', quote: 'USDT' },
      { base: 'BNB', quote: 'USD' },
      { base: 'XRP', quote: 'USDT' },
      { base: 'INVALID', quote: 'USD' }
    ];

    for (const pair of testPairs) {
      const symbol = pair.quote === 'USD' ? `${pair.base}USDT` : `${pair.base}${pair.quote}`;
      console.log(`🔄 Testing ${pair.base}/${pair.quote} → ${symbol}`);
      
      try {
        const response = await axios.get(`${BINANCE_BASE_URL}/ticker/24hr`, {
          params: { symbol }
        });
        
        console.log(`✅ ${symbol} - $${parseFloat(response.data.lastPrice).toFixed(2)}`);
        console.log(`   24h Change: ${parseFloat(response.data.priceChangePercent).toFixed(2)}%\n`);
        this.successCount++;
      } catch (error) {
        console.log(`❌ ${symbol} failed: ${error.response?.data?.msg || error.message}\n`);
        this.failedCount++;
        this.errors.push({ test: `Pair ${pair.base}/${pair.quote}`, error: error.message });
      }
    }
  }

  printSummary() {
    console.log('🧪 ================================================');
    console.log('🧪 TEST SUMMARY');
    console.log('🧪 ================================================');
    console.log(`✅ Passed: ${this.successCount}`);
    console.log(`❌ Failed: ${this.failedCount}`);
    console.log(`📊 Success Rate: ${Math.round((this.successCount / (this.successCount + this.failedCount)) * 100)}%`);
    
    if (this.errors.length > 0) {
      console.log('\n📋 Errors:');
      this.errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err.test}: ${err.error}`);
      });
    }
    
    console.log('\n🧪 ================================================');
    
    if (this.failedCount > 0) {
      console.log('⚠️  WARNING: Some tests failed!');
      console.log('   Common issues:');
      console.log('   1. Network connectivity');
      console.log('   2. Binance API rate limits (1200 req/min)');
      console.log('   3. Invalid symbol format');
      console.log('   4. Binance server issues');
      console.log('🧪 ================================================');
      process.exit(1);
    } else {
      console.log('🎉 All tests passed! Binance API is working correctly.');
      console.log('🧪 ================================================');
      process.exit(0);
    }
  }
}

// Run the test
const tester = new BinanceConnectionTester();
tester.testConnection().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});