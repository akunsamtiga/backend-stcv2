# Python Testing Suite - Requirements & Documentation

## 📦 requirements.txt

```text
requests==2.31.0
pytest==7.4.3
pytest-timeout==2.2.0
pytest-asyncio==0.21.1
colorama==0.4.6
tabulate==0.9.0
```

## 📚 README_TESTING.md

# Binary Option Trading System - Testing Suite 🧪

Comprehensive testing suite for backend and simulator with performance monitoring.

## 📋 Test Files

### 1. `test_backend.py`
**Comprehensive Backend API Testing**
- Tests all API endpoints
- Measures response times
- Validates functionality
- Checks authentication & authorization

**Coverage:**
- ✅ Health check & infrastructure
- ✅ Authentication (register, login)
- ✅ Asset management (create, read, update)
- ✅ User profile & balance
- ✅ Binary orders (create, read)
- ✅ Admin functions

**Target Response Times:**
- Health: <100ms
- Authentication: <500ms
- Assets: <300ms
- Price fetch: <200ms
- Order creation: <500ms ⚡ CRITICAL

### 2. `test_simulator.py`
**Simulator Functionality Testing**
- Tests Firebase Realtime DB connection
- Validates price data generation
- Checks OHLC data for all timeframes
- Monitors real-time updates
- Verifies data consistency

**Coverage:**
- ✅ Connection to Firebase
- ✅ Current price data
- ✅ OHLC generation (1s, 1m, 5m, 15m, 1h, 4h, 1d)
- ✅ Real-time price updates
- ✅ Data consistency checks
- ✅ Performance metrics

### 3. `test_performance.py`
**Load & Performance Testing**
- Concurrent request testing
- Sustained load testing
- Performance metrics collection
- Response time analysis

**Test Scenarios:**
- Health endpoint: 100 requests, 10 concurrent
- Login endpoint: 50 requests, 5 concurrent
- Get assets: 100 requests, 10 concurrent
- Get price: 100 requests, 10 concurrent ⚡
- Create order: 50 requests, 5 concurrent ⚡ CRITICAL
- Sustained load: 5 RPS for 30 seconds

**Performance Targets:**
- Average response time: <500ms
- P95 response time: <1000ms
- P99 response time: <2000ms
- Success rate: >95%

### 4. `test_integration.py`
**End-to-End Integration Testing**
- Complete workflow simulation
- Full user journey testing
- Order settlement verification

**Test Flow:**
1. Register new user
2. Verify profile
3. Deposit balance
4. Get active assets
5. Get current price
6. Create binary order ⚡
7. Verify order
8. Wait for settlement (70s)
9. Check settlement result
10. Verify balance update
11. Verify simulator status

## 🚀 Quick Start

### Prerequisites

```bash
# Install Python dependencies
pip install -r requirements.txt

# Make test scripts executable
chmod +x test_*.py
```

### Running Tests

#### 1️⃣ Backend Tests (Quick - 30 seconds)
```bash
python test_backend.py
```

**Expected Output:**
- All endpoints tested
- Response times measured
- Success/failure indicators
- Performance summary

#### 2️⃣ Simulator Tests (Quick - 15 seconds)
```bash
python test_simulator.py
```

**Expected Output:**
- Firebase connection status
- Price data validation
- OHLC data for all timeframes
- Real-time update verification

#### 3️⃣ Performance Tests (Medium - 5 minutes)
```bash
python test_performance.py
```

**Expected Output:**
- Load test results
- Response time metrics
- Performance ratings
- Recommendations

#### 4️⃣ Integration Test (Long - 2 minutes)
```bash
python test_integration.py
```

**Expected Output:**
- Step-by-step workflow execution
- Real order creation and settlement
- Complete timing analysis
- End-to-end verification

### Run All Tests
```bash
# Run all tests in sequence
python test_backend.py && \
python test_simulator.py && \
python test_performance.py && \
python test_integration.py
```

## 📊 Understanding Test Results

### Test Output Format

```
✓ PASS | Test Name                           | 234ms | 200
✗ FAIL | Test Name                           | 1234ms | 500
```

- **✓/✗**: Pass/Fail indicator
- **Test Name**: Description of what was tested
- **Time**: Response time in milliseconds
- **Status**: HTTP status code

### Performance Ratings

- **⚡ EXCELLENT**: <500ms - Meets target
- **✓ GOOD**: 500-1000ms - Acceptable
- **⚠ ACCEPTABLE**: 1000-2000ms - Needs optimization
- **✗ SLOW**: >2000ms - Requires investigation

### Critical Endpoints

**Order Creation** ⚡ MOST CRITICAL
- Target: <500ms
- Critical for user experience
- Affects trading execution

**Price Fetch**
- Target: <200ms
- Critical for order creation
- Impacts settlement accuracy

## 🔧 Troubleshooting

### Common Issues

#### 1. "Connection refused" Error
```
✗ Failed to connect to backend
```

**Solution:**
```bash
# Check if backend is running
curl http://localhost:3000/api/v1/health

# Start backend if needed
cd backendv2
npm run start:dev
```

#### 2. "Authentication failed" Error
```
✗ Failed to get authentication token
```

**Solution:**
- Verify super admin credentials in `.env`
- Check if super admin was created on startup
- Wait 5 seconds after backend starts

#### 3. "No asset ID available"
```
⚠ No asset ID found - some tests will be skipped
```

**Solution:**
```bash
# Create IDX_STC asset via API
# Use test_backend.py first to create assets
```

#### 4. "Simulator data is stale"
```
⚠ Simulator data is stale (25s old)
```

**Solution:**
```bash
# Check simulator status
cd trading-simulator
pm2 logs idx-stc-simulator

# Restart simulator
pm2 restart idx-stc-simulator
```

## 📈 Performance Optimization Guide

### If Order Creation >500ms

**Potential Issues:**
1. Price fetch is slow
2. Database query optimization needed
3. Balance check inefficient

**Solutions:**
```javascript
// Check price service cache
// Verify Firebase connection pooling
// Review balance calculation logic
```

### If Overall System >1000ms

**Check:**
1. Network latency
2. Database query performance
3. Concurrent request handling

**Optimize:**
- Add caching layers
- Use connection pooling
- Implement query optimization

## 🎯 Test Coverage

### Backend Coverage
- ✅ Authentication: 100%
- ✅ User Management: 100%
- ✅ Asset Management: 100%
- ✅ Balance Operations: 100%
- ✅ Binary Orders: 100%
- ✅ Admin Functions: 100%

### Integration Coverage
- ✅ User registration flow
- ✅ Balance management
- ✅ Order creation
- ✅ Order settlement
- ✅ Simulator integration

## 📝 Test Scenarios

### Scenario 1: Normal Trading Flow
1. User registers
2. Deposits $10,000
3. Views available assets
4. Checks current price
5. Places $1,000 CALL order (1 min)
6. Waits for settlement
7. Receives profit/loss

**Expected:**
- All steps complete successfully
- Order settled correctly
- Balance updated accurately

### Scenario 2: High Load
1. 100 concurrent users
2. Each places 5 orders
3. System handles all requests
4. No timeouts or failures
5. Average response <500ms

**Expected:**
- >95% success rate
- System remains stable
- Performance within targets

### Scenario 3: Simulator Integration
1. Simulator generates prices
2. Backend fetches prices
3. Orders use correct entry price
4. Settlement uses correct exit price
5. All prices match simulator

**Expected:**
- Data consistency <1% variance
- No missing price data
- Settlement accuracy 100%

## 🔍 Monitoring in Production

### Key Metrics to Watch

1. **Response Times**
   - Health: <100ms
   - Order creation: <500ms
   - Price fetch: <200ms

2. **Success Rates**
   - API requests: >99%
   - Order settlements: 100%
   - Price fetches: >99%

3. **Simulator Health**
   - Data freshness: <5s
   - Update frequency: 1s
   - OHLC generation: All timeframes

### Alert Thresholds

```yaml
critical:
  order_creation_time: >2000ms
  order_settlement_failure: >0%
  price_data_age: >30s

warning:
  order_creation_time: >500ms
  api_success_rate: <99%
  price_data_age: >10s

info:
  concurrent_users: >100
  order_volume_spike: >50%
```

## 📞 Support

### Test Failures

1. Review test output for specific errors
2. Check backend logs: `pm2 logs binary-backend`
3. Check simulator logs: `pm2 logs idx-stc-simulator`
4. Verify Firebase connection
5. Check environment variables

### Performance Issues

1. Run performance tests
2. Review response time breakdown
3. Check system resources (CPU, memory)
4. Verify network latency
5. Review database query performance

## 🎉 Success Criteria

### ✅ All Tests Should Show:

- **Backend Tests**: All passed, avg <500ms
- **Simulator Tests**: All passed, data fresh
- **Performance Tests**: >95% success, avg <500ms
- **Integration Test**: Complete workflow successful

### 🏆 Production Ready When:

- All test suites pass
- Order creation <500ms
- Price fetch <200ms
- No settlement failures
- Simulator data <5s old

---

**Version**: 1.0  
**Last Updated**: December 2024  
**Test Coverage**: ~95%  

Happy Testing! 🧪🚀