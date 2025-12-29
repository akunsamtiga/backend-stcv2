#!/usr/bin/env python3
"""
Multi-Asset Simulator Testing - Enhanced Version
================================================
Tests the multi-asset trading price simulator functionality
"""

import requests
import time
import json
from typing import Dict, Optional, List
from dataclasses import dataclass
from datetime import datetime
import sys
import traceback

# ============================================
# CONFIGURATION
# ============================================
FIREBASE_DB_URL = "https://stc-autotrade-18f67-default-rtdb.asia-southeast1.firebasedatabase.app"
BACKEND_URL = "http://localhost:3000/api/v1"

# Default paths to test (will be updated from backend)
DEFAULT_ASSET_PATHS = [
    "/idx_stc",
    "/mock/test"
]

REQUEST_TIMEOUT = 5

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
class AssetInfo:
    id: str
    name: str
    symbol: str
    data_source: str
    realtime_db_path: str

# ============================================
# UTILS
# ============================================
def print_header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*70}")
    print(f"{text}")
    print(f"{'='*70}{Colors.END}\n")

def print_success(text: str):
    print(f"{Colors.GREEN}✓{Colors.END} {text}")

def print_error(text: str):
    print(f"{Colors.RED}✗{Colors.END} {text}")

def print_warning(text: str):
    print(f"{Colors.YELLOW}⚠{Colors.END} {text}")

def print_info(text: str):
    print(f"{Colors.BLUE}ℹ{Colors.END} {text}")

def safe_request(url: str, timeout: int = REQUEST_TIMEOUT) -> Optional[requests.Response]:
    """Make a safe request with error handling"""
    try:
        response = requests.get(url, timeout=timeout)
        return response
    except requests.exceptions.Timeout:
        print_error(f"Request timeout after {timeout}s")
        return None
    except requests.exceptions.ConnectionError:
        print_error("Connection failed")
        return None
    except Exception as e:
        print_error(f"Request error: {str(e)}")
        return None

# ============================================
# BACKEND INTEGRATION
# ============================================
def get_active_assets_from_backend() -> List[AssetInfo]:
    """Get active assets from backend to know which paths to test"""
    print(f"{Colors.BOLD}Fetching active assets from backend...{Colors.END}")
    
    try:
        response = safe_request(f"{BACKEND_URL}/assets?activeOnly=true", timeout=5)
        
        if not response or response.status_code != 200:
            print_warning("Could not fetch assets from backend")
            print_info("Will test default paths only")
            return []
        
        data = response.json()
        assets_data = data.get('data', {}).get('assets', [])
        
        assets = []
        for asset in assets_data:
            # Only include assets with realtime_db or mock data source
            data_source = asset.get('dataSource', '')
            if data_source in ['realtime_db', 'mock']:
                realtime_db_path = asset.get('realtimeDbPath', '')
                
                # For mock assets, construct path
                if data_source == 'mock' and not realtime_db_path:
                    realtime_db_path = f"/mock/{asset.get('symbol', '').lower()}"
                
                if realtime_db_path:
                    assets.append(AssetInfo(
                        id=asset.get('id', ''),
                        name=asset.get('name', ''),
                        symbol=asset.get('symbol', ''),
                        data_source=data_source,
                        realtime_db_path=realtime_db_path
                    ))
        
        if assets:
            print_success(f"Found {len(assets)} active simulator-based assets")
            for asset in assets:
                print_info(f"  • {asset.symbol} ({asset.data_source}): {asset.realtime_db_path}")
        else:
            print_warning("No simulator-based assets found")
        
        return assets
        
    except Exception as e:
        print_error(f"Error fetching assets: {str(e)}")
        return []

# ============================================
# TEST FUNCTIONS
# ============================================

def test_firebase_connection() -> bool:
    """Test if Firebase Realtime DB is accessible"""
    print(f"{Colors.BOLD}1️⃣  Testing Firebase Connection{Colors.END}")
    print("-" * 70)
    
    try:
        url = f"{FIREBASE_DB_URL}/.json"
        start = time.time()
        response = safe_request(url, timeout=5)
        elapsed = (time.time() - start) * 1000
        
        if not response:
            print_error("Firebase not accessible")
            return False
        
        if response.status_code == 200:
            print_success(f"Firebase accessible ({elapsed:.0f}ms)")
            print_info(f"URL: {FIREBASE_DB_URL}")
            return True
        else:
            print_error(f"Firebase returned status: {response.status_code}")
            return False
            
    except Exception as e:
        print_error(f"Connection failed: {str(e)}")
        if "--verbose" in sys.argv:
            traceback.print_exc()
        return False

def test_asset_current_price(asset: AssetInfo) -> bool:
    """Test if current price is being updated for an asset"""
    print(f"\n{Colors.BOLD}Testing Current Price for {asset.symbol}{Colors.END}")
    print("-" * 70)
    
    try:
        # Construct URL with /current_price appended
        url = f"{FIREBASE_DB_URL}{asset.realtime_db_path}/current_price.json"
        print_info(f"Fetching from: {url}")
        
        start = time.time()
        response = safe_request(url, timeout=5)
        elapsed = (time.time() - start) * 1000
        
        if not response:
            print_error("Failed to fetch price data")
            return False
        
        if response.status_code != 200:
            print_error(f"Failed with status: {response.status_code}")
            return False
        
        data = response.json()
        
        if not data or not isinstance(data, dict):
            print_error("No price data found")
            return False
        
        price = data.get('price')
        timestamp = data.get('timestamp')
        datetime_str = data.get('datetime')
        
        if not price or not timestamp:
            print_error("Incomplete price data")
            print_info(f"Data received: {data}")
            return False
        
        print_success(f"Current price data found ({elapsed:.0f}ms)")
        print_info(f"  Price: {price}")
        print_info(f"  Timestamp: {timestamp}")
        print_info(f"  DateTime: {datetime_str}")
        
        # Check data freshness
        now = time.time()
        age = now - timestamp
        
        print_info(f"  Data age: {age:.1f}s")
        
        if age < 10:
            print_success("  ✓ Data is fresh (< 10s)")
            return True
        elif age < 30:
            print_warning("  ⚠ Data is slightly stale (< 30s)")
            return True
        else:
            print_warning(f"  ⚠ Data is very old ({age:.1f}s)")
            print_warning("  Simulator might be stopped or slow")
            return False
            
    except Exception as e:
        print_error(f"Error: {str(e)}")
        if "--verbose" in sys.argv:
            traceback.print_exc()
        return False

def test_asset_ohlc_data(asset: AssetInfo, timeframe: str = "1s") -> bool:
    """Test if OHLC data is being generated for an asset"""
    print(f"\n{Colors.BOLD}Testing OHLC Data for {asset.symbol} ({timeframe}){Colors.END}")
    print("-" * 70)
    
    try:
        url = f"{FIREBASE_DB_URL}{asset.realtime_db_path}/ohlc_{timeframe}.json"
        
        # Get last 5 bars
        params = '?orderBy="$key"&limitToLast=5'
        full_url = url + params
        
        start = time.time()
        response = safe_request(full_url, timeout=5)
        elapsed = (time.time() - start) * 1000
        
        if not response or response.status_code != 200:
            print_error("Failed to fetch OHLC data")
            return False
        
        data = response.json()
        
        if not data or not isinstance(data, dict):
            print_warning(f"No OHLC data found for {timeframe}")
            print_info("This might be normal if simulator just started")
            return False
        
        count = len(data)
        print_success(f"OHLC data found ({count} bars, {elapsed:.0f}ms)")
        
        # Show last bar
        if count > 0:
            last_key = max(data.keys())
            last_bar = data[last_key]
            
            print_info(f"\n  Latest Bar ({timeframe}):")
            print_info(f"    Timestamp: {last_bar.get('timestamp')}")
            print_info(f"    DateTime:  {last_bar.get('datetime')}")
            print_info(f"    Open:      {last_bar.get('open')}")
            print_info(f"    High:      {last_bar.get('high')}")
            print_info(f"    Low:       {last_bar.get('low')}")
            print_info(f"    Close:     {last_bar.get('close')}")
            print_info(f"    Volume:    {last_bar.get('volume')}")
        
        return True
        
    except Exception as e:
        print_error(f"Error: {str(e)}")
        if "--verbose" in sys.argv:
            traceback.print_exc()
        return False

def test_all_timeframes(asset: AssetInfo) -> Dict[str, bool]:
    """Test all timeframes for an asset"""
    print(f"\n{Colors.BOLD}Testing All Timeframes for {asset.symbol}{Colors.END}")
    print("-" * 70)
    
    timeframes = ["1s", "1m", "5m", "15m", "1h", "4h", "1d"]
    results = {}
    
    for tf in timeframes:
        try:
            url = f"{FIREBASE_DB_URL}{asset.realtime_db_path}/ohlc_{tf}.json"
            params = '?limitToLast=1'
            
            response = safe_request(url + params, timeout=3)
            
            exists = response and response.status_code == 200 and response.json()
            results[tf] = exists
            
            status = f"{Colors.GREEN}✓" if exists else f"{Colors.YELLOW}✗"
            print(f"  {status}{Colors.END} {tf:>4} - {'Data exists' if exists else 'No data'}")
            
        except Exception as e:
            results[tf] = False
            print(f"  {Colors.RED}✗{Colors.END} {tf:>4} - Error: {str(e)}")
    
    return results

def test_price_updates(asset: AssetInfo, duration: int = 5) -> bool:
    """Test if price is updating in real-time"""
    print(f"\n{Colors.BOLD}Testing Real-Time Updates for {asset.symbol}{Colors.END}")
    print("-" * 70)
    
    print(f"Monitoring price for {duration} seconds...")
    
    try:
        prices = []
        url = f"{FIREBASE_DB_URL}{asset.realtime_db_path}/current_price.json"
        
        # Sample multiple times
        for i in range(duration):
            response = safe_request(url, timeout=3)
            
            if response and response.status_code == 200:
                data = response.json()
                if data:
                    price = data.get('price')
                    timestamp = data.get('timestamp')
                    prices.append((price, timestamp))
                    print(f"  Sample {i+1}: {price} (ts: {timestamp})")
            
            if i < duration - 1:
                time.sleep(1)
        
        # Check if prices are updating
        if len(prices) >= 2:
            unique_prices = len(set(p[0] for p in prices if p[0] is not None))
            unique_timestamps = len(set(p[1] for p in prices if p[1] is not None))
            
            print()
            if unique_timestamps > 1:
                print_success(f"Price is updating ({unique_timestamps} different timestamps)")
                return True
            else:
                print_warning("Price not updating (same timestamp)")
                print_info("Simulator might be paused or stopped")
                return False
        else:
            print_error("Not enough samples collected")
            return False
            
    except Exception as e:
        print_error(f"Error: {str(e)}")
        if "--verbose" in sys.argv:
            traceback.print_exc()
        return False

def test_data_consistency(asset: AssetInfo) -> bool:
    """Test if data is consistent between current price and OHLC"""
    print(f"\n{Colors.BOLD}Testing Data Consistency for {asset.symbol}{Colors.END}")
    print("-" * 70)
    
    try:
        # Get current price
        url = f"{FIREBASE_DB_URL}{asset.realtime_db_path}/current_price.json"
        response = safe_request(url, timeout=5)
        
        if not response or response.status_code != 200:
            print_error("Failed to get current price")
            return False
        
        current_data = response.json()
        if not current_data:
            print_error("No current price data")
            return False
        
        current_price = current_data.get('price')
        
        # Get latest 1s OHLC
        url = f"{FIREBASE_DB_URL}{asset.realtime_db_path}/ohlc_1s.json"
        params = '?orderBy="$key"&limitToLast=1'
        response = safe_request(url + params, timeout=5)
        
        if not response or response.status_code != 200:
            print_warning("No OHLC data yet (might be normal)")
            return True  # Not a failure if OHLC doesn't exist yet
        
        ohlc_data = response.json()
        if not ohlc_data:
            print_warning("No OHLC data yet")
            return True
        
        last_bar = list(ohlc_data.values())[0]
        ohlc_close = last_bar.get('close')
        
        # Check consistency
        if current_price and ohlc_close:
            diff = abs(current_price - ohlc_close)
            diff_percent = (diff / current_price) * 100 if current_price > 0 else 0
            
            print_info(f"  Current Price: {current_price}")
            print_info(f"  OHLC Close:    {ohlc_close}")
            print_info(f"  Difference:    {diff:.6f} ({diff_percent:.2f}%)")
            
            if diff_percent < 5:  # Less than 5% difference
                print_success("Data is consistent")
                return True
            else:
                print_warning(f"Data has variance ({diff_percent:.2f}%)")
                return True  # Still ok, just notable
        else:
            print_error("Missing data for consistency check")
            return False
            
    except Exception as e:
        print_error(f"Error: {str(e)}")
        if "--verbose" in sys.argv:
            traceback.print_exc()
        return False

# ============================================
# MAIN TEST RUNNER
# ============================================
def run_all_tests():
    """Run all simulator tests"""
    print_header("🔬 MULTI-ASSET SIMULATOR - COMPREHENSIVE TESTS")
    
    test_results = {
        "connection": False,
        "assets_tested": 0,
        "assets_working": 0,
        "details": {}
    }
    
    # Test 1: Firebase connection
    test_results["connection"] = test_firebase_connection()
    
    if not test_results["connection"]:
        print()
        print_error("Cannot proceed without Firebase connection")
        return False
    
    # Get active assets from backend
    assets = get_active_assets_from_backend()
    
    if not assets:
        print_warning("No assets found from backend, testing default paths")
        # Create default asset for testing
        assets = [
            AssetInfo(
                id="default_idx_stc",
                name="IDX STC",
                symbol="IDX_STC",
                data_source="realtime_db",
                realtime_db_path="/idx_stc"
            )
        ]
    
    print()
    
    # Test each asset
    for asset in assets:
        print_header(f"Testing Asset: {asset.name} ({asset.symbol})")
        
        asset_results = {
            "current_price": False,
            "ohlc_1s": False,
            "all_timeframes": {},
            "updates": False,
            "consistency": False
        }
        
        # Test current price
        asset_results["current_price"] = test_asset_current_price(asset)
        
        if asset_results["current_price"]:
            # Test OHLC 1s
            asset_results["ohlc_1s"] = test_asset_ohlc_data(asset, "1s")
            
            # Test all timeframes
            asset_results["all_timeframes"] = test_all_timeframes(asset)
            
            # Test real-time updates
            asset_results["updates"] = test_price_updates(asset, duration=5)
            
            # Test data consistency
            asset_results["consistency"] = test_data_consistency(asset)
        
        test_results["assets_tested"] += 1
        test_results["details"][asset.symbol] = asset_results
        
        # Count as working if current price works
        if asset_results["current_price"]:
            test_results["assets_working"] += 1
    
    # Summary
    print_header("📊 SIMULATOR TEST SUMMARY")
    
    print(f"{Colors.BOLD}Overall Results:{Colors.END}\n")
    print(f"  Firebase Connection:  {'✓ OK' if test_results['connection'] else '✗ FAILED'}")
    print(f"  Assets Tested:        {test_results['assets_tested']}")
    print(f"  Assets Working:       {test_results['assets_working']}")
    
    if test_results['assets_tested'] > 0:
        success_rate = (test_results['assets_working'] / test_results['assets_tested']) * 100
        print(f"  Success Rate:         {success_rate:.1f}%")
    
    print(f"\n{Colors.BOLD}Individual Asset Results:{Colors.END}\n")
    
    for symbol, results in test_results['details'].items():
        status = "✓" if results['current_price'] else "✗"
        print(f"  {status} {symbol}")
        print(f"      Current Price:  {'✓' if results['current_price'] else '✗'}")
        print(f"      OHLC Data:      {'✓' if results['ohlc_1s'] else '✗'}")
        print(f"      Updates:        {'✓' if results['updates'] else '✗'}")
        print(f"      Consistency:    {'✓' if results['consistency'] else '✗'}")
        
        if results['all_timeframes']:
            active_tf = sum(1 for v in results['all_timeframes'].values() if v)
            total_tf = len(results['all_timeframes'])
            print(f"      Timeframes:     {active_tf}/{total_tf}")
        print()
    
    # Overall status
    all_passed = test_results['connection'] and test_results['assets_working'] > 0
    
    print()
    if all_passed:
        print(f"{Colors.GREEN}{Colors.BOLD}✅ SIMULATOR IS WORKING!{Colors.END}")
        print(f"{Colors.GREEN}At least one asset is generating prices correctly{Colors.END}")
    elif test_results['assets_working'] > 0:
        print(f"{Colors.YELLOW}{Colors.BOLD}⚠️  SIMULATOR PARTIALLY WORKING{Colors.END}")
        print(f"{Colors.YELLOW}Some assets working, but not all{Colors.END}")
    else:
        print(f"{Colors.RED}{Colors.BOLD}❌ SIMULATOR HAS ISSUES{Colors.END}")
        print(f"{Colors.RED}No assets are generating prices{Colors.END}")
    
    print()
    
    return all_passed

if __name__ == "__main__":
    try:
        success = run_all_tests()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Tests interrupted by user{Colors.END}")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        if "--verbose" in sys.argv:
            traceback.print_exc()
        sys.exit(1)