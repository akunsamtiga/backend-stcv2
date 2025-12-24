#!/usr/bin/env python3
"""
Binary Option Trading System - End-to-End Integration Testing
=============================================================
Complete workflow testing from registration to order settlement
"""

import requests
import time
import json
from typing import Dict, Optional
from datetime import datetime
import sys

# ============================================
# CONFIGURATION
# ============================================
BASE_URL = "http://localhost:3000/api/v1"
FIREBASE_DB_URL = "https://stc-autotrade-18f67-default-rtdb.asia-southeast1.firebasedatabase.app"

# Test user
TEST_EMAIL = f"integration_test_{int(time.time())}@example.com"
TEST_PASSWORD = "IntegrationTest123!"

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
    print(f"{Colors.YELLOW}⚠{Colors.END} {text}")

# ============================================
# INTEGRATION TEST SCENARIO
# ============================================
class IntegrationTest:
    def __init__(self):
        self.token = ""
        self.user_id = ""
        self.asset_id = ""
        self.order_id = ""
        self.initial_balance = 0
        self.final_balance = 0
        
        self.timings = {}
    
    def step_1_register_user(self) -> bool:
        """Register new user"""
        print_step(1, "Register New User")
        
        start_time = time.time()
        
        try:
            response = requests.post(
                f"{BASE_URL}/auth/register",
                json={
                    "email": TEST_EMAIL,
                    "password": TEST_PASSWORD
                },
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['register'] = elapsed
            
            if response.status_code == 201:
                data = response.json()
                self.token = data.get("data", {}).get("token", "")
                self.user_id = data.get("data", {}).get("user", {}).get("id", "")
                
                print_success(f"User registered: {TEST_EMAIL}")
                print_info(f"User ID: {self.user_id}")
                print_info(f"Response time: {elapsed:.0f}ms")
                return True
            else:
                print_error(f"Registration failed: {response.status_code}")
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return False
    
    def step_2_verify_profile(self) -> bool:
        """Verify user profile"""
        print_step(2, "Verify User Profile")
        
        start_time = time.time()
        
        try:
            response = requests.get(
                f"{BASE_URL}/user/profile",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['profile'] = elapsed
            
            if response.status_code == 200:
                data = response.json().get("data", {})
                
                print_success("Profile retrieved")
                print_info(f"Email: {data.get('user', {}).get('email')}")
                print_info(f"Role: {data.get('user', {}).get('role')}")
                print_info(f"Initial Balance: {data.get('balance', 0)}")
                print_info(f"Response time: {elapsed:.0f}ms")
                
                self.initial_balance = data.get('balance', 0)
                return True
            else:
                print_error(f"Profile retrieval failed: {response.status_code}")
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return False
    
    def step_3_deposit_balance(self) -> bool:
        """Deposit initial balance"""
        print_step(3, "Deposit Initial Balance")
        
        start_time = time.time()
        deposit_amount = 10000
        
        try:
            response = requests.post(
                f"{BASE_URL}/balance",
                headers={"Authorization": f"Bearer {self.token}"},
                json={
                    "type": "deposit",
                    "amount": deposit_amount,
                    "description": "Integration test deposit"
                },
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['deposit'] = elapsed
            
            if response.status_code == 201:
                data = response.json().get("data", {})
                current_balance = data.get("currentBalance", 0)
                
                print_success(f"Deposited {deposit_amount}")
                print_info(f"New balance: {current_balance}")
                print_info(f"Response time: {elapsed:.0f}ms")
                
                self.initial_balance = current_balance
                return True
            else:
                print_error(f"Deposit failed: {response.status_code}")
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return False
    
    def step_4_get_active_assets(self) -> bool:
        """Get active trading assets"""
        print_step(4, "Get Active Trading Assets")
        
        start_time = time.time()
        
        try:
            response = requests.get(
                f"{BASE_URL}/assets?activeOnly=true",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['assets'] = elapsed
            
            if response.status_code == 200:
                data = response.json().get("data", {})
                assets = data.get("assets", [])
                
                if assets:
                    self.asset_id = assets[0]["id"]
                    
                    print_success(f"Found {len(assets)} active assets")
                    print_info(f"Selected asset: {assets[0]['name']} ({assets[0]['symbol']})")
                    print_info(f"Profit rate: {assets[0]['profitRate']}%")
                    print_info(f"Response time: {elapsed:.0f}ms")
                    return True
                else:
                    print_error("No active assets found")
                    return False
            else:
                print_error(f"Failed to get assets: {response.status_code}")
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return False
    
    def step_5_get_current_price(self) -> Optional[float]:
        """Get current asset price"""
        print_step(5, "Get Current Asset Price")
        
        start_time = time.time()
        
        try:
            response = requests.get(
                f"{BASE_URL}/assets/{self.asset_id}/price",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['price'] = elapsed
            
            if response.status_code == 200:
                data = response.json().get("data", {})
                price = data.get("price")
                
                print_success("Price retrieved")
                print_info(f"Current price: {price}")
                print_info(f"Timestamp: {data.get('datetime')}")
                print_info(f"Response time: {elapsed:.0f}ms")
                
                if elapsed > 500:
                    print_warning("Price fetch took >500ms - may impact order creation")
                
                return price
            else:
                print_error(f"Failed to get price: {response.status_code}")
                return None
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return None
    
    def step_6_create_order(self) -> bool:
        """Create binary option order"""
        print_step(6, "Create Binary Option Order (CRITICAL)")
        
        start_time = time.time()
        order_amount = 1000
        order_duration = 1  # 1 minute
        
        try:
            response = requests.post(
                f"{BASE_URL}/binary-orders",
                headers={"Authorization": f"Bearer {self.token}"},
                json={
                    "asset_id": self.asset_id,
                    "direction": "CALL",
                    "amount": order_amount,
                    "duration": order_duration
                },
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['create_order'] = elapsed
            
            if response.status_code == 201:
                data = response.json().get("data", {})
                order = data.get("order", {})
                
                self.order_id = order.get("id", "")
                
                print_success("Order created successfully")
                print_info(f"Order ID: {self.order_id}")
                print_info(f"Direction: {order.get('direction')}")
                print_info(f"Amount: {order.get('amount')}")
                print_info(f"Entry Price: {order.get('entry_price')}")
                print_info(f"Duration: {order.get('duration')} minute(s)")
                print_info(f"Status: {order.get('status')}")
                print_info(f"Response time: {elapsed:.0f}ms")
                
                # Performance check
                if elapsed < 500:
                    print_success(f"✅ Excellent! Order creation under 500ms target")
                elif elapsed < 1000:
                    print_warning(f"⚠️  Order creation took {elapsed:.0f}ms (target: <500ms)")
                else:
                    print_error(f"❌ Order creation took {elapsed:.0f}ms (target: <500ms)")
                
                return True
            else:
                print_error(f"Order creation failed: {response.status_code}")
                try:
                    error_data = response.json()
                    print_error(f"Error: {error_data.get('error', 'Unknown')}")
                except:
                    pass
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return False
    
    def step_7_verify_order(self) -> bool:
        """Verify order was created"""
        print_step(7, "Verify Order Creation")
        
        start_time = time.time()
        
        try:
            response = requests.get(
                f"{BASE_URL}/binary-orders/{self.order_id}",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['verify_order'] = elapsed
            
            if response.status_code == 200:
                data = response.json().get("data", {})
                
                print_success("Order verified")
                print_info(f"Status: {data.get('status')}")
                print_info(f"Response time: {elapsed:.0f}ms")
                return True
            else:
                print_error(f"Order verification failed: {response.status_code}")
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return False
    
    def step_8_wait_for_settlement(self) -> bool:
        """Wait for order settlement"""
        print_step(8, "Wait for Order Settlement")
        
        print_info("Waiting for order to expire and settle...")
        print_info("This will take approximately 70 seconds (1 minute + buffer)")
        
        # Wait for order duration + buffer for settlement
        wait_time = 70  # 60 seconds + 10 second buffer
        
        for i in range(wait_time):
            remaining = wait_time - i
            print(f"  Waiting... {remaining}s remaining", end='\r')
            time.sleep(1)
        
        print()  # New line
        print_success("Wait completed")
        
        return True
    
    def step_9_check_settlement(self) -> bool:
        """Check if order was settled"""
        print_step(9, "Check Order Settlement")
        
        start_time = time.time()
        
        try:
            response = requests.get(
                f"{BASE_URL}/binary-orders/{self.order_id}",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['check_settlement'] = elapsed
            
            if response.status_code == 200:
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
                    print_warning(f"Order not settled yet (status: {status})")
                    return False
            else:
                print_error(f"Failed to check settlement: {response.status_code}")
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return False
    
    def step_10_verify_balance_update(self) -> bool:
        """Verify balance was updated"""
        print_step(10, "Verify Balance Update")
        
        start_time = time.time()
        
        try:
            response = requests.get(
                f"{BASE_URL}/balance/current",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=10
            )
            
            elapsed = (time.time() - start_time) * 1000
            self.timings['final_balance'] = elapsed
            
            if response.status_code == 200:
                data = response.json().get("data", {})
                self.final_balance = data.get("balance", 0)
                
                balance_change = self.final_balance - self.initial_balance
                
                print_success("Final balance retrieved")
                print_info(f"Initial Balance: {self.initial_balance}")
                print_info(f"Final Balance: {self.final_balance}")
                print_info(f"Change: {balance_change:+.2f}")
                print_info(f"Response time: {elapsed:.0f}ms")
                
                return True
            else:
                print_error(f"Failed to get balance: {response.status_code}")
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
            return False
    
    def step_11_verify_simulator(self) -> bool:
        """Verify simulator is working"""
        print_step(11, "Verify Price Simulator")
        
        try:
            url = f"{FIREBASE_DB_URL}/idx_stc/current_price.json"
            response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                
                if data:
                    price = data.get('price')
                    timestamp = data.get('timestamp')
                    
                    # Check data freshness
                    age = time.time() - timestamp if timestamp else 999
                    
                    print_success("Simulator is running")
                    print_info(f"Current price: {price}")
                    print_info(f"Data age: {age:.1f}s")
                    
                    if age < 10:
                        print_success("✅ Simulator data is fresh")
                    else:
                        print_warning("⚠️  Simulator data is stale")
                    
                    return age < 30  # Data must be less than 30s old
                else:
                    print_error("No simulator data found")
                    return False
            else:
                print_error("Failed to connect to simulator")
                return False
                
        except Exception as e:
            print_error(f"Error: {str(e)}")
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
        
        for operation, timing in self.timings.items():
            status = "✅" if timing < 1000 else "⚠️"
            print(f"  {status} {operation:20s}: {timing:>6.0f}ms")
        
        if self.timings:
            avg_time = sum(self.timings.values()) / len(self.timings)
            print(f"\n  Average response time: {avg_time:.0f}ms")
        
        print(f"\n{Colors.BOLD}Test Details:{Colors.END}")
        print(f"  Test User:        {TEST_EMAIL}")
        print(f"  User ID:          {self.user_id}")
        print(f"  Asset ID:         {self.asset_id}")
        print(f"  Order ID:         {self.order_id}")
        print(f"  Initial Balance:  {self.initial_balance}")
        print(f"  Final Balance:    {self.final_balance}")
        
        print()

# ============================================
# MAIN TEST RUNNER
# ============================================
def run_integration_test():
    """Run full integration test"""
    print_header("🔬 BINARY OPTION - END-TO-END INTEGRATION TEST")
    
    print(f"{Colors.CYAN}This test will:{Colors.END}")
    print("  1. Register a new user")
    print("  2. Deposit balance")
    print("  3. Get active assets")
    print("  4. Create a binary option order")
    print("  5. Wait for settlement")
    print("  6. Verify the complete workflow")
    print()
    
    test = IntegrationTest()
    
    # Run test steps
    try:
        steps = [
            test.step_1_register_user,
            test.step_2_verify_profile,
            test.step_3_deposit_balance,
            test.step_4_get_active_assets,
            test.step_5_get_current_price,
            test.step_6_create_order,
            test.step_7_verify_order,
            test.step_8_wait_for_settlement,
            test.step_9_check_settlement,
            test.step_10_verify_balance_update,
            test.step_11_verify_simulator,
        ]
        
        success = True
        
        for step_func in steps:
            result = step_func()
            
            if not result:
                success = False
                print_error("\nTest failed! Stopping...")
                break
            
            # Small delay between steps
            time.sleep(0.5)
        
        # Print summary
        test.print_summary(success)
        
        return success
        
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Test interrupted by user{Colors.END}")
        return False
    
    except Exception as e:
        print(f"\n\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = run_integration_test()
    sys.exit(0 if success else 1)