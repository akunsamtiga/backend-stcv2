#!/usr/bin/env python3
"""
Binary Option Trading System - Master Test Runner
=================================================
Runs all tests and generates comprehensive report
"""

import subprocess
import time
import sys
import os
from datetime import datetime
from typing import Dict, List, Tuple

# ============================================
# COLORS
# ============================================
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    MAGENTA = '\033[95m'
    BOLD = '\033[1m'
    END = '\033[0m'

# ============================================
# TEST CONFIGURATION
# ============================================
TESTS = [
    {
        "name": "Backend API Tests",
        "file": "test_backend.py",
        "description": "Comprehensive endpoint testing",
        "estimated_time": "30 seconds",
        "critical": True
    },
    {
        "name": "Simulator Tests",
        "file": "test_simulator.py",
        "description": "Price simulator validation",
        "estimated_time": "15 seconds",
        "critical": True
    },
    {
        "name": "Performance Tests",
        "file": "test_performance.py",
        "description": "Load and performance testing",
        "estimated_time": "5 minutes",
        "critical": False
    },
    {
        "name": "Integration Test",
        "file": "test_integration.py",
        "description": "End-to-end workflow testing",
        "estimated_time": "2 minutes",
        "critical": True
    }
]

# ============================================
# UTILS
# ============================================
def print_banner():
    """Print test suite banner"""
    print(f"\n{Colors.BOLD}{Colors.CYAN}")
    print("╔═══════════════════════════════════════════════════════════════════╗")
    print("║                                                                   ║")
    print("║         🧪 BINARY OPTION TRADING SYSTEM 🧪                        ║")
    print("║              COMPREHENSIVE TEST SUITE                             ║")
    print("║                                                                   ║")
    print("╚═══════════════════════════════════════════════════════════════════╝")
    print(f"{Colors.END}\n")

def print_section(title: str):
    """Print section header"""
    print(f"\n{Colors.BOLD}{Colors.MAGENTA}")
    print(f"{'='*70}")
    print(f"{title.center(70)}")
    print(f"{'='*70}")
    print(f"{Colors.END}\n")

def print_test_header(test: Dict):
    """Print individual test header"""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'─'*70}{Colors.END}")
    print(f"{Colors.BOLD}{test['name']}{Colors.END}")
    print(f"{Colors.CYAN}{test['description']}{Colors.END}")
    print(f"📁 File: {test['file']}")
    print(f"⏱️  Estimated: {test['estimated_time']}")
    
    if test['critical']:
        print(f"{Colors.RED}⚠️  CRITICAL TEST{Colors.END}")
    
    print(f"{Colors.BLUE}{'─'*70}{Colors.END}\n")

def run_test(test_file: str) -> Tuple[bool, float, str]:
    """Run a test file and capture results"""
    
    if not os.path.exists(test_file):
        return False, 0, f"Test file not found: {test_file}"
    
    start_time = time.time()
    
    try:
        # Run the test
        result = subprocess.run(
            ['python3', test_file],
            capture_output=True,
            text=True,
            timeout=600  # 10 minute timeout
        )
        
        elapsed = time.time() - start_time
        
        # Get output
        output = result.stdout + result.stderr
        
        # Check if test passed
        success = result.returncode == 0
        
        return success, elapsed, output
        
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start_time
        return False, elapsed, "Test timed out (>10 minutes)"
    
    except Exception as e:
        elapsed = time.time() - start_time
        return False, elapsed, f"Error running test: {str(e)}"

def format_duration(seconds: float) -> str:
    """Format duration in human readable format"""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes}m {secs}s"
    else:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        return f"{hours}h {minutes}m"

def print_test_result(test_name: str, success: bool, duration: float):
    """Print test result summary"""
    status = f"{Colors.GREEN}✅ PASSED" if success else f"{Colors.RED}❌ FAILED"
    print(f"{status}{Colors.END} - {test_name} ({format_duration(duration)})")

def generate_report(results: List[Dict]):
    """Generate comprehensive test report"""
    print_section("📊 TEST SUITE REPORT")
    
    # Calculate summary
    total_tests = len(results)
    passed_tests = sum(1 for r in results if r['success'])
    failed_tests = total_tests - passed_tests
    total_duration = sum(r['duration'] for r in results)
    
    # Overall status
    all_passed = failed_tests == 0
    
    print(f"{Colors.BOLD}OVERALL STATUS:{Colors.END}")
    if all_passed:
        print(f"{Colors.GREEN}{Colors.BOLD}✅ ALL TESTS PASSED! 🎉{Colors.END}")
    else:
        print(f"{Colors.RED}{Colors.BOLD}❌ SOME TESTS FAILED{Colors.END}")
    
    print(f"\n{Colors.BOLD}SUMMARY:{Colors.END}")
    print(f"  Total Tests:    {total_tests}")
    print(f"  {Colors.GREEN}✅ Passed:{Colors.END}       {passed_tests}")
    print(f"  {Colors.RED}❌ Failed:{Colors.END}       {failed_tests}")
    print(f"  Success Rate:   {(passed_tests/total_tests*100):.1f}%")
    print(f"  Total Duration: {format_duration(total_duration)}")
    
    # Individual test results
    print(f"\n{Colors.BOLD}DETAILED RESULTS:{Colors.END}")
    print(f"{'─'*70}")
    
    for i, result in enumerate(results, 1):
        status_icon = "✅" if result['success'] else "❌"
        critical_mark = " ⚠️ " if result.get('critical', False) else ""
        
        print(f"{i}. {status_icon}{critical_mark} {result['name']}")
        print(f"   Duration: {format_duration(result['duration'])}")
        print(f"   Status: {'PASSED' if result['success'] else 'FAILED'}")
        
        if not result['success']:
            print(f"   {Colors.RED}Error: Check detailed output above{Colors.END}")
        
        print()
    
    # Critical tests status
    critical_results = [r for r in results if r.get('critical', False)]
    if critical_results:
        critical_failed = sum(1 for r in critical_results if not r['success'])
        
        print(f"{Colors.BOLD}CRITICAL TESTS:{Colors.END}")
        if critical_failed == 0:
            print(f"{Colors.GREEN}✅ All critical tests passed{Colors.END}")
        else:
            print(f"{Colors.RED}❌ {critical_failed} critical test(s) failed{Colors.END}")
        print()
    
    # Recommendations
    print(f"{Colors.BOLD}RECOMMENDATIONS:{Colors.END}")
    
    if all_passed:
        print(f"  {Colors.GREEN}✓{Colors.END} System is production ready!")
        print(f"  {Colors.GREEN}✓{Colors.END} All tests passed successfully")
        print(f"  {Colors.GREEN}✓{Colors.END} Performance meets targets")
    else:
        print(f"  {Colors.YELLOW}!{Colors.END} Review failed tests above")
        print(f"  {Colors.YELLOW}!{Colors.END} Check backend and simulator logs")
        print(f"  {Colors.YELLOW}!{Colors.END} Verify environment configuration")
        
        if any(not r['success'] and r.get('critical', False) for r in results):
            print(f"  {Colors.RED}!{Colors.END} CRITICAL: System has critical failures")
    
    print()
    
    # Timestamp
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"Report generated: {timestamp}")
    print()

def check_prerequisites():
    """Check if prerequisites are met"""
    print_section("🔍 CHECKING PREREQUISITES")
    
    issues = []
    
    # Check Python version
    py_version = sys.version_info
    if py_version.major < 3 or (py_version.major == 3 and py_version.minor < 7):
        issues.append("Python 3.7+ required")
    else:
        print(f"{Colors.GREEN}✓{Colors.END} Python version: {py_version.major}.{py_version.minor}")
    
    # Check if test files exist
    for test in TESTS:
        if os.path.exists(test['file']):
            print(f"{Colors.GREEN}✓{Colors.END} Found: {test['file']}")
        else:
            issues.append(f"Missing test file: {test['file']}")
            print(f"{Colors.RED}✗{Colors.END} Missing: {test['file']}")
    
    # Check if backend is running
    try:
        import requests
        response = requests.get("http://localhost:3000/api/v1/health", timeout=5)
        if response.status_code == 200:
            print(f"{Colors.GREEN}✓{Colors.END} Backend is running")
        else:
            issues.append("Backend not responding correctly")
            print(f"{Colors.YELLOW}⚠{Colors.END} Backend status: {response.status_code}")
    except:
        issues.append("Backend not running (http://localhost:3000)")
        print(f"{Colors.RED}✗{Colors.END} Backend not accessible")
    
    # Check if simulator is running (non-critical)
    try:
        import requests
        url = "https://stc-autotrade-18f67-default-rtdb.asia-southeast1.firebasedatabase.app/idx_stc/current_price.json"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data:
                print(f"{Colors.GREEN}✓{Colors.END} Simulator is running")
            else:
                print(f"{Colors.YELLOW}⚠{Colors.END} Simulator: No data (will affect some tests)")
        else:
            print(f"{Colors.YELLOW}⚠{Colors.END} Simulator: Not responding (will affect some tests)")
    except:
        print(f"{Colors.YELLOW}⚠{Colors.END} Simulator: Not accessible (will affect some tests)")
    
    print()
    
    if issues:
        print(f"{Colors.RED}{Colors.BOLD}CRITICAL ISSUES FOUND:{Colors.END}")
        for issue in issues:
            print(f"  {Colors.RED}✗{Colors.END} {issue}")
        print()
        print(f"{Colors.YELLOW}Please fix these issues before running tests{Colors.END}")
        return False
    
    print(f"{Colors.GREEN}{Colors.BOLD}✅ All prerequisites met!{Colors.END}\n")
    return True

def confirm_run():
    """Ask user to confirm test run"""
    print(f"{Colors.BOLD}Test Suite Overview:{Colors.END}")
    print()
    
    total_time = 0
    for test in TESTS:
        critical_mark = f"{Colors.RED}[CRITICAL]{Colors.END}" if test['critical'] else ""
        print(f"  • {test['name']} {critical_mark}")
        print(f"    {test['description']}")
        print(f"    Estimated: {test['estimated_time']}")
        print()
    
    print(f"{Colors.YELLOW}Note: Integration test will create real orders{Colors.END}")
    print()
    
    try:
        response = input(f"{Colors.BOLD}Proceed with tests? (y/n): {Colors.END}").lower()
        return response in ['y', 'yes']
    except KeyboardInterrupt:
        print("\n\nCancelled by user")
        return False

# ============================================
# MAIN TEST RUNNER
# ============================================
def main():
    """Main test execution"""
    print_banner()
    
    # Check prerequisites
    if not check_prerequisites():
        print(f"{Colors.RED}Prerequisites not met. Exiting.{Colors.END}")
        sys.exit(1)
    
    # Confirm run
    if not confirm_run():
        print(f"\n{Colors.YELLOW}Tests cancelled by user{Colors.END}")
        sys.exit(0)
    
    print_section("🚀 STARTING TEST SUITE")
    
    start_time = time.time()
    results = []
    
    # Run each test
    for test in TESTS:
        print_test_header(test)
        
        success, duration, output = run_test(test['file'])
        
        results.append({
            'name': test['name'],
            'success': success,
            'duration': duration,
            'critical': test.get('critical', False)
        })
        
        # Show output
        print(output)
        
        print_test_result(test['name'], success, duration)
        
        # If critical test fails, ask if should continue
        if not success and test.get('critical', False):
            print(f"\n{Colors.RED}{Colors.BOLD}⚠️  CRITICAL TEST FAILED!{Colors.END}")
            try:
                response = input(f"{Colors.YELLOW}Continue with remaining tests? (y/n): {Colors.END}").lower()
                if response not in ['y', 'yes']:
                    print(f"\n{Colors.YELLOW}Test suite stopped by user{Colors.END}")
                    break
            except KeyboardInterrupt:
                print("\n\nTest suite interrupted")
                break
        
        # Small delay between tests
        time.sleep(1)
    
    total_duration = time.time() - start_time
    
    # Generate report
    generate_report(results)
    
    # Save report to file
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_file = f"test_report_{timestamp}.txt"
        
        with open(report_file, 'w') as f:
            f.write("BINARY OPTION TRADING SYSTEM - TEST REPORT\n")
            f.write("=" * 70 + "\n\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Duration: {format_duration(total_duration)}\n\n")
            
            f.write("RESULTS:\n")
            for result in results:
                status = "PASSED" if result['success'] else "FAILED"
                f.write(f"  {result['name']}: {status} ({format_duration(result['duration'])})\n")
            
            f.write(f"\nTotal: {len(results)} tests\n")
            f.write(f"Passed: {sum(1 for r in results if r['success'])}\n")
            f.write(f"Failed: {sum(1 for r in results if not r['success'])}\n")
        
        print(f"📄 Report saved: {report_file}")
        print()
        
    except Exception as e:
        print(f"{Colors.YELLOW}Warning: Could not save report file: {str(e)}{Colors.END}")
    
    # Exit with appropriate code
    all_passed = all(r['success'] for r in results)
    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Test suite interrupted by user{Colors.END}")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        import traceback
        traceback.print_exc()
        sys.exit(1)