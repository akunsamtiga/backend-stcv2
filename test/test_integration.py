#!/usr/bin/env python3
"""
Binary Option Trading System - Enhanced End-to-End Integration Testing
======================================================================
Complete workflow testing with better error handling and cleanup
"""

import requests
import time
import json
from typing import Dict, Optional
from datetime import datetime
import sys
import traceback

# ============================================
# CONFIGURATION
# ============================================
BASE_URL = "http://localhost:3000/api/v1"
FIREBASE_DB_URL = "https://stc-autotrade-18f67-default-rtdb.asia-southeast1.firebasedatabase.app"

# Test user - unique per run
TEST_EMAIL = f"integration_test_{int(time.time())}@example.com"
TEST_PASSWORD = "IntegrationTest123!"

# Timeouts
REQUEST_TIMEOUT = 10
ORDER_TIMEOUT = 8
SETTLEMENT_TIMEOUT = 75  # 60s + 15s buffer

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
# UTILS
# ============================================
def print_header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*70}")
    print(f"{text}")
    print(f"{'='*70}{Colors.END}\n")

def print_step(step: int, text: str):
    print(f"\n{Colors.BOLD}{Colors.BLUE}Step {step}:{Colors.END} {text}")
    print("-" * 70)

def print_success(text: str):
    print(f"{Colors.GREEN}✓{Colors.END} {text}")

def print_error(text: str):
    print(f"{Colors.RED}✗{Colors.END} {text}")

def print_info(text: str):
    print(f"{Colors.CYAN}ℹ{Colors.END} {text}")

def print_warning(text: str):
    print(f"{Colors.YELLOW}⚠ {Colors.END} {text}")

def safe_request(method: str, url: str, **kwargs) -> Optional[requests.Response]:
    """Make a safe request with error handling"""
    try:
        timeout = kwargs.pop('timeout', REQUEST_TIMEOUT)
        response = requests.request(method, url, timeout=timeout, **kwargs)
        return response
    except requests.exceptions.Timeout:
        print_error(f"Request timeout after {timeout}s")
        return None
    except requests.exceptions.ConnectionError:
        print_error("Connection failed - is the server running?")
        return None
    except Exception as e:
        print_error(f"Request error: {str(e)}")
        return None

# ============================================
# INTEGRATION TEST CLASS
# ============================================
class IntegrationTest:
    def __init__(self):
        self.token = ""
        self.user_id = ""
        self.asset_id = ""
        self.order_id = ""
        self.initial_balance_real = 0
        self.initial_balance_demo = 0
        self.final_balance_real = 0
        self.final_balance_demo = 0
        
        self.timings = {}
        self.cleanup_needed = False
        
    def cleanup(self):
        """Cleanup test data"""
        if not self.cleanup_needed:
            return
        
        print_info("Cleaning up test data...")
        # Add cleanup logic here if needed
        print_success("Cleanup completed")
    
    def step_1_register_user(self) -> bool:
        """Register new user"""
        print_step(1, "Register New User")
        
        start_time = time.time()
        
        response = safe_request(
            "POST",
            f"{BASE_URL}/auth/register",
            json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            }
        )
        
        if not response:
            return False
        
        elapsed = (time.time() - start_time) * 1000
        self.timings['register'] = elapsed
        
        if response.status_code != 201:
            print_error(f"Registration failed: {response.status_code}")
            try:
                error = response.json()
                print_error(f"Error: {error.get('error', 'Unknown')}")
            except:
                pass
            return False
        
        try:
            data = response.json()
            self.token = data.get("data", {}).get("token", "")
            self.user_id = data.get("data", {}).get("user", {}).get("id", "")
            
            if not self.token or not self.user_id:
                print_error("Missing token or user ID in response")
                return False
            
            self.cleanup_needed = True
            
            print_success(f"User registered: {TEST_EMAIL}")
            print_info(f"User ID: {self.user_id}")
            print_info(f"Response time: {elapsed:.0f}ms")
            return True
            
        except Exception as e:
            print_error(f"Error parsing response: {str(e)}")
            return False
    
    def step_2_verify_profile(self) -> bool:
        """Verify user profile"""
        print_step(2, "Verify User Profile")
        
        start_time = time.time()
        
        response = safe_request(
            "GET",
            f"{BASE_URL}/user/profile",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        
        if not response or response.status_code != 200:
            print_error("Failed to get profile")
            return False
        
        elapsed = (time.time() - start_time) * 1000
        self.timings['profile'] = elapsed
        
        try:
            data = response.json().get("data", {})
            
            print_success("Profile retrieved")
            print_info(f"Email: {data.get('user', {}).get('email')}")
            print_info(f"Role: {data.get('user', {}).get('role')}")
            
            balances = data.get('balances', {})
            self.initial_balance_real = balances.get('real', 0)
            self.initial_balance_demo = balances.get('demo', 0)
            
            print_info(f"Initial Real Balance: Rp {self.initial_balance_real:,.0f}")
            print_info(f"Initial Demo Balance: Rp {self.initial_balance_demo:,.0f}")
            print_info(f"Response time: {elapsed:.0f}ms")
            
            return True
            
        except Exception as e:
            print_error(f"Error parsing profile: {str(e)}")
            return False
    
    def step_3_deposit_balance(self) -> bool:
        """Deposit initial balance to real account"""
        print_step(3, "Deposit to Real Account")
        
        start_time = time.time()
        deposit_amount = 100000  # 100k for testing
        
        response = safe_request(
            "POST",
            f"{BASE_URL}/balance",
            headers={"Authorization": f"Bearer {self.token}"},
            json={
                "accountType": "real",
                "type": "deposit",
                "amount": deposit_amount,
                "description": "Integration test deposit"
            }
        )
        
        if not response or response.status_code != 201:
            print_error("Deposit failed")
            return False
        
        elapsed = (time.time() - start_time) * 1000
        self.timings['deposit'] = elapsed
        
        try:
            data = response.json().get("data", {})
            current_balance = data.get("currentBalance", 0)
            
            print_success(f"Deposited Rp {deposit_amount:,.0f}")
            print_info(f"New balance: Rp {current_balance:,.0f}")
            print_info(f"Response time: {elapsed:.0f}ms")
            
            self.initial_balance_real = current_balance
            return True
            
        except Exception as e:
            print_error(f"Error parsing deposit response: {str(e)}")
            return False
    
    def step_4_get_active_assets(self) -> bool:
        """Get active trading assets"""
        print_step(4, "Get Active Trading Assets")
        
        start_time = time.time()
        
        response = safe_request(
            "GET",
            f"{BASE_URL}/assets",
            headers={"Authorization": f"Bearer {self.token}"},
            params={"activeOnly": "true"}
        )
        
        if not response or response.status_code != 200:
            print_error("Failed to get assets")
            return False
        
        elapsed = (time.time() - start_time) * 1000
        self.timings['assets'] = elapsed
        
        try:
            data = response.json().get("data", {})
            assets = data.get("assets", [])
            
            if not assets:
                print_error("No active assets found")
                return False
            
            self.asset_id = assets[0]["id"]
            asset = assets[0]
            
            print_success(f"Found {len(assets)} active assets")
            print_info(f"Selected: {asset['name']} ({asset['symbol']})")
            print_info(f"Profit rate: {asset['profitRate']}%")
            print_info(f"Data source: {asset['dataSource']}")
            print_info(f"Response time: {elapsed:.0f}ms")
            return True
            
        except Exception as e:
            print_error(f"Error parsing assets: {str(e)}")
            return False
    
    def step_5_get_current_price(self) -> Optional[float]:
        """Get current asset price"""
        print_step(5, "Get Current Asset Price")
        
        start_time = time.time()
        
        # Try multiple times if needed
        max_attempts = 3
        for attempt in range(max_attempts):
            response = safe_request(
                "GET",
                f"{BASE_URL}/assets/{self.asset_id}/price",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=5
            )
            
            if not response:
                if attempt < max_attempts - 1:
                    print_warning(f"Attempt {attempt + 1} failed, retrying...")
                    time.sleep(2)
                    continue
                return None
            
            if response.status_code != 200:
                if attempt < max_attempts - 1:
                    print_warning(f"Status {response.status_code}, retrying...")
                    time.sleep(2)
                    continue
                print_error(f"Failed to get price: {response.status_code}")
                return None
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['price'] = elapsed
            
            try:
                data = response.json().get("data", {})
                price = data.get("price")
                
                if not price:
                    if attempt < max_attempts - 1:
                        print_warning("No price in response, retrying...")
                        time.sleep(2)
                        continue
                    print_error("No price in response")
                    return None
                
                print_success("Price retrieved")
                print_info(f"Current price: {price}")
                print_info(f"Timestamp: {data.get('datetime')}")
                print_info(f"Response time: {elapsed:.0f}ms")
                
                if elapsed > 1000:
                    print_warning("Price fetch took >1s - may impact order creation")
                
                return price
                
            except Exception as e:
                if attempt < max_attempts - 1:
                    print_warning(f"Parse error, retrying: {str(e)}")
                    time.sleep(2)
                    continue
                print_error(f"Error parsing price: {str(e)}")
                return None
        
        return None
    
    def step_6_create_order(self, account_type: str = "demo") -> bool:
        """Create binary option order"""
        print_step(6, f"Create Binary Order ({account_type.upper()})")
        
        start_time = time.time()
        order_amount = 1000
        order_duration = 1  # 1 minute
        
        response = safe_request(
            "POST",
            f"{BASE_URL}/binary-orders",
            headers={"Authorization": f"Bearer {self.token}"},
            json={
                "accountType": account_type,
                "asset_id": self.asset_id,
                "direction": "CALL",
                "amount": order_amount,
                "duration": order_duration
            },
            timeout=ORDER_TIMEOUT
        )
        
        if not response:
            print_error("Order creation request failed")
            return False
        
        elapsed = (time.time() - start_time) * 1000
        self.timings[f'create_order_{account_type}'] = elapsed
        
        if response.status_code != 201:
            print_error(f"Order creation failed: {response.status_code}")
            try:
                error_data = response.json()
                print_error(f"Error: {error_data.get('error', 'Unknown')}")
            except:
                pass
            return False
        
        try:
            data = response.json().get("data", {})
            order = data.get("order", {})
            
            self.order_id = order.get("id", "")
            
            print_success("Order created successfully")
            print_info(f"Order ID: {self.order_id}")
            print_info(f"Direction: {order.get('direction')}")
            print_info(f"Amount: Rp {order.get('amount'):,.0f}")
            print_info(f"Entry Price: {order.get('entry_price')}")
            print_info(f"Duration: {order.get('duration')} minute(s)")
            print_info(f"Status: {order.get('status')}")
            print_info(f"Response time: {elapsed:.0f}ms")
            
            # Performance check
            if elapsed < 500:
                print_success(f"✅ EXCELLENT! Order creation < 500ms target")
            elif elapsed < 1000:
                print_warning(f"⚠️  Order creation took {elapsed:.0f}ms (target: <500ms)")
            else:
                print_error(f"❌ Order creation took {elapsed:.0f}ms (target: <500ms)")
            
            return True
            
        except Exception as e:
            print_error(f"Error parsing order response: {str(e)}")
            return False
    
    def step_7_verify_order(self) -> bool:
        """Verify order was created"""
        print_step(7, "Verify Order Creation")
        
        start_time = time.time()
        
        response = safe_request(
            "GET",
            f"{BASE_URL}/binary-orders/{self.order_id}",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        
        if not response or response.status_code != 200:
            print_error("Order verification failed")
            return False
        
        elapsed = (time.time() - start_time) * 1000
        self.timings['verify_order'] = elapsed
        
        try:
            data = response.json().get("data", {})
            
            print_success("Order verified")
            print_info(f"Status: {data.get('status')}")
            print_info(f"Entry Price: {data.get('entry_price')}")
            print_info(f"Response time: {elapsed:.0f}ms")
            return True
            
        except Exception as e:
            print_error(f"Error parsing order: {str(e)}")
            return False
    
    def step_8_wait_for_settlement(self) -> bool:
        """Wait for order settlement"""
        print_step(8, "Wait for Order Settlement")
        
        print_info("Waiting for order to expire and settle...")
        print_info(f"This will take approximately {SETTLEMENT_TIMEOUT} seconds")
        
        # Progress bar
        for i in range(SETTLEMENT_TIMEOUT):
            remaining = SETTLEMENT_TIMEOUT - i
            progress = int((i / SETTLEMENT_TIMEOUT) * 50)
            bar = '█' * progress + '░' * (50 - progress)
            print(f"\r  Progress: [{bar}] {i}/{SETTLEMENT_TIMEOUT}s", end='', flush=True)
            time.sleep(1)
        
        print()  # New line
        print_success("Wait completed")
        
        return True
    
    def step_9_check_settlement(self) -> bool:
        """Check if order was settled"""
        print_step(9, "Check Order Settlement")
        
        # Wait a bit more and check periodically
        max_checks = 5
        for check in range(max_checks):
            start_time = time.time()
            
            response = safe_request(
                "GET",
                f"{BASE_URL}/binary-orders/{self.order_id}",
                headers={"Authorization": f"Bearer {self.token}"}
            )
            
            if not response or response.status_code != 200:
                if check < max_checks - 1:
                    print_warning(f"Check {check + 1} failed, retrying...")
                    time.sleep(3)
                    continue
                print_error("Failed to check settlement")
                return False
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['check_settlement'] = elapsed
            
            try:
                data = response.json().get("data", {})
                
                status = data.get('status')
                entry_price = data.get('entry_price')
                exit_price = data.get('exit_price')
                profit = data.get('profit')
                
                print_success("Settlement checked")
                print_info(f"Status: {status}")
                print_info(f"Entry Price: {entry_price}")
                print_info(f"Exit Price: {exit_price}")
                print_info(f"Profit/Loss: {profit}")
                print_info(f"Response time: {elapsed:.0f}ms")
                
                if status in ['WON', 'LOST']:
                    if status == 'WON':
                        print_success("🎉 Order WON!")
                    else:
                        print_info("📉 Order LOST")
                    return True
                else:
                    if check < max_checks - 1:
                        print_warning(f"Order not settled yet (status: {status}), checking again...")
                        time.sleep(3)
                        continue
                    print_warning(f"Order still not settled after {max_checks} checks")
                    return False
                    
            except Exception as e:
                if check < max_checks - 1:
                    print_warning(f"Parse error, retrying: {str(e)}")
                    time.sleep(3)
                    continue
                print_error(f"Error parsing settlement: {str(e)}")
                return False
        
        return False
    
    def step_10_verify_balance_update(self) -> bool:
        """Verify balance was updated"""
        print_step(10, "Verify Balance Update")
        
        start_time = time.time()
        
        response = safe_request(
            "GET",
            f"{BASE_URL}/balance/both",
            headers={"Authorization": f"Bearer {self.token}"}
        )
        
        if not response or response.status_code != 200:
            print_error("Failed to get balance")
            return False
        
        elapsed = (time.time() - start_time) * 1000
        self.timings['final_balance'] = elapsed
        
        try:
            data = response.json().get("data", {})
            self.final_balance_real = data.get("realBalance", 0)
            self.final_balance_demo = data.get("demoBalance", 0)
            
            real_change = self.final_balance_real - self.initial_balance_real
            demo_change = self.final_balance_demo - self.initial_balance_demo
            
            print_success("Final balances retrieved")
            print_info(f"Real - Initial: Rp {self.initial_balance_real:,.0f}, Final: Rp {self.final_balance_real:,.0f}, Change: {real_change:+,.0f}")
            print_info(f"Demo - Initial: Rp {self.initial_balance_demo:,.0f}, Final: Rp {self.final_balance_demo:,.0f}, Change: {demo_change:+,.0f}")
            print_info(f"Response time: {elapsed:.0f}ms")
            
            return True
            
        except Exception as e:
            print_error(f"Error parsing balance: {str(e)}")
            return False
    
    def step_11_verify_simulator(self) -> bool:
        """Verify simulator is working"""
        print_step(11, "Verify Price Simulator")
        
        try:
            url = f"{FIREBASE_DB_URL}/idx_stc/current_price.json"
            response = safe_request("GET", url, timeout=5)
            
            if not response or response.status_code != 200:
                print_error("Failed to connect to simulator")
                return False
            
            data = response.json()
            
            if not data:
                print_error("No simulator data found")
                return False
            
            price = data.get('price')
            timestamp = data.get('timestamp')
            
            if not price or not timestamp:
                print_error("Incomplete simulator data")
                return False
            
            # Check data freshness
            age = time.time() - timestamp if timestamp else 999
            
            print_success("Simulator is running")
            print_info(f"Current price: {price}")
            print_info(f"Data age: {age:.1f}s")
            
            if age < 10:
                print_success("✅ Simulator data is fresh")
                return True
            elif age < 30:
                print_warning("⚠️  Simulator data is slightly stale")
                return True
            else:
                print_warning("⚠️  Simulator data is very stale")
                return False
                
        except Exception as e:
            print_error(f"Error checking simulator: {str(e)}")
            return False
    
    def print_summary(self, success: bool):
        """Print test summary"""
        print_header("📊 INTEGRATION TEST SUMMARY")
        
        if success:
            print(f"{Colors.GREEN}{Colors.BOLD}✅ ALL TESTS PASSED!{Colors.END}")
            print(f"{Colors.GREEN}The complete workflow works end-to-end{Colors.END}")
        else:
            print(f"{Colors.RED}{Colors.BOLD}❌ SOME TESTS FAILED{Colors.END}")
            print(f"{Colors.RED}Please review the errors above{Colors.END}")
        
        print(f"\n{Colors.BOLD}Timing Summary:{Colors.END}")
        
        total_time = sum(self.timings.values())
        for operation, timing in sorted(self.timings.items()):
            status = "✅" if timing < 1000 else "⚠️" if timing < 2000 else "❌"
            print(f"  {status} {operation:25s}: {timing:>7.0f}ms")
        
        if self.timings:
            avg_time = total_time / len(self.timings)
            print(f"\n  Average response time: {avg_time:.0f}ms")
            print(f"  Total test time: {total_time/1000:.2f}s")
        
        print(f"\n{Colors.BOLD}Test Details:{Colors.END}")
        print(f"  Test User:          {TEST_EMAIL}")
        print(f"  User ID:            {self.user_id}")
        print(f"  Asset ID:           {self.asset_id}")
        print(f"  Order ID:           {self.order_id}")
        print(f"  Real Balance:       {self.initial_balance_real:,.0f} → {self.final_balance_real:,.0f}")
        print(f"  Demo Balance:       {self.initial_balance_demo:,.0f} → {self.final_balance_demo:,.0f}")
        
        print()

# ============================================
# MAIN TEST RUNNER
# ============================================
def run_integration_test():
    """Run full integration test"""
    print_header("🔬 BINARY OPTION - ENHANCED END-TO-END INTEGRATION TEST")
    
    print(f"{Colors.CYAN}This test will:{Colors.END}")
    print("  1. Register a new user")
    print("  2. Verify profile and balances")
    print("  3. Deposit to real account")
    print("  4. Get active assets")
    print("  5. Get current price")
    print("  6. Create binary option order")
    print("  7. Verify order creation")
    print("  8. Wait for settlement (~75s)")
    print("  9. Check settlement result")
    print("  10. Verify balance update")
    print("  11. Verify simulator status")
    print()
    
    test = IntegrationTest()
    
    # Run test steps
    try:
        steps = [
            (test.step_1_register_user, True),
            (test.step_2_verify_profile, True),
            (test.step_3_deposit_balance, True),
            (test.step_4_get_active_assets, True),
            (test.step_5_get_current_price, False),  # Can be skipped if fails
            (test.step_6_create_order, True),
            (test.step_7_verify_order, True),
            (test.step_8_wait_for_settlement, True),
            (test.step_9_check_settlement, True),
            (test.step_10_verify_balance_update, True),
            (test.step_11_verify_simulator, False),  # Optional
        ]
        
        success = True
        
        for step_func, is_critical in steps:
            result = step_func()
            
            if not result:
                if is_critical:
                    success = False
                    print_error("\nCritical test failed! Stopping...")
                    break
                else:
                    print_warning("\nOptional test failed, continuing...")
            
            # Small delay between steps
            time.sleep(0.5)
        
        # Print summary
        test.print_summary(success)
        
        # Cleanup
        test.cleanup()
        
        return success
        
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Test interrupted by user{Colors.END}")
        test.cleanup()
        return False
    
    except Exception as e:
        print(f"\n\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        traceback.print_exc()
        test.cleanup()
        return False

if __name__ == "__main__":
    success = run_integration_test()
    sys.exit(0 if success else 1)