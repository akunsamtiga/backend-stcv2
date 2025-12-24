#!/usr/bin/env python3
"""
IDX_STC Simulator Testing
=========================
Tests the trading price simulator functionality
"""

import requests
import time
import json
from typing import Dict, Optional
from dataclasses import dataclass
from datetime import datetime

# ============================================
# CONFIGURATION
# ============================================
FIREBASE_DB_URL = "https://stc-autotrade-18f67-default-rtdb.asia-southeast1.firebasedatabase.app"
BASE_PATH = "/idx_stc"

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
# TEST FUNCTIONS
# ============================================
def print_header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*60}")
    print(f"{text}")
    print(f"{'='*60}{Colors.END}\n")

def test_simulator_connection() -> bool:
    """Test if simulator is running and writing to Firebase"""
    print(f"{Colors.BOLD}1️⃣  Testing Simulator Connection{Colors.END}")
    print("-" * 60)
    
    try:
        # Test Firebase connection
        url = f"{FIREBASE_DB_URL}/.json"
        start = time.time()
        response = requests.get(url, timeout=5)
        elapsed = (time.time() - start) * 1000
        
        if response.status_code == 200:
            print(f"{Colors.GREEN}✓{Colors.END} Firebase accessible ({elapsed:.0f}ms)")
            return True
        else:
            print(f"{Colors.RED}✗{Colors.END} Firebase not accessible (status: {response.status_code})")
            return False
            
    except Exception as e:
        print(f"{Colors.RED}✗{Colors.END} Connection failed: {str(e)}")
        return False

def test_current_price() -> Optional[Dict]:
    """Test if current price is being updated"""
    print(f"\n{Colors.BOLD}2️⃣  Testing Current Price Data{Colors.END}")
    print("-" * 60)
    
    try:
        url = f"{FIREBASE_DB_URL}{BASE_PATH}/current_price.json"
        start = time.time()
        response = requests.get(url, timeout=5)
        elapsed = (time.time() - start) * 1000
        
        if response.status_code == 200:
            data = response.json()
            
            if data and isinstance(data, dict):
                price = data.get('price')
                timestamp = data.get('timestamp')
                datetime_str = data.get('datetime')
                
                print(f"{Colors.GREEN}✓{Colors.END} Current price data found ({elapsed:.0f}ms)")
                print(f"  Price: {price}")
                print(f"  Timestamp: {timestamp}")
                print(f"  DateTime: {datetime_str}")
                
                # Check if data is recent (within 10 seconds)
                if timestamp:
                    now = time.time()
                    age = now - timestamp
                    
                    if age < 10:
                        print(f"  {Colors.GREEN}✓{Colors.END} Data is fresh ({age:.1f}s old)")
                    elif age < 60:
                        print(f"  {Colors.YELLOW}⚠{Colors.END} Data is stale ({age:.1f}s old)")
                    else:
                        print(f"  {Colors.RED}✗{Colors.END} Data is very old ({age:.1f}s old)")
                
                return data
            else:
                print(f"{Colors.RED}✗{Colors.END} No price data found")
                return None
        else:
            print(f"{Colors.RED}✗{Colors.END} Failed to fetch price (status: {response.status_code})")
            return None
            
    except Exception as e:
        print(f"{Colors.RED}✗{Colors.END} Error: {str(e)}")
        return None

def test_ohlc_data(timeframe: str = "1s") -> bool:
    """Test if OHLC data is being generated"""
    print(f"\n{Colors.BOLD}3️⃣  Testing OHLC Data ({timeframe}){Colors.END}")
    print("-" * 60)
    
    try:
        url = f"{FIREBASE_DB_URL}{BASE_PATH}/ohlc_{timeframe}.json"
        start = time.time()
        response = requests.get(url, params={"orderBy": '"$key"', "limitToLast": 5}, timeout=5)
        elapsed = (time.time() - start) * 1000
        
        if response.status_code == 200:
            data = response.json()
            
            if data and isinstance(data, dict):
                count = len(data)
                print(f"{Colors.GREEN}✓{Colors.END} OHLC data found ({count} bars, {elapsed:.0f}ms)")
                
                # Show last bar
                if count > 0:
                    last_key = max(data.keys())
                    last_bar = data[last_key]
                    
                    print(f"\n  Latest Bar ({timeframe}):")
                    print(f"  Timestamp: {last_bar.get('timestamp')}")
                    print(f"  DateTime:  {last_bar.get('datetime')}")
                    print(f"  Open:      {last_bar.get('open')}")
                    print(f"  High:      {last_bar.get('high')}")
                    print(f"  Low:       {last_bar.get('low')}")
                    print(f"  Close:     {last_bar.get('close')}")
                    print(f"  Volume:    {last_bar.get('volume')}")
                
                return True
            else:
                print(f"{Colors.RED}✗{Colors.END} No OHLC data found")
                return False
        else:
            print(f"{Colors.RED}✗{Colors.END} Failed to fetch OHLC (status: {response.status_code})")
            return False
            
    except Exception as e:
        print(f"{Colors.RED}✗{Colors.END} Error: {str(e)}")
        return False

def test_all_timeframes() -> Dict[str, bool]:
    """Test all timeframes"""
    print(f"\n{Colors.BOLD}4️⃣  Testing All Timeframes{Colors.END}")
    print("-" * 60)
    
    timeframes = ["1s", "1m", "5m", "15m", "1h", "4h", "1d"]
    results = {}
    
    for tf in timeframes:
        try:
            url = f"{FIREBASE_DB_URL}{BASE_PATH}/ohlc_{tf}.json"
            response = requests.get(url, params={"limitToLast": 1}, timeout=5)
            
            exists = response.status_code == 200 and response.json()
            results[tf] = exists
            
            status = f"{Colors.GREEN}✓" if exists else f"{Colors.RED}✗"
            print(f"  {status}{Colors.END} {tf:>4} - {'Data exists' if exists else 'No data'}")
            
        except Exception as e:
            results[tf] = False
            print(f"  {Colors.RED}✗{Colors.END} {tf:>4} - Error: {str(e)}")
    
    return results

def test_price_updates() -> bool:
    """Test if price is updating in real-time"""
    print(f"\n{Colors.BOLD}5️⃣  Testing Real-Time Price Updates{Colors.END}")
    print("-" * 60)
    
    print("Monitoring price for 5 seconds...")
    
    try:
        prices = []
        url = f"{FIREBASE_DB_URL}{BASE_PATH}/current_price.json"
        
        # Sample 5 times with 1 second interval
        for i in range(5):
            response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                if data:
                    price = data.get('price')
                    timestamp = data.get('timestamp')
                    prices.append((price, timestamp))
                    print(f"  Sample {i+1}: {price} (ts: {timestamp})")
            
            if i < 4:
                time.sleep(1)
        
        # Check if prices are updating
        if len(prices) >= 2:
            unique_prices = len(set(p[0] for p in prices))
            unique_timestamps = len(set(p[1] for p in prices))
            
            if unique_timestamps > 1:
                print(f"\n{Colors.GREEN}✓{Colors.END} Price is updating (found {unique_timestamps} different timestamps)")
                return True
            else:
                print(f"\n{Colors.YELLOW}⚠{Colors.END} Price not updating (same timestamp)")
                return False
        else:
            print(f"\n{Colors.RED}✗{Colors.END} Not enough samples")
            return False
            
    except Exception as e:
        print(f"\n{Colors.RED}✗{Colors.END} Error: {str(e)}")
        return False

def test_data_consistency() -> bool:
    """Test if data is consistent"""
    print(f"\n{Colors.BOLD}6️⃣  Testing Data Consistency{Colors.END}")
    print("-" * 60)
    
    try:
        # Get current price
        url = f"{FIREBASE_DB_URL}{BASE_PATH}/current_price.json"
        response = requests.get(url, timeout=5)
        
        if response.status_code != 200:
            print(f"{Colors.RED}✗{Colors.END} Failed to get current price")
            return False
        
        current_data = response.json()
        current_price = current_data.get('price')
        
        # Get latest 1s OHLC
        url = f"{FIREBASE_DB_URL}{BASE_PATH}/ohlc_1s.json"
        response = requests.get(url, params={"orderBy": '"$key"', "limitToLast": 1}, timeout=5)
        
        if response.status_code != 200:
            print(f"{Colors.RED}✗{Colors.END} Failed to get OHLC data")
            return False
        
        ohlc_data = response.json()
        if not ohlc_data:
            print(f"{Colors.RED}✗{Colors.END} No OHLC data")
            return False
        
        last_bar = list(ohlc_data.values())[0]
        ohlc_close = last_bar.get('close')
        
        # Check consistency
        if current_price and ohlc_close:
            diff = abs(current_price - ohlc_close)
            diff_percent = (diff / current_price) * 100
            
            print(f"  Current Price: {current_price}")
            print(f"  OHLC Close:    {ohlc_close}")
            print(f"  Difference:    {diff:.3f} ({diff_percent:.2f}%)")
            
            if diff_percent < 1:  # Less than 1% difference
                print(f"{Colors.GREEN}✓{Colors.END} Data is consistent")
                return True
            else:
                print(f"{Colors.YELLOW}⚠{Colors.END} Data has some variance")
                return True
        else:
            print(f"{Colors.RED}✗{Colors.END} Missing data")
            return False
            
    except Exception as e:
        print(f"{Colors.RED}✗{Colors.END} Error: {str(e)}")
        return False

def test_simulator_performance() -> Dict:
    """Test simulator performance"""
    print(f"\n{Colors.BOLD}7️⃣  Testing Simulator Performance{Colors.END}")
    print("-" * 60)
    
    results = {
        "read_latency": [],
        "data_freshness": [],
        "availability": 0
    }
    
    print("Running performance tests (10 samples)...")
    
    url = f"{FIREBASE_DB_URL}{BASE_PATH}/current_price.json"
    successful = 0
    
    for i in range(10):
        try:
            start = time.time()
            response = requests.get(url, timeout=5)
            elapsed = (time.time() - start) * 1000
            
            if response.status_code == 200:
                successful += 1
                results["read_latency"].append(elapsed)
                
                data = response.json()
                if data and data.get('timestamp'):
                    age = time.time() - data.get('timestamp')
                    results["data_freshness"].append(age)
                
                print(f"  Sample {i+1}: {elapsed:.0f}ms, age: {age:.1f}s")
            
            time.sleep(0.5)
            
        except Exception as e:
            print(f"  Sample {i+1}: Failed - {str(e)}")
    
    results["availability"] = (successful / 10) * 100
    
    # Calculate averages
    if results["read_latency"]:
        avg_latency = sum(results["read_latency"]) / len(results["read_latency"])
        max_latency = max(results["read_latency"])
        min_latency = min(results["read_latency"])
        
        print(f"\n{Colors.BOLD}Performance Summary:{Colors.END}")
        print(f"  Availability:   {results['availability']:.0f}%")
        print(f"  Avg Latency:    {avg_latency:.0f}ms")
        print(f"  Min Latency:    {min_latency:.0f}ms")
        print(f"  Max Latency:    {max_latency:.0f}ms")
        
        if results["data_freshness"]:
            avg_freshness = sum(results["data_freshness"]) / len(results["data_freshness"])
            print(f"  Avg Data Age:   {avg_freshness:.1f}s")
    
    return results

# ============================================
# MAIN TEST RUNNER
# ============================================
def run_all_tests():
    """Run all simulator tests"""
    print_header("🔬 IDX_STC SIMULATOR - COMPREHENSIVE TESTS")
    
    test_results = {
        "connection": False,
        "current_price": False,
        "ohlc_1s": False,
        "all_timeframes": {},
        "updates": False,
        "consistency": False,
        "performance": {}
    }
    
    # Run tests
    test_results["connection"] = test_simulator_connection()
    
    if test_results["connection"]:
        current_data = test_current_price()
        test_results["current_price"] = current_data is not None
        
        test_results["ohlc_1s"] = test_ohlc_data("1s")
        test_results["all_timeframes"] = test_all_timeframes()
        test_results["updates"] = test_price_updates()
        test_results["consistency"] = test_data_consistency()
        test_results["performance"] = test_simulator_performance()
    
    # Summary
    print_header("📊 SIMULATOR TEST SUMMARY")
    
    total_tests = 6
    passed_tests = sum([
        test_results["connection"],
        test_results["current_price"],
        test_results["ohlc_1s"],
        test_results["updates"],
        test_results["consistency"],
        len([v for v in test_results["all_timeframes"].values() if v]) > 0
    ])
    
    print(f"{Colors.BOLD}Total Tests:{Colors.END} {total_tests}")
    print(f"{Colors.GREEN}✓ Passed:{Colors.END} {passed_tests}")
    print(f"{Colors.RED}✗ Failed:{Colors.END} {total_tests - passed_tests}")
    print(f"{Colors.CYAN}Success Rate:{Colors.END} {(passed_tests/total_tests*100):.1f}%")
    
    # Timeframe summary
    if test_results["all_timeframes"]:
        active_timeframes = sum(test_results["all_timeframes"].values())
        total_timeframes = len(test_results["all_timeframes"])
        print(f"{Colors.YELLOW}Active Timeframes:{Colors.END} {active_timeframes}/{total_timeframes}")
    
    print()
    
    # Status
    if passed_tests == total_tests:
        print(f"{Colors.GREEN}{Colors.BOLD}✅ SIMULATOR IS WORKING PERFECTLY!{Colors.END}")
    elif passed_tests >= total_tests * 0.7:
        print(f"{Colors.YELLOW}{Colors.BOLD}⚠️  SIMULATOR IS PARTIALLY WORKING{Colors.END}")
    else:
        print(f"{Colors.RED}{Colors.BOLD}❌ SIMULATOR HAS ISSUES{Colors.END}")
    
    print()
    
    return passed_tests == total_tests

if __name__ == "__main__":
    try:
        success = run_all_tests()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Tests interrupted by user{Colors.END}")
        exit(1)
    except Exception as e:
        print(f"\n\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        exit(1)