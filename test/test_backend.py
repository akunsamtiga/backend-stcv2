#!/usr/bin/env python3
"""
Binary Option Trading System - Enhanced Backend API Testing
===========================================================
Comprehensive API testing with better error handling and assertions
"""

import requests
import time
import json
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from datetime import datetime
import sys
import traceback

# ============================================
# CONFIGURATION
# ============================================
BASE_URL = "http://localhost:3000/api/v1"
SUPER_ADMIN_EMAIL = "superadmin@trading.com"
SUPER_ADMIN_PASSWORD = "SuperAdmin123!"

# Test data
TEST_USER_EMAIL = f"testuser_{int(time.time())}@example.com"
TEST_USER_PASSWORD = "TestUser123!"

# Timeouts
REQUEST_TIMEOUT = 10
HEALTH_TIMEOUT = 3

# ============================================
# COLORS
# ============================================
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'

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
    error: Optional[str] = None

@dataclass
class TestSession:
    super_admin_token: str = ""
    user_token: str = ""
    asset_id: str = ""
    order_id: str = ""
    user_id: str = ""
    initial_balance: float = 0.0

# ============================================
# UTILS
# ============================================
def print_header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*70}")
    print(f"{text}")
    print(f"{'='*70}{Colors.END}\n")

def print_test_result(result: TestResult, verbose: bool = False):
    status = f"{Colors.GREEN}✓ PASS" if result.passed else f"{Colors.RED}✗ FAIL"
    print(f"{status}{Colors.END} | {result.name:<45} | {result.response_time:>6.0f}ms | {result.status_code}")
    
    if not result.passed:
        print(f"      {Colors.RED}Error: {result.message}{Colors.END}")
        if result.error and verbose:
            print(f"      {Colors.YELLOW}Details: {result.error}{Colors.END}")

def make_request(
    method: str,
    endpoint: str,
    headers: Optional[Dict] = None,
    json_data: Optional[Dict] = None,
    params: Optional[Dict] = None,
    timeout: int = REQUEST_TIMEOUT,
    retries: int = 2
) -> Tuple[requests.Response, float]:
    """Make HTTP request with retry logic"""
    url = f"{BASE_URL}{endpoint}"
    
    for attempt in range(retries + 1):
        start_time = time.time()
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=headers,
                json=json_data,
                params=params,
                timeout=timeout
            )
            elapsed = (time.time() - start_time) * 1000
            return response, elapsed
            
        except requests.exceptions.Timeout:
            elapsed = (time.time() - start_time) * 1000
            if attempt < retries:
                time.sleep(1)
                continue
            raise Exception(f"Request timeout after {retries + 1} attempts")
            
        except requests.exceptions.ConnectionError:
            if attempt < retries:
                time.sleep(2)
                continue
            raise Exception("Connection failed - is the server running?")
            
        except Exception as e:
            elapsed = (time.time() - start_time) * 1000
            raise Exception(f"Request failed: {str(e)}")

def assert_response(response: requests.Response, expected_status: int, name: str) -> None:
    """Assert response status and structure"""
    if response.status_code != expected_status:
        error_msg = f"Expected {expected_status}, got {response.status_code}"
        try:
            error_data = response.json()
            if 'error' in error_data:
                error_msg += f" - {error_data['error']}"
        except:
            pass
        raise AssertionError(error_msg)
    
    # Verify response structure
    try:
        data = response.json()
        if 'success' not in data and 'data' not in data and 'error' not in data:
            raise AssertionError("Response missing required fields")
    except json.JSONDecodeError:
        raise AssertionError("Response is not valid JSON")

# ============================================
# TEST FUNCTIONS
# ============================================

def test_health_check() -> TestResult:
    """Test health check endpoint"""
    try:
        response, elapsed = make_request("GET", "/health", timeout=HEALTH_TIMEOUT)
        assert_response(response, 200, "health")
        
        data = response.json()
        assert 'status' in data, "Missing status field"
        assert data['status'] == 'healthy', "Status not healthy"
        
        return TestResult(
            name="Health Check",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message="OK",
            details=data
        )
    except Exception as e:
        return TestResult(
            name="Health Check",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
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
        
        assert_response(response, 200, "super_admin_login")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'token' in data['data'], "Missing token"
        token = data['data']['token']
        assert len(token) > 10, "Token too short"
        
        return TestResult(
            name="Super Admin Login",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message="Token received"
        ), token
        
    except Exception as e:
        return TestResult(
            name="Super Admin Login",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
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
        
        # Accept both 201 (created) and 409 (exists)
        if response.status_code not in [201, 409]:
            raise AssertionError(f"Unexpected status: {response.status_code}")
        
        data = response.json()
        token = ""
        
        if response.status_code == 201:
            assert 'data' in data, "Missing data field"
            assert 'token' in data['data'], "Missing token"
            token = data['data']['token']
        
        message = "User created" if response.status_code == 201 else "User exists"
        
        return TestResult(
            name="User Registration",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message=message
        ), token
        
    except Exception as e:
        return TestResult(
            name="User Registration",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
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
        
        assert_response(response, 200, "user_login")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'token' in data['data'], "Missing token"
        token = data['data']['token']
        assert len(token) > 10, "Token too short"
        
        return TestResult(
            name="User Login",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message="Token received"
        ), token
        
    except Exception as e:
        return TestResult(
            name="User Login",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        ), ""

def test_get_all_assets(token: str) -> Tuple[TestResult, List[str]]:
    """Test getting all assets"""
    try:
        response, elapsed = make_request(
            "GET",
            "/assets",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert_response(response, 200, "get_assets")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'assets' in data['data'], "Missing assets field"
        assets = data['data']['assets']
        assert isinstance(assets, list), "Assets is not a list"
        
        asset_ids = [asset['id'] for asset in assets if 'id' in asset]
        
        return TestResult(
            name="Get All Assets",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Found {len(assets)} assets"
        ), asset_ids
        
    except Exception as e:
        return TestResult(
            name="Get All Assets",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        ), []

def test_get_asset_price(token: str, asset_id: str) -> TestResult:
    """Test getting asset price"""
    if not asset_id:
        return TestResult(
            name="Get Asset Price",
            passed=False,
            response_time=0,
            status_code=0,
            message="No asset ID available"
        )
    
    try:
        response, elapsed = make_request(
            "GET",
            f"/assets/{asset_id}/price",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5  # Shorter timeout for price
        )
        
        assert_response(response, 200, "get_price")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'price' in data['data'], "Missing price field"
        
        price = data['data']['price']
        assert isinstance(price, (int, float)), "Price is not numeric"
        assert price > 0, "Price must be positive"
        
        return TestResult(
            name="Get Asset Price",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Price: {price}"
        )
        
    except Exception as e:
        return TestResult(
            name="Get Asset Price",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        )

def test_user_profile(token: str) -> TestResult:
    """Test getting user profile"""
    try:
        response, elapsed = make_request(
            "GET",
            "/user/profile",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert_response(response, 200, "get_profile")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'user' in data['data'], "Missing user field"
        assert 'balances' in data['data'], "Missing balances field"
        
        return TestResult(
            name="Get User Profile",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message="Profile retrieved"
        )
        
    except Exception as e:
        return TestResult(
            name="Get User Profile",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        )

def test_deposit_balance(token: str, account_type: str = "demo") -> TestResult:
    """Test depositing balance"""
    try:
        response, elapsed = make_request(
            "POST",
            "/balance",
            headers={"Authorization": f"Bearer {token}"},
            json_data={
                "accountType": account_type,
                "type": "deposit",
                "amount": 10000,
                "description": f"Test deposit for {account_type}"
            }
        )
        
        assert_response(response, 201, "deposit")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'currentBalance' in data['data'], "Missing currentBalance"
        
        return TestResult(
            name=f"Deposit Balance ({account_type})",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message="Deposit successful"
        )
        
    except Exception as e:
        return TestResult(
            name=f"Deposit Balance ({account_type})",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        )

def test_get_balance(token: str) -> TestResult:
    """Test getting current balance"""
    try:
        response, elapsed = make_request(
            "GET",
            "/balance/both",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert_response(response, 200, "get_balance")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'realBalance' in data['data'], "Missing realBalance"
        assert 'demoBalance' in data['data'], "Missing demoBalance"
        
        real = data['data']['realBalance']
        demo = data['data']['demoBalance']
        
        return TestResult(
            name="Get Current Balance",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Real: {real}, Demo: {demo}"
        )
        
    except Exception as e:
        return TestResult(
            name="Get Current Balance",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        )

def test_create_binary_order(token: str, asset_id: str, account_type: str = "demo") -> Tuple[TestResult, str]:
    """Test creating binary order"""
    if not asset_id:
        return TestResult(
            name=f"Create Binary Order ({account_type})",
            passed=False,
            response_time=0,
            status_code=0,
            message="No asset ID available"
        ), ""
    
    try:
        response, elapsed = make_request(
            "POST",
            "/binary-orders",
            headers={"Authorization": f"Bearer {token}"},
            json_data={
                "accountType": account_type,
                "asset_id": asset_id,
                "direction": "CALL",
                "amount": 1000,
                "duration": 1
            },
            timeout=8  # Longer timeout for order creation
        )
        
        assert_response(response, 201, "create_order")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'order' in data['data'], "Missing order field"
        
        order = data['data']['order']
        order_id = order.get('id', '')
        
        assert 'entry_price' in order, "Missing entry_price"
        assert 'status' in order, "Missing status"
        assert order['status'] == 'ACTIVE', "Order not active"
        
        # Check performance
        performance_msg = ""
        if elapsed < 500:
            performance_msg = " (EXCELLENT)"
        elif elapsed < 1000:
            performance_msg = " (GOOD)"
        elif elapsed < 2000:
            performance_msg = " (ACCEPTABLE)"
        else:
            performance_msg = " (SLOW)"
        
        return TestResult(
            name=f"Create Binary Order ({account_type})",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Order created{performance_msg}"
        ), order_id
        
    except Exception as e:
        return TestResult(
            name=f"Create Binary Order ({account_type})",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        ), ""

def test_get_orders(token: str, account_type: Optional[str] = None) -> TestResult:
    """Test getting all orders"""
    try:
        params = {}
        if account_type:
            params['accountType'] = account_type
        
        response, elapsed = make_request(
            "GET",
            "/binary-orders",
            headers={"Authorization": f"Bearer {token}"},
            params=params
        )
        
        assert_response(response, 200, "get_orders")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'orders' in data['data'], "Missing orders field"
        
        orders = data['data']['orders']
        filter_type = account_type or "all"
        
        return TestResult(
            name=f"Get Orders ({filter_type})",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message=f"Found {len(orders)} orders"
        )
        
    except Exception as e:
        return TestResult(
            name=f"Get Orders",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        )

def test_get_order_by_id(token: str, order_id: str) -> TestResult:
    """Test getting order by ID"""
    if not order_id:
        return TestResult(
            name="Get Order By ID",
            passed=False,
            response_time=0,
            status_code=0,
            message="No order ID available"
        )
    
    try:
        response, elapsed = make_request(
            "GET",
            f"/binary-orders/{order_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert_response(response, 200, "get_order_by_id")
        data = response.json()
        
        assert 'data' in data, "Missing data field"
        assert 'id' in data['data'], "Missing order id"
        assert data['data']['id'] == order_id, "Order ID mismatch"
        
        return TestResult(
            name="Get Order By ID",
            passed=True,
            response_time=elapsed,
            status_code=response.status_code,
            message="Order retrieved"
        )
        
    except Exception as e:
        return TestResult(
            name="Get Order By ID",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        )

def test_unauthorized_access() -> TestResult:
    """Test unauthorized access"""
    try:
        response, elapsed = make_request(
            "GET",
            "/user/profile",
            retries=0  # No retries for this test
        )
        
        # Should fail with 401
        if response.status_code == 401:
            return TestResult(
                name="Unauthorized Access Test",
                passed=True,
                response_time=elapsed,
                status_code=response.status_code,
                message="Correctly blocked"
            )
        else:
            return TestResult(
                name="Unauthorized Access Test",
                passed=False,
                response_time=elapsed,
                status_code=response.status_code,
                message="Should return 401"
            )
            
    except Exception as e:
        return TestResult(
            name="Unauthorized Access Test",
            passed=False,
            response_time=0,
            status_code=0,
            message=str(e),
            error=traceback.format_exc()
        )

# ============================================
# MAIN TEST RUNNER
# ============================================
def run_all_tests(verbose: bool = False):
    """Run all backend tests"""
    print_header("🧪 BACKEND API - COMPREHENSIVE TESTS")
    
    results: List[TestResult] = []
    session = TestSession()
    
    start_time = time.time()
    
    # ============================================
    # 1. HEALTH & INFRASTRUCTURE
    # ============================================
    print(f"\n{Colors.BOLD}1️⃣  HEALTH & INFRASTRUCTURE{Colors.END}")
    print("-" * 70)
    
    result = test_health_check()
    results.append(result)
    print_test_result(result, verbose)
    
    if not result.passed:
        print(f"\n{Colors.RED}❌ Server not healthy - aborting tests{Colors.END}")
        sys.exit(1)
    
    # ============================================
    # 2. AUTHENTICATION
    # ============================================
    print(f"\n{Colors.BOLD}2️⃣  AUTHENTICATION{Colors.END}")
    print("-" * 70)
    
    result, token = test_super_admin_login()
    session.super_admin_token = token
    results.append(result)
    print_test_result(result, verbose)
    
    if not result.passed:
        print(f"\n{Colors.RED}❌ Super admin login failed - aborting{Colors.END}")
        sys.exit(1)
    
    result, token = test_user_registration()
    results.append(result)
    print_test_result(result, verbose)
    
    result, token = test_user_login()
    session.user_token = token
    results.append(result)
    print_test_result(result, verbose)
    
    if not session.user_token:
        print(f"\n{Colors.RED}❌ User login failed - aborting{Colors.END}")
        sys.exit(1)
    
    # Unauthorized access test
    result = test_unauthorized_access()
    results.append(result)
    print_test_result(result, verbose)
    
    # ============================================
    # 3. ASSET MANAGEMENT
    # ============================================
    print(f"\n{Colors.BOLD}3️⃣  ASSET MANAGEMENT{Colors.END}")
    print("-" * 70)
    
    result, asset_ids = test_get_all_assets(session.user_token)
    results.append(result)
    print_test_result(result, verbose)
    
    if asset_ids:
        session.asset_id = asset_ids[0]
        
        result = test_get_asset_price(session.user_token, session.asset_id)
        results.append(result)
        print_test_result(result, verbose)
    else:
        print(f"{Colors.YELLOW}⚠️  No assets found - skipping price test{Colors.END}")
    
    # ============================================
    # 4. USER PROFILE & BALANCE
    # ============================================
    print(f"\n{Colors.BOLD}4️⃣  USER PROFILE & BALANCE{Colors.END}")
    print("-" * 70)
    
    result = test_user_profile(session.user_token)
    results.append(result)
    print_test_result(result, verbose)
    
    # Test demo account deposit
    result = test_deposit_balance(session.user_token, "demo")
    results.append(result)
    print_test_result(result, verbose)
    
    # Test real account deposit
    result = test_deposit_balance(session.user_token, "real")
    results.append(result)
    print_test_result(result, verbose)
    
    result = test_get_balance(session.user_token)
    results.append(result)
    print_test_result(result, verbose)
    
    # ============================================
    # 5. BINARY ORDERS
    # ============================================
    print(f"\n{Colors.BOLD}5️⃣  BINARY ORDERS{Colors.END}")
    print("-" * 70)
    
    if session.asset_id:
        # Demo order
        result, order_id = test_create_binary_order(session.user_token, session.asset_id, "demo")
        if order_id:
            session.order_id = order_id
        results.append(result)
        print_test_result(result, verbose)
        
        # Real order
        result, _ = test_create_binary_order(session.user_token, session.asset_id, "real")
        results.append(result)
        print_test_result(result, verbose)
        
        # Get all orders
        result = test_get_orders(session.user_token)
        results.append(result)
        print_test_result(result, verbose)
        
        # Get demo orders
        result = test_get_orders(session.user_token, "demo")
        results.append(result)
        print_test_result(result, verbose)
        
        # Get real orders
        result = test_get_orders(session.user_token, "real")
        results.append(result)
        print_test_result(result, verbose)
        
        # Get order by ID
        if session.order_id:
            result = test_get_order_by_id(session.user_token, session.order_id)
            results.append(result)
            print_test_result(result, verbose)
    else:
        print(f"{Colors.YELLOW}⚠️  No assets - skipping order tests{Colors.END}")
    
    # ============================================
    # SUMMARY
    # ============================================
    total_time = time.time() - start_time
    print_header("📊 TEST SUMMARY")
    
    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)
    total = len(results)
    
    avg_response_time = sum(r.response_time for r in results if r.passed) / passed if passed > 0 else 0
    
    print(f"{Colors.BOLD}Total Tests:{Colors.END} {total}")
    print(f"{Colors.GREEN}✓ Passed:{Colors.END} {passed}")
    print(f"{Colors.RED}✗ Failed:{Colors.END} {failed}")
    print(f"{Colors.CYAN}Success Rate:{Colors.END} {(passed/total*100):.1f}%")
    print(f"{Colors.YELLOW}Avg Response Time:{Colors.END} {avg_response_time:.0f}ms")
    print(f"{Colors.BLUE}Total Duration:{Colors.END} {total_time:.2f}s")
    
    # Response time analysis
    if passed > 0:
        print(f"\n{Colors.BOLD}Response Time Analysis:{Colors.END}")
        fast = sum(1 for r in results if r.passed and r.response_time < 500)
        medium = sum(1 for r in results if r.passed and 500 <= r.response_time < 1000)
        slow = sum(1 for r in results if r.passed and r.response_time >= 1000)
        
        print(f"  🚀 Fast (<500ms):   {fast} ({fast/passed*100:.1f}%)")
        print(f"  ⚡ Medium (500-1s): {medium} ({medium/passed*100:.1f}%)")
        print(f"  🐌 Slow (>1s):      {slow} ({slow/passed*100:.1f}%)")
    
    # Failed tests details
    if failed > 0:
        print(f"\n{Colors.BOLD}{Colors.RED}Failed Tests:{Colors.END}")
        for result in results:
            if not result.passed:
                print(f"  ❌ {result.name}: {result.message}")
    
    print()
    
    # Exit with proper code
    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Backend API Test Suite')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    args = parser.parse_args()
    
    try:
        run_all_tests(verbose=args.verbose)
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Tests interrupted by user{Colors.END}")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        if args.verbose:
            traceback.print_exc()
        sys.exit(1)