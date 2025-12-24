# 🚀 Quick Start Testing Guide

## ⚡ 3-Minute Setup

### Step 1: Setup (1 minute)
```bash
# Run setup script
bash setup_tests.sh
```

### Step 2: Start Services
```bash
# Terminal 1: Start Backend
cd backendv2
npm run start:dev

# Terminal 2: Start Simulator  
cd trading-simulator
npm start
```

### Step 3: Run Tests (2 minutes)
```bash
# Quick backend test (30 seconds)
python3 test_backend.py

# Full test suite (5-10 minutes)
python3 run_all_tests.py
```

## 📊 Test Files Overview

| File | Duration | Description |
|------|----------|-------------|
| `test_backend.py` | 30s | Tests all API endpoints |
| `test_simulator.py` | 15s | Tests price simulator |
| `test_performance.py` | 5m | Load & performance tests |
| `test_integration.py` | 2m | End-to-end workflow |
| `run_all_tests.py` | 10m | Runs all tests + report |

## 🎯 What Gets Tested

### Backend API (test_backend.py)
✅ Health check & infrastructure  
✅ Authentication (register, login)  
✅ User profile & balance  
✅ Asset management  
✅ Binary orders (create, read)  
✅ Response times for all endpoints  

### Simulator (test_simulator.py)
✅ Firebase connection  
✅ Current price data  
✅ OHLC generation (all timeframes)  
✅ Real-time updates  
✅ Data consistency  

### Performance (test_performance.py)
✅ Concurrent request handling  
✅ Load testing (100+ requests)  
✅ Response time analysis  
✅ System stability under load  
✅ Critical endpoint performance  

### Integration (test_integration.py)
✅ Complete user registration flow  
✅ Balance deposit & verification  
✅ Asset selection & price fetch  
✅ Order creation (< 500ms target)  
✅ Order settlement verification  
✅ End-to-end workflow timing  

## 🎨 Expected Output

### ✅ Success
```
✓ PASS | Test Name                           | 234ms | 200
```

### ❌ Failure
```
✗ FAIL | Test Name                           | 1234ms | 500
      Error: Connection timeout
```

### 📊 Summary
```
Total Tests:    15
✓ Passed:       15
✗ Failed:       0
Success Rate:   100%
Avg Response:   342ms
```

## ⚡ Critical Performance Targets

| Endpoint | Target | Critical |
|----------|--------|----------|
| Health Check | <100ms | No |
| Login | <500ms | No |
| Get Assets | <300ms | No |
| **Get Price** | **<200ms** | **YES** ⚡ |
| **Create Order** | **<500ms** | **YES** ⚡ |
| Get Orders | <500ms | No |

## 🔍 Quick Troubleshooting

### Backend Not Running
```bash
cd backendv2
npm install
npm run start:dev
```

### Simulator Not Running
```bash
cd trading-simulator
npm install
npm start
```

### Tests Failing
```bash
# Check backend logs
pm2 logs binary-backend

# Check simulator logs
pm2 logs idx-stc-simulator

# Verify environment
cat backendv2/.env
cat trading-simulator/.env
```

### Slow Response Times
- Check network latency
- Verify Firebase connection
- Review backend logs
- Check system resources (CPU, RAM)

## 📈 Performance Ratings

| Time | Rating | Action |
|------|--------|--------|
| <500ms | ⚡ EXCELLENT | None needed |
| 500-1000ms | ✓ GOOD | Monitor |
| 1000-2000ms | ⚠ ACCEPTABLE | Optimize |
| >2000ms | ✗ SLOW | Fix required |

## 🎯 Common Test Scenarios

### Scenario 1: Quick Smoke Test (1 minute)
```bash
python3 test_backend.py
```
Tests: Basic API functionality

### Scenario 2: Performance Check (5 minutes)
```bash
python3 test_performance.py
```
Tests: System under load

### Scenario 3: Complete Verification (10 minutes)
```bash
python3 run_all_tests.py
```
Tests: Everything + detailed report

### Scenario 4: End-to-End (2 minutes)
```bash
python3 test_integration.py
```
Tests: Complete trading workflow

## 💡 Tips

1. **Before Production**: Run `run_all_tests.py`
2. **Daily Checks**: Run `test_backend.py`
3. **Performance Issues**: Run `test_performance.py`
4. **New Features**: Run `test_integration.py`

## 📞 Need Help?

1. Check `README_TESTING.md` for detailed guide
2. Review test output for specific errors
3. Check backend/simulator logs
4. Verify `.env` configuration

## 🎉 Success Criteria

✅ All tests pass  
✅ Order creation <500ms  
✅ Price fetch <200ms  
✅ No settlement failures  
✅ Simulator data <5s old  

---

**Ready to test?** Run: `python3 run_all_tests.py`