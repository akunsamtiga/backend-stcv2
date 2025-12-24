#!/usr/bin/env python3
"""
Binary Option Trading System - Load & Performance Testing
=========================================================
Tests system performance under load
"""

import requests
import time
import threading
import statistics
from typing import List, Dict, Tuple
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
import sys

# ============================================
# CONFIGURATION
# ============================================
BASE_URL = "http://localhost:3000/api/v1"
SUPER_ADMIN_EMAIL = "superadmin@trading.com"
SUPER_ADMIN_PASSWORD = "SuperAdmin123!"

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
class LoadTestResult:
    total_requests: int
    successful: int
    failed: int
    avg_response_time: float
    min_response_time: float
    max_response_time: float
    median_response_time: float
    p95_response_time: float
    p99_response_time: float
    requests_per_second: float
    total_duration: float

# ============================================
# UTILS
# ============================================
def print_header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*70}")
    print(f"{text}")
    print(f"{'='*70}{Colors.END}\n")

def get_auth_token() -> str:
    """Get authentication token"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={
                "email": SUPER_ADMIN_EMAIL,
                "password": SUPER_ADMIN_PASSWORD
            },
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            return data.get("data", {}).get("token", "")
        return ""
    except:
        return ""

def get_test_asset_id(token: str) -> str:
    """Get a test asset ID"""
    try:
        response = requests.get(
            f"{BASE_URL}/assets",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            assets = data.get("data", {}).get("assets", [])
            if assets:
                return assets[0]["id"]
        return ""
    except:
        return ""

# ============================================
# LOAD TEST FUNCTIONS
# ============================================
def single_request(url: str, headers: Dict, json_data: Dict = None) -> Tuple[bool, float]:
    """Make a single request and return (success, response_time)"""
    start = time.time()
    try:
        if json_data:
            response = requests.post(url, headers=headers, json=json_data, timeout=10)
        else:
            response = requests.get(url, headers=headers, timeout=10)
        
        elapsed = (time.time() - start) * 1000
        success = response.status_code in [200, 201]
        
        return success, elapsed
    except Exception as e:
        elapsed = (time.time() - start) * 1000
        return False, elapsed

def run_concurrent_requests(
    url: str,
    headers: Dict,
    num_requests: int,
    concurrent_users: int,
    json_data: Dict = None
) -> LoadTestResult:
    """Run concurrent requests and collect metrics"""
    
    results: List[Tuple[bool, float]] = []
    
    print(f"  Running {num_requests} requests with {concurrent_users} concurrent users...")
    
    start_time = time.time()
    
    with ThreadPoolExecutor(max_workers=concurrent_users) as executor:
        futures = [
            executor.submit(single_request, url, headers, json_data)
            for _ in range(num_requests)
        ]
        
        for future in as_completed(futures):
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                results.append((False, 0))
    
    total_duration = time.time() - start_time
    
    # Calculate metrics
    successful = sum(1 for r in results if r[0])
    failed = sum(1 for r in results if not r[0])
    
    response_times = [r[1] for r in results if r[0]]  # Only successful requests
    
    if response_times:
        avg_time = statistics.mean(response_times)
        min_time = min(response_times)
        max_time = max(response_times)
        median_time = statistics.median(response_times)
        
        # Calculate percentiles
        sorted_times = sorted(response_times)
        p95_index = int(len(sorted_times) * 0.95)
        p99_index = int(len(sorted_times) * 0.99)
        p95_time = sorted_times[p95_index] if p95_index < len(sorted_times) else max_time
        p99_time = sorted_times[p99_index] if p99_index < len(sorted_times) else max_time
    else:
        avg_time = min_time = max_time = median_time = p95_time = p99_time = 0
    
    rps = num_requests / total_duration if total_duration > 0 else 0
    
    return LoadTestResult(
        total_requests=num_requests,
        successful=successful,
        failed=failed,
        avg_response_time=avg_time,
        min_response_time=min_time,
        max_response_time=max_time,
        median_response_time=median_time,
        p95_response_time=p95_time,
        p99_response_time=p99_time,
        requests_per_second=rps,
        total_duration=total_duration
    )

def print_load_test_result(test_name: str, result: LoadTestResult):
    """Print load test results"""
    print(f"\n{Colors.BOLD}{test_name}{Colors.END}")
    print("-" * 70)
    
    success_rate = (result.successful / result.total_requests * 100) if result.total_requests > 0 else 0
    
    print(f"  Total Requests:     {result.total_requests}")
    print(f"  {Colors.GREEN}✓ Successful:{Colors.END}       {result.successful}")
    print(f"  {Colors.RED}✗ Failed:{Colors.END}           {result.failed}")
    print(f"  Success Rate:       {success_rate:.1f}%")
    print(f"  Total Duration:     {result.total_duration:.2f}s")
    print(f"  Req/Second:         {result.requests_per_second:.1f}")
    print()
    print(f"  {Colors.CYAN}Response Times:{Colors.END}")
    print(f"    Average:          {result.avg_response_time:.0f}ms")
    print(f"    Median:           {result.median_response_time:.0f}ms")
    print(f"    Min:              {result.min_response_time:.0f}ms")
    print(f"    Max:              {result.max_response_time:.0f}ms")
    print(f"    95th percentile:  {result.p95_response_time:.0f}ms")
    print(f"    99th percentile:  {result.p99_response_time:.0f}ms")
    
    # Performance rating
    if result.avg_response_time < 500:
        rating = f"{Colors.GREEN}⚡ EXCELLENT"
    elif result.avg_response_time < 1000:
        rating = f"{Colors.YELLOW}✓ GOOD"
    elif result.avg_response_time < 2000:
        rating = f"{Colors.YELLOW}⚠ ACCEPTABLE"
    else:
        rating = f"{Colors.RED}✗ SLOW"
    
    print(f"\n  {Colors.BOLD}Performance:{Colors.END} {rating}{Colors.END}")

# ============================================
# SPECIFIC ENDPOINT TESTS
# ============================================
def test_health_endpoint_load():
    """Load test health endpoint"""
    print_header("1️⃣  HEALTH ENDPOINT LOAD TEST")
    
    url = f"{BASE_URL}/health"
    result = run_concurrent_requests(
        url=url,
        headers={},
        num_requests=100,
        concurrent_users=10
    )
    
    print_load_test_result("Health Endpoint", result)
    return result

def test_login_endpoint_load(token: str):
    """Load test login endpoint"""
    print_header("2️⃣  LOGIN ENDPOINT LOAD TEST")
    
    url = f"{BASE_URL}/auth/login"
    json_data = {
        "email": SUPER_ADMIN_EMAIL,
        "password": SUPER_ADMIN_PASSWORD
    }
    
    result = run_concurrent_requests(
        url=url,
        headers={"Content-Type": "application/json"},
        num_requests=50,
        concurrent_users=5,
        json_data=json_data
    )
    
    print_load_test_result("Login Endpoint", result)
    return result

def test_get_assets_load(token: str):
    """Load test get assets endpoint"""
    print_header("3️⃣  GET ASSETS ENDPOINT LOAD TEST")
    
    url = f"{BASE_URL}/assets"
    headers = {"Authorization": f"Bearer {token}"}
    
    result = run_concurrent_requests(
        url=url,
        headers=headers,
        num_requests=100,
        concurrent_users=10
    )
    
    print_load_test_result("Get Assets Endpoint", result)
    return result

def test_get_asset_price_load(token: str, asset_id: str):
    """Load test get asset price endpoint"""
    print_header("4️⃣  GET ASSET PRICE ENDPOINT LOAD TEST")
    
    if not asset_id:
        print(f"{Colors.RED}✗ No asset ID available{Colors.END}")
        return None
    
    url = f"{BASE_URL}/assets/{asset_id}/price"
    headers = {"Authorization": f"Bearer {token}"}
    
    result = run_concurrent_requests(
        url=url,
        headers=headers,
        num_requests=100,
        concurrent_users=10
    )
    
    print_load_test_result("Get Asset Price Endpoint", result)
    return result

def test_create_order_load(token: str, asset_id: str):
    """Load test create order endpoint (CRITICAL)"""
    print_header("5️⃣  CREATE ORDER ENDPOINT LOAD TEST (CRITICAL)")
    
    if not asset_id:
        print(f"{Colors.RED}✗ No asset ID available{Colors.END}")
        return None
    
    # First, ensure user has balance
    deposit_url = f"{BASE_URL}/balance"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    try:
        requests.post(
            deposit_url,
            headers=headers,
            json={"type": "deposit", "amount": 100000, "description": "Load test deposit"},
            timeout=10
        )
    except:
        pass
    
    url = f"{BASE_URL}/binary-orders"
    json_data = {
        "asset_id": asset_id,
        "direction": "CALL",
        "amount": 100,
        "duration": 1
    }
    
    print(f"  {Colors.YELLOW}⚠ This will create real orders!{Colors.END}")
    
    result = run_concurrent_requests(
        url=url,
        headers=headers,
        num_requests=50,
        concurrent_users=5,
        json_data=json_data
    )
    
    print_load_test_result("Create Order Endpoint", result)
    
    # Critical performance check
    if result.avg_response_time > 1000:
        print(f"\n  {Colors.RED}⚠️  WARNING: Average response time exceeds 1 second!{Colors.END}")
        print(f"  {Colors.RED}   This may impact user experience.{Colors.END}")
    elif result.avg_response_time > 500:
        print(f"\n  {Colors.YELLOW}⚠️  NOTICE: Average response time exceeds 500ms.{Colors.END}")
        print(f"  {Colors.YELLOW}   Consider optimization.{Colors.END}")
    else:
        print(f"\n  {Colors.GREEN}✅ EXCELLENT: Response time meets target (<500ms){Colors.END}")
    
    return result

def test_get_orders_load(token: str):
    """Load test get orders endpoint"""
    print_header("6️⃣  GET ORDERS ENDPOINT LOAD TEST")
    
    url = f"{BASE_URL}/binary-orders"
    headers = {"Authorization": f"Bearer {token}"}
    
    result = run_concurrent_requests(
        url=url,
        headers=headers,
        num_requests=100,
        concurrent_users=10
    )
    
    print_load_test_result("Get Orders Endpoint", result)
    return result

def test_sustained_load(token: str, asset_id: str):
    """Test sustained load over time"""
    print_header("7️⃣  SUSTAINED LOAD TEST (30 seconds)")
    
    if not asset_id:
        print(f"{Colors.RED}✗ No asset ID available{Colors.END}")
        return None
    
    url = f"{BASE_URL}/assets/{asset_id}/price"
    headers = {"Authorization": f"Bearer {token}"}
    
    print(f"  Testing sustained load (5 RPS for 30 seconds)...")
    
    total_requests = 0
    successful = 0
    failed = 0
    response_times = []
    
    start_time = time.time()
    duration = 30  # seconds
    rps = 5  # requests per second
    
    while time.time() - start_time < duration:
        batch_start = time.time()
        
        # Send RPS requests
        for _ in range(rps):
            success, elapsed = single_request(url, headers)
            total_requests += 1
            if success:
                successful += 1
                response_times.append(elapsed)
            else:
                failed += 1
        
        # Sleep to maintain RPS
        batch_duration = time.time() - batch_start
        sleep_time = 1.0 - batch_duration
        if sleep_time > 0:
            time.sleep(sleep_time)
        
        # Progress indicator
        elapsed = time.time() - start_time
        if int(elapsed) % 5 == 0 and elapsed > 0:
            print(f"    Progress: {int(elapsed)}s / {duration}s", end='\r')
    
    print()  # New line after progress
    
    total_duration = time.time() - start_time
    
    # Calculate metrics
    if response_times:
        result = LoadTestResult(
            total_requests=total_requests,
            successful=successful,
            failed=failed,
            avg_response_time=statistics.mean(response_times),
            min_response_time=min(response_times),
            max_response_time=max(response_times),
            median_response_time=statistics.median(response_times),
            p95_response_time=sorted(response_times)[int(len(response_times) * 0.95)],
            p99_response_time=sorted(response_times)[int(len(response_times) * 0.99)],
            requests_per_second=total_requests / total_duration,
            total_duration=total_duration
        )
        
        print_load_test_result("Sustained Load Test", result)
        return result
    
    return None

# ============================================
# MAIN TEST RUNNER
# ============================================
def run_all_tests():
    """Run all performance tests"""
    print_header("⚡ BINARY OPTION BACKEND - PERFORMANCE & LOAD TESTS")
    
    # Get auth token
    print("Setting up test session...")
    token = get_auth_token()
    
    if not token:
        print(f"{Colors.RED}✗ Failed to get authentication token{Colors.END}")
        print(f"{Colors.YELLOW}Make sure the backend is running and super admin exists{Colors.END}")
        sys.exit(1)
    
    print(f"{Colors.GREEN}✓ Authentication successful{Colors.END}")
    
    # Get asset ID
    asset_id = get_test_asset_id(token)
    
    if not asset_id:
        print(f"{Colors.YELLOW}⚠ No asset ID found - some tests will be skipped{Colors.END}")
    else:
        print(f"{Colors.GREEN}✓ Test asset found: {asset_id}{Colors.END}")
    
    # Run tests
    results = []
    
    results.append(test_health_endpoint_load())
    results.append(test_login_endpoint_load(token))
    results.append(test_get_assets_load(token))
    
    if asset_id:
        results.append(test_get_asset_price_load(token, asset_id))
        results.append(test_create_order_load(token, asset_id))
        results.append(test_get_orders_load(token))
        results.append(test_sustained_load(token, asset_id))
    
    # Summary
    print_header("📊 PERFORMANCE TEST SUMMARY")
    
    valid_results = [r for r in results if r is not None]
    
    if valid_results:
        avg_response_time = statistics.mean([r.avg_response_time for r in valid_results])
        max_response_time = max([r.max_response_time for r in valid_results])
        total_requests = sum([r.total_requests for r in valid_results])
        total_successful = sum([r.successful for r in valid_results])
        total_failed = sum([r.failed for r in valid_results])
        
        print(f"{Colors.BOLD}Overall Performance:{Colors.END}")
        print(f"  Total Requests:     {total_requests}")
        print(f"  {Colors.GREEN}✓ Successful:{Colors.END}       {total_successful}")
        print(f"  {Colors.RED}✗ Failed:{Colors.END}           {total_failed}")
        print(f"  Success Rate:       {(total_successful/total_requests*100):.1f}%")
        print()
        print(f"  Avg Response Time:  {avg_response_time:.0f}ms")
        print(f"  Max Response Time:  {max_response_time:.0f}ms")
        
        # Overall rating
        if avg_response_time < 500:
            print(f"\n  {Colors.GREEN}{Colors.BOLD}✅ SYSTEM PERFORMANCE: EXCELLENT{Colors.END}")
        elif avg_response_time < 1000:
            print(f"\n  {Colors.YELLOW}{Colors.BOLD}✓ SYSTEM PERFORMANCE: GOOD{Colors.END}")
        elif avg_response_time < 2000:
            print(f"\n  {Colors.YELLOW}{Colors.BOLD}⚠ SYSTEM PERFORMANCE: ACCEPTABLE{Colors.END}")
        else:
            print(f"\n  {Colors.RED}{Colors.BOLD}✗ SYSTEM PERFORMANCE: NEEDS IMPROVEMENT{Colors.END}")
        
        print()
        
        # Recommendations
        print(f"{Colors.BOLD}Recommendations:{Colors.END}")
        if avg_response_time > 500:
            print(f"  • Consider adding caching layers")
            print(f"  • Optimize database queries")
            print(f"  • Review connection pooling settings")
        
        if total_failed > 0:
            print(f"  • Investigate failed requests")
            print(f"  • Check error logs")
            print(f"  • Verify timeout settings")
        
        if avg_response_time < 500 and total_failed == 0:
            print(f"  {Colors.GREEN}• No issues detected - system performing well!{Colors.END}")
    
    print()

if __name__ == "__main__":
    try:
        run_all_tests()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Tests interrupted by user{Colors.END}")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        import traceback
        traceback.print_exc()
        sys.exit(1)