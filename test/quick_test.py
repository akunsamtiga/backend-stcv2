#!/usr/bin/env python3
"""
Binary Option Trading System - Quick Test
=========================================
Fast 30-second verification test
"""

import requests
import time
import sys

# Colors
class C:
    G = '\033[92m'  # Green
    R = '\033[91m'  # Red
    Y = '\033[93m'  # Yellow
    B = '\033[94m'  # Blue
    C = '\033[96m'  # Cyan
    BOLD = '\033[1m'
    END = '\033[0m'

BASE_URL = "http://localhost:3000/api/v1"
FIREBASE_URL = "https://stc-autotrade-18f67-default-rtdb.asia-southeast1.firebasedatabase.app"

def test(name, func):
    """Run a test"""
    print(f"\n{C.B}Testing:{C.END} {name}...", end=' ')
    try:
        start = time.time()
        result = func()
        elapsed = (time.time() - start) * 1000
        
        if result:
            print(f"{C.G}✓ PASS{C.END} ({elapsed:.0f}ms)")
            return True
        else:
            print(f"{C.R}✗ FAIL{C.END}")
            return False
    except Exception as e:
        print(f"{C.R}✗ ERROR{C.END} - {str(e)}")
        return False

def test_backend_health():
    """Test backend health"""
    r = requests.get(f"{BASE_URL}/health", timeout=5)
    return r.status_code == 200

def test_backend_performance():
    """Test backend performance metrics"""
    r = requests.get(f"{BASE_URL}/health/performance", timeout=5)
    return r.status_code == 200

def test_auth():
    """Test authentication"""
    r = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": "superadmin@trading.com", "password": "SuperAdmin123!"},
        timeout=10
    )
    return r.status_code == 200 and "token" in r.text

def test_assets():
    """Test assets endpoint"""
    # Login first
    r = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": "superadmin@trading.com", "password": "SuperAdmin123!"},
        timeout=10
    )
    
    if r.status_code != 200:
        return False
    
    token = r.json().get("data", {}).get("token", "")
    
    # Get assets
    r = requests.get(
        f"{BASE_URL}/assets",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10
    )
    
    return r.status_code == 200

def test_simulator_connection():
    """Test simulator connection"""
    r = requests.get(f"{FIREBASE_URL}/idx_stc/current_price.json", timeout=5)
    return r.status_code == 200

def test_simulator_data():
    """Test simulator data quality"""
    r = requests.get(f"{FIREBASE_URL}/idx_stc/current_price.json", timeout=5)
    
    if r.status_code != 200:
        return False
    
    data = r.json()
    
    if not data:
        return False
    
    # Check data age
    timestamp = data.get('timestamp', 0)
    age = time.time() - timestamp
    
    return age < 30  # Less than 30 seconds old

def main():
    """Run quick tests"""
    print(f"\n{C.BOLD}{C.C}{'='*60}")
    print(f"🧪 BINARY OPTION - QUICK TEST")
    print(f"{'='*60}{C.END}\n")
    
    tests_run = []
    
    # Backend tests
    print(f"{C.BOLD}BACKEND TESTS{C.END}")
    tests_run.append(test("Backend Health", test_backend_health))
    tests_run.append(test("Performance Metrics", test_backend_performance))
    tests_run.append(test("Authentication", test_auth))
    tests_run.append(test("Assets API", test_assets))
    
    # Simulator tests
    print(f"\n{C.BOLD}SIMULATOR TESTS{C.END}")
    tests_run.append(test("Simulator Connection", test_simulator_connection))
    tests_run.append(test("Simulator Data Quality", test_simulator_data))
    
    # Summary
    passed = sum(tests_run)
    total = len(tests_run)
    
    print(f"\n{C.BOLD}{C.C}{'='*60}{C.END}")
    print(f"{C.BOLD}RESULTS{C.END}")
    print(f"{C.C}{'='*60}{C.END}")
    
    print(f"\nTotal Tests: {total}")
    print(f"{C.G}✓ Passed:{C.END} {passed}")
    print(f"{C.R}✗ Failed:{C.END} {total - passed}")
    print(f"Success Rate: {(passed/total*100):.1f}%")
    
    if passed == total:
        print(f"\n{C.G}{C.BOLD}✅ ALL TESTS PASSED!{C.END}")
        print(f"{C.G}System is working correctly{C.END}")
        print(f"\n{C.C}Next steps:{C.END}")
        print(f"  • Run: {C.BOLD}python3 test_backend.py{C.END} (full backend tests)")
        print(f"  • Run: {C.BOLD}python3 run_all_tests.py{C.END} (complete test suite)")
    else:
        print(f"\n{C.R}{C.BOLD}❌ SOME TESTS FAILED{C.END}")
        print(f"{C.Y}Check backend and simulator are running{C.END}")
        print(f"\n{C.Y}Troubleshooting:{C.END}")
        print(f"  • Backend: cd backendv2 && npm run start:dev")
        print(f"  • Simulator: cd trading-simulator && npm start")
    
    print()
    
    sys.exit(0 if passed == total else 1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{C.Y}Test interrupted{C.END}")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n{C.R}Error: {str(e)}{C.END}")
        sys.exit(1)