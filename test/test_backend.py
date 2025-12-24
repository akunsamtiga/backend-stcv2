#!/usr/bin/env python3
"""
Binary Option Trading System - Comprehensive Backend API Testing
================================================================
Tests all endpoints with response time monitoring
"""

import requests
import time
import json
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import sys

# ============================================
# CONFIGURATION
# ============================================
BASE_URL = "http://localhost:3000/api/v1"
SUPER_ADMIN_EMAIL = "superadmin@trading.com"
SUPER_ADMIN_PASSWORD = "SuperAdmin123!"

# Test data
TEST_USER_EMAIL = "testuser@example.com"
TEST_USER_PASSWORD = "TestUser123!"
TEST_ADMIN_EMAIL = "testadmin@example.com"
TEST_ADMIN_PASSWORD = "TestAdmin123!"

# ============================================
# DATA CLASSES
# ============================================
@dataclass
class TestResult:
    name: str
    passed: bool
    response_time: float
    status_code: int
    message: str
    details: Optional[Dict] = None

@dataclass
class TestSession:
    super_admin_token: str = ""
    admin_token: str = ""
    user_token: str = ""
    asset_id: str = ""
    order_id: str = ""
    user_id: str = ""

# ============================================
# UTILS
# ============================================
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'

def print_header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*60}")
    print(f"{text}")
    print(f"{'='*60}{Colors.END}\n")

def print_test_result(result: TestResult):
    status = f"{Colors.GREEN}✓ PASS" if result.passed else f"{Colors.RED}✗ FAIL"
    print(f"{status}{Colors.END} | {result.name:<40} | {result.response_time:>6.0f}ms | {result.status_code}")
    if not result.passed:
        print(f"      {Colors.RED}Error: {result.message}{Colors.END}")

def make_request(
    method: str,
    endpoint: str,
    headers: Optional[Dict] = None,
    json_data: Optional[Dict] = None,
    params: Optional[Dict] = None
) -> Tuple[requests.Response, float]:
    """Make HTTP request and measure time"""
    url = f"{BASE_URL}{endpoint}"
    
    start_time = time.time()
    try:
        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            json=json_data,
            params=params,
            timeout=30
        )
        elapsed = (time.time() - start_time) * 1000  # Convert to ms
        return response, elapsed
    except Exception as e:
        elapsed = (time.time() - start_time) * 1000
        raise Exception(f"Request failed: {str(e)}")

# ============================================
# TEST FUNCTIONS
# ============================================
def test_health_check() -> TestResult:
    """Test health check endpoint"""
    try:
        response, elapsed = make_request("GET", "/health")
        
        passed = response.status_code == 200
        data = response.json() if passed else {}
        
        return TestResult(
            name="Health Check",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="OK" if passed else "Failed",
            details=data
        )
    except Exception as e:
        return TestResult(
            name="Health Check",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

def test_super_admin_login() -> Tuple[TestResult, str]:
    """Test super admin login"""
    try:
        response, elapsed = make_request(
            "POST",
            "/auth/login",
            json_data={
                "email": SUPER_ADMIN_EMAIL,
                "password": SUPER_ADMIN_PASSWORD
            }
        )
        
        passed = response.status_code == 200
        token = ""
        
        if passed:
            data = response.json()
            token = data.get("data", {}).get("token", "")
            passed = bool(token)
        
        return TestResult(
            name="Super Admin Login",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="Token received" if passed else "No token"
        ), token
    except Exception as e:
        return TestResult(
            name="Super Admin Login",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        ), ""

def test_user_registration() -> Tuple[TestResult, str]:
    """Test user registration"""
    try:
        response, elapsed = make_request(
            "POST",
            "/auth/register",
            json_data={
                "email": TEST_USER_EMAIL,
                "password": TEST_USER_PASSWORD
            }
        )
        
        # 201 = success, 409 = already exists (also ok for testing)
        passed = response.status_code in [201, 409]
        token = ""
        
        if response.status_code == 201:
            data = response.json()
            token = data.get("data", {}).get("token", "")
        
        return TestResult(
            name="User Registration",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="User created" if response.status_code == 201 else "User exists"
        ), token
    except Exception as e:
        return TestResult(
            name="User Registration",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        ), ""

def test_user_login() -> Tuple[TestResult, str]:
    """Test user login"""
    try:
        response, elapsed = make_request(
            "POST",
            "/auth/login",
            json_data={
                "email": TEST_USER_EMAIL,
                "password": TEST_USER_PASSWORD
            }
        )
        
        passed = response.status_code == 200
        token = ""
        
        if passed:
            data = response.json()
            token = data.get("data", {}).get("token", "")
            passed = bool(token)
        
        return TestResult(
            name="User Login",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="Token received" if passed else "Login failed"
        ), token
    except Exception as e:
        return TestResult(
            name="User Login",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        ), ""

def test_create_asset(token: str) -> Tuple[TestResult, str]:
    """Test creating asset"""
    try:
        response, elapsed = make_request(
            "POST",
            "/assets",
            headers={"Authorization": f"Bearer {token}"},
            json_data={
                "name": "IDX STC Test",
                "symbol": "IDX_STC_TEST",
                "profitRate": 85,
                "isActive": True,
                "dataSource": "mock",
                "description": "Test asset"
            }
        )
        
        passed = response.status_code in [201, 409]  # 409 if already exists
        asset_id = ""
        
        if response.status_code == 201:
            data = response.json()
            asset_id = data.get("data", {}).get("asset", {}).get("id", "")
        
        return TestResult(
            name="Create Asset",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="Asset created" if response.status_code == 201 else "Asset exists"
        ), asset_id
    except Exception as e:
        return TestResult(
            name="Create Asset",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        ), ""

def test_get_all_assets(token: str) -> TestResult:
    """Test getting all assets"""
    try:
        response, elapsed = make_request(
            "GET",
            "/assets",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            assets = data.get("data", {}).get("assets", [])
            passed = len(assets) > 0
        
        return TestResult(
            name="Get All Assets",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Found {len(assets)} assets" if passed else "No assets"
        )
    except Exception as e:
        return TestResult(
            name="Get All Assets",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

def test_get_asset_price(token: str, asset_id: str) -> TestResult:
    """Test getting asset price"""
    if not asset_id:
        return TestResult(
            name="Get Asset Price",
            passed=False,
            response_time=0,
            status_code=0,
            message="No asset ID"
        )
    
    try:
        response, elapsed = make_request(
            "GET",
            f"/assets/{asset_id}/price",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            price = data.get("data", {}).get("price")
            passed = price is not None
        
        return TestResult(
            name="Get Asset Price",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Price: {price}" if passed else "No price"
        )
    except Exception as e:
        return TestResult(
            name="Get Asset Price",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

def test_user_profile(token: str) -> TestResult:
    """Test getting user profile"""
    try:
        response, elapsed = make_request(
            "GET",
            "/user/profile",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        passed = response.status_code == 200
        
        return TestResult(
            name="Get User Profile",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="Profile retrieved" if passed else "Failed"
        )
    except Exception as e:
        return TestResult(
            name="Get User Profile",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

def test_deposit_balance(token: str) -> TestResult:
    """Test depositing balance"""
    try:
        response, elapsed = make_request(
            "POST",
            "/balance",
            headers={"Authorization": f"Bearer {token}"},
            json_data={
                "type": "deposit",
                "amount": 10000,
                "description": "Test deposit"
            }
        )
        
        passed = response.status_code == 201
        
        return TestResult(
            name="Deposit Balance",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="Deposit successful" if passed else "Failed"
        )
    except Exception as e:
        return TestResult(
            name="Deposit Balance",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

def test_get_balance(token: str) -> TestResult:
    """Test getting current balance"""
    try:
        response, elapsed = make_request(
            "GET",
            "/balance/current",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        passed = response.status_code == 200
        balance = 0
        
        if passed:
            data = response.json()
            balance = data.get("data", {}).get("balance", 0)
        
        return TestResult(
            name="Get Current Balance",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Balance: {balance}" if passed else "Failed"
        )
    except Exception as e:
        return TestResult(
            name="Get Current Balance",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

def test_create_binary_order(token: str, asset_id: str) -> Tuple[TestResult, str]:
    """Test creating binary order"""
    if not asset_id:
        return TestResult(
            name="Create Binary Order",
            passed=False,
            response_time=0,
            status_code=0,
            message="No asset ID"
        ), ""
    
    try:
        response, elapsed = make_request(
            "POST",
            "/binary-orders",
            headers={"Authorization": f"Bearer {token}"},
            json_data={
                "asset_id": asset_id,
                "direction": "CALL",
                "amount": 1000,
                "duration": 1
            }
        )
        
        passed = response.status_code == 201
        order_id = ""
        
        if passed:
            data = response.json()
            order_id = data.get("data", {}).get("order", {}).get("id", "")
        
        return TestResult(
            name="Create Binary Order",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Order created (took {elapsed:.0f}ms)" if passed else "Failed"
        ), order_id
    except Exception as e:
        return TestResult(
            name="Create Binary Order",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        ), ""

def test_get_orders(token: str) -> TestResult:
    """Test getting all orders"""
    try:
        response, elapsed = make_request(
            "GET",
            "/binary-orders",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            orders = data.get("data", {}).get("orders", [])
        
        return TestResult(
            name="Get All Orders",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Found {len(orders)} orders" if passed else "Failed"
        )
    except Exception as e:
        return TestResult(
            name="Get All Orders",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

def test_get_order_by_id(token: str, order_id: str) -> TestResult:
    """Test getting order by ID"""
    if not order_id:
        return TestResult(
            name="Get Order By ID",
            passed=False,
            response_time=0,
            status_code=0,
            message="No order ID"
        )
    
    try:
        response, elapsed = make_request(
            "GET",
            f"/binary-orders/{order_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        passed = response.status_code == 200
        
        return TestResult(
            name="Get Order By ID",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="Order retrieved" if passed else "Failed"
        )
    except Exception as e:
        return TestResult(
            name="Get Order By ID",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

def test_performance_endpoint() -> TestResult:
    """Test performance metrics endpoint"""
    try:
        response, elapsed = make_request("GET", "/health/performance")
        
        passed = response.status_code == 200
        
        return TestResult(
            name="Performance Metrics",
            passed=passed,
            response_time=elapsed,
            status_code=response.status_code,
            message="Metrics retrieved" if passed else "Failed",
            details=response.json() if passed else None
        )
    except Exception as e:
        return TestResult(
            name="Performance Metrics",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e)
        )

# ============================================
# MAIN TEST RUNNER
# ============================================
def run_all_tests():
    """Run all backend tests"""
    print_header("🧪 BINARY OPTION BACKEND - COMPREHENSIVE TESTS")
    
    results: List[TestResult] = []
    session = TestSession()
    
    # ============================================
    # 1. HEALTH & INFRASTRUCTURE
    # ============================================
    print(f"\n{Colors.BOLD}1️⃣  HEALTH & INFRASTRUCTURE{Colors.END}")
    print("-" * 60)
    
    result = test_health_check()
    results.append(result)
    print_test_result(result)
    
    result = test_performance_endpoint()
    results.append(result)
    print_test_result(result)
    
    # ============================================
    # 2. AUTHENTICATION
    # ============================================
    print(f"\n{Colors.BOLD}2️⃣  AUTHENTICATION{Colors.END}")
    print("-" * 60)
    
    result, token = test_super_admin_login()
    session.super_admin_token = token
    results.append(result)
    print_test_result(result)
    
    result, token = test_user_registration()
    results.append(result)
    print_test_result(result)
    
    result, token = test_user_login()
    session.user_token = token
    results.append(result)
    print_test_result(result)
    
    # ============================================
    # 3. ASSET MANAGEMENT
    # ============================================
    print(f"\n{Colors.BOLD}3️⃣  ASSET MANAGEMENT{Colors.END}")
    print("-" * 60)
    
    result, asset_id = test_create_asset(session.super_admin_token)
    session.asset_id = asset_id
    results.append(result)
    print_test_result(result)
    
    result = test_get_all_assets(session.user_token)
    results.append(result)
    print_test_result(result)
    
    # Get real asset ID if we didn't create one
    if not session.asset_id:
        try:
            response, _ = make_request(
                "GET",
                "/assets",
                headers={"Authorization": f"Bearer {session.user_token}"}
            )
            if response.status_code == 200:
                data = response.json()
                assets = data.get("data", {}).get("assets", [])
                if assets:
                    session.asset_id = assets[0]["id"]
        except:
            pass
    
    result = test_get_asset_price(session.user_token, session.asset_id)
    results.append(result)
    print_test_result(result)
    
    # ============================================
    # 4. USER PROFILE & BALANCE
    # ============================================
    print(f"\n{Colors.BOLD}4️⃣  USER PROFILE & BALANCE{Colors.END}")
    print("-" * 60)
    
    result = test_user_profile(session.user_token)
    results.append(result)
    print_test_result(result)
    
    result = test_deposit_balance(session.user_token)
    results.append(result)
    print_test_result(result)
    
    result = test_get_balance(session.user_token)
    results.append(result)
    print_test_result(result)
    
    # ============================================
    # 5. BINARY ORDERS
    # ============================================
    print(f"\n{Colors.BOLD}5️⃣  BINARY ORDERS{Colors.END}")
    print("-" * 60)
    
    result, order_id = test_create_binary_order(session.user_token, session.asset_id)
    session.order_id = order_id
    results.append(result)
    print_test_result(result)
    
    result = test_get_orders(session.user_token)
    results.append(result)
    print_test_result(result)
    
    result = test_get_order_by_id(session.user_token, session.order_id)
    results.append(result)
    print_test_result(result)
    
    # ============================================
    # SUMMARY
    # ============================================
    print_header("📊 TEST SUMMARY")
    
    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)
    total = len(results)
    
    avg_response_time = sum(r.response_time for r in results) / total if total > 0 else 0
    
    print(f"{Colors.BOLD}Total Tests:{Colors.END} {total}")
    print(f"{Colors.GREEN}✓ Passed:{Colors.END} {passed}")
    print(f"{Colors.RED}✗ Failed:{Colors.END} {failed}")
    print(f"{Colors.CYAN}Success Rate:{Colors.END} {(passed/total*100):.1f}%")
    print(f"{Colors.YELLOW}Avg Response Time:{Colors.END} {avg_response_time:.0f}ms")
    
    # Response time analysis
    print(f"\n{Colors.BOLD}Response Time Analysis:{Colors.END}")
    fast = sum(1 for r in results if r.response_time < 500)
    medium = sum(1 for r in results if 500 <= r.response_time < 1000)
    slow = sum(1 for r in results if r.response_time >= 1000)
    
    print(f"  🚀 Fast (<500ms):   {fast}")
    print(f"  ⚡ Medium (500-1s): {medium}")
    print(f"  🐌 Slow (>1s):      {slow}")
    
    # Critical endpoints analysis
    print(f"\n{Colors.BOLD}Critical Endpoint Performance:{Colors.END}")
    critical_tests = [r for r in results if "Order" in r.name or "Price" in r.name]
    if critical_tests:
        for test in critical_tests:
            status = "✅" if test.response_time < 500 else "⚠️" if test.response_time < 1000 else "❌"
            print(f"  {status} {test.name}: {test.response_time:.0f}ms")
    
    print()
    
    # Exit with proper code
    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    try:
        run_all_tests()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Tests interrupted by user{Colors.END}")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        sys.exit(1)