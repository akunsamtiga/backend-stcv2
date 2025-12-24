#!/usr/bin/env python3
"""
Binary Option Trading System - Complete Test Suite Runner
=========================================================
Runs all test suites and provides comprehensive reporting
"""

import subprocess
import sys
import time
import os
from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime
import argparse

# ============================================
# CONFIGURATION
# ============================================
TEST_FILES = {
    "simulator": {
        "file": "test_simulator.py",
        "name": "🔬 Simulator Tests",
        "description": "Tests price simulator functionality",
        "critical": True
    },
    "backend": {
        "file": "test_backend.py",
        "name": "🧪 Backend API Tests",
        "description": "Tests all backend endpoints",
        "critical": True
    },
    "performance": {
        "file": "test_performance.py",
        "name": "⚡ Performance Tests",
        "description": "Tests system under load",
        "critical": False
    },
    "integration": {
        "file": "test_integration.py",
        "name": "🔄 Integration Tests",
        "description": "Tests end-to-end workflow",
        "critical": True
    }
}

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
    UNDERLINE = '\033[4m'
    END = '\033[0m'

# ============================================
# DATA CLASSES
# ============================================
@dataclass
class TestSuiteResult:
    name: str
    file: str
    passed: bool
    exit_code: int
    duration: float
    output: str
    critical: bool

# ============================================
# UTILS
# ============================================
def print_header(text: str, char: str = "="):
    """Print styled header"""
    width = 70
    print(f"\n{Colors.BOLD}{Colors.CYAN}{char * width}")
    print(f"{text.center(width)}")
    print(f"{char * width}{Colors.END}\n")

def print_banner():
    """Print application banner"""
    banner = f"""
{Colors.BOLD}{Colors.CYAN}╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║           BINARY OPTION TRADING SYSTEM - TEST SUITE RUNNER           ║
║                                                                      ║
║                    Complete Testing Framework                        ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝{Colors.END}
"""
    print(banner)

def print_test_suite_info():
    """Print information about test suites"""
    print(f"{Colors.BOLD}Available Test Suites:{Colors.END}\n")
    
    for key, info in TEST_FILES.items():
        critical_badge = f"{Colors.RED}[CRITICAL]{Colors.END}" if info['critical'] else f"{Colors.YELLOW}[OPTIONAL]{Colors.END}"
        print(f"  {critical_badge} {info['name']}")
        print(f"      📄 {info['file']}")
        print(f"      📝 {info['description']}")
        print()

def check_file_exists(filepath: str) -> bool:
    """Check if test file exists"""
    return os.path.isfile(filepath)

def run_test_suite(test_key: str, test_info: Dict) -> TestSuiteResult:
    """Run a single test suite"""
    filename = test_info['file']
    
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'─' * 70}{Colors.END}")
    print(f"{Colors.BOLD}{test_info['name']}{Colors.END}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'─' * 70}{Colors.END}\n")
    
    # Check if file exists
    if not check_file_exists(filename):
        print(f"{Colors.RED}✗ Test file not found: {filename}{Colors.END}")
        return TestSuiteResult(
            name=test_info['name'],
            file=filename,
            passed=False,
            exit_code=-1,
            duration=0,
            output=f"File not found: {filename}",
            critical=test_info['critical']
        )
    
    # Make file executable
    try:
        os.chmod(filename, 0o755)
    except:
        pass
    
    # Run the test
    start_time = time.time()
    
    try:
        result = subprocess.run(
            [sys.executable, filename],
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        duration = time.time() - start_time
        
        # Print output in real-time style
        if result.stdout:
            print(result.stdout)
        
        if result.stderr and result.returncode != 0:
            print(f"{Colors.RED}Errors:{Colors.END}")
            print(result.stderr)
        
        passed = result.returncode == 0
        
        # Print result
        if passed:
            print(f"\n{Colors.GREEN}{Colors.BOLD}✅ {test_info['name']} PASSED{Colors.END}")
        else:
            print(f"\n{Colors.RED}{Colors.BOLD}❌ {test_info['name']} FAILED{Colors.END}")
        
        print(f"{Colors.CYAN}Duration: {duration:.2f}s{Colors.END}")
        
        return TestSuiteResult(
            name=test_info['name'],
            file=filename,
            passed=passed,
            exit_code=result.returncode,
            duration=duration,
            output=result.stdout + result.stderr,
            critical=test_info['critical']
        )
        
    except subprocess.TimeoutExpired:
        duration = time.time() - start_time
        print(f"\n{Colors.RED}{Colors.BOLD}⏱️  TEST TIMEOUT (exceeded 5 minutes){Colors.END}")
        
        return TestSuiteResult(
            name=test_info['name'],
            file=filename,
            passed=False,
            exit_code=-1,
            duration=duration,
            output="Test exceeded timeout limit",
            critical=test_info['critical']
        )
        
    except Exception as e:
        duration = time.time() - start_time
        print(f"\n{Colors.RED}{Colors.BOLD}❌ TEST ERROR: {str(e)}{Colors.END}")
        
        return TestSuiteResult(
            name=test_info['name'],
            file=filename,
            passed=False,
            exit_code=-1,
            duration=duration,
            output=str(e),
            critical=test_info['critical']
        )

def print_summary(results: List[TestSuiteResult], total_duration: float):
    """Print comprehensive test summary"""
    print_header("📊 COMPREHENSIVE TEST SUMMARY")
    
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)
    
    critical_total = sum(1 for r in results if r.critical)
    critical_passed = sum(1 for r in results if r.critical and r.passed)
    critical_failed = sum(1 for r in results if r.critical and not r.passed)
    
    # Overall Status
    print(f"{Colors.BOLD}Overall Test Results:{Colors.END}\n")
    print(f"  Total Test Suites:     {total}")
    print(f"  {Colors.GREEN}✓ Passed:{Colors.END}              {passed}")
    print(f"  {Colors.RED}✗ Failed:{Colors.END}              {failed}")
    print(f"  Success Rate:          {(passed/total*100):.1f}%")
    print(f"  Total Duration:        {total_duration:.2f}s")
    
    # Critical Tests
    print(f"\n{Colors.BOLD}Critical Tests Status:{Colors.END}\n")
    print(f"  Critical Tests:        {critical_total}")
    print(f"  {Colors.GREEN}✓ Passed:{Colors.END}              {critical_passed}")
    print(f"  {Colors.RED}✗ Failed:{Colors.END}              {critical_failed}")
    
    # Individual Results
    print(f"\n{Colors.BOLD}Individual Test Suite Results:{Colors.END}\n")
    
    for result in results:
        status = f"{Colors.GREEN}✅ PASS" if result.passed else f"{Colors.RED}❌ FAIL"
        critical = f"{Colors.RED}[CRITICAL]" if result.critical else f"{Colors.YELLOW}[OPTIONAL]"
        
        print(f"  {status}{Colors.END} | {critical}{Colors.END} | {result.name}")
        print(f"        📄 {result.file}")
        print(f"        ⏱️  Duration: {result.duration:.2f}s")
        print(f"        🔢 Exit Code: {result.exit_code}")
        print()
    
    # Performance Summary
    print(f"{Colors.BOLD}Performance Summary:{Colors.END}\n")
    
    fastest = min(results, key=lambda r: r.duration)
    slowest = max(results, key=lambda r: r.duration)
    avg_duration = sum(r.duration for r in results) / len(results)
    
    print(f"  ⚡ Fastest Suite:       {fastest.name} ({fastest.duration:.2f}s)")
    print(f"  🐢 Slowest Suite:       {slowest.name} ({slowest.duration:.2f}s)")
    print(f"  📊 Average Duration:    {avg_duration:.2f}s")
    
    # Final Verdict
    print(f"\n{Colors.BOLD}{'═' * 70}{Colors.END}")
    
    if failed == 0:
        print(f"{Colors.GREEN}{Colors.BOLD}")
        print(f"  ✅ ALL TESTS PASSED! SYSTEM IS READY FOR PRODUCTION! ✅")
        print(f"{Colors.END}")
    elif critical_failed == 0 and failed > 0:
        print(f"{Colors.YELLOW}{Colors.BOLD}")
        print(f"  ⚠️  ALL CRITICAL TESTS PASSED, BUT SOME OPTIONAL TESTS FAILED")
        print(f"  System is functional but needs attention")
        print(f"{Colors.END}")
    else:
        print(f"{Colors.RED}{Colors.BOLD}")
        print(f"  ❌ CRITICAL TESTS FAILED - SYSTEM NOT READY")
        print(f"  Please fix critical issues before deployment")
        print(f"{Colors.END}")
    
    print(f"{Colors.BOLD}{'═' * 70}{Colors.END}\n")
    
    # Recommendations
    if failed > 0:
        print(f"{Colors.BOLD}Recommendations:{Colors.END}\n")
        
        for result in results:
            if not result.passed:
                print(f"  ❌ {result.name}:")
                print(f"     • Review test output above")
                print(f"     • Check {result.file} for details")
                if result.critical:
                    print(f"     • {Colors.RED}CRITICAL: Must be fixed before production{Colors.END}")
                print()

def run_selected_tests(test_keys: List[str]) -> List[TestSuiteResult]:
    """Run selected test suites"""
    results = []
    
    for key in test_keys:
        if key in TEST_FILES:
            result = run_test_suite(key, TEST_FILES[key])
            results.append(result)
            
            # Small delay between tests
            time.sleep(1)
        else:
            print(f"{Colors.RED}Unknown test suite: {key}{Colors.END}")
    
    return results

def run_all_tests() -> List[TestSuiteResult]:
    """Run all test suites"""
    results = []
    
    for key, info in TEST_FILES.items():
        result = run_test_suite(key, info)
        results.append(result)
        
        # Small delay between tests
        time.sleep(1)
    
    return results

# ============================================
# MAIN
# ============================================
def main():
    """Main test runner"""
    parser = argparse.ArgumentParser(
        description='Binary Option Trading System - Complete Test Suite Runner',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        '--tests',
        nargs='+',
        choices=['simulator', 'backend', 'performance', 'integration', 'all'],
        default=['all'],
        help='Specify which tests to run (default: all)'
    )
    
    parser.add_argument(
        '--critical-only',
        action='store_true',
        help='Run only critical tests'
    )
    
    parser.add_argument(
        '--quick',
        action='store_true',
        help='Skip performance tests for faster execution'
    )
    
    parser.add_argument(
        '--list',
        action='store_true',
        help='List all available test suites'
    )
    
    args = parser.parse_args()
    
    # Print banner
    print_banner()
    
    # List tests if requested
    if args.list:
        print_test_suite_info()
        sys.exit(0)
    
    # Determine which tests to run
    if args.critical_only:
        test_keys = [k for k, v in TEST_FILES.items() if v['critical']]
        print(f"{Colors.YELLOW}Running CRITICAL tests only{Colors.END}\n")
    elif args.quick:
        test_keys = [k for k in TEST_FILES.keys() if k != 'performance']
        print(f"{Colors.YELLOW}Running quick test suite (skipping performance){Colors.END}\n")
    elif 'all' in args.tests:
        test_keys = list(TEST_FILES.keys())
        print(f"{Colors.CYAN}Running ALL test suites{Colors.END}\n")
    else:
        test_keys = args.tests
        print(f"{Colors.CYAN}Running selected test suites: {', '.join(test_keys)}{Colors.END}\n")
    
    # Show what will be tested
    print(f"{Colors.BOLD}Test Suites to Execute:{Colors.END}")
    for key in test_keys:
        info = TEST_FILES[key]
        critical = "🔴 CRITICAL" if info['critical'] else "🟡 OPTIONAL"
        print(f"  • {critical} - {info['name']}")
    
    print(f"\n{Colors.YELLOW}⏳ Starting test execution...{Colors.END}")
    time.sleep(2)
    
    # Run tests
    start_time = time.time()
    
    try:
        results = run_selected_tests(test_keys)
        total_duration = time.time() - start_time
        
        # Print summary
        print_summary(results, total_duration)
        
        # Exit with appropriate code
        failed_critical = sum(1 for r in results if r.critical and not r.passed)
        
        if failed_critical > 0:
            sys.exit(1)  # Critical failure
        elif any(not r.passed for r in results):
            sys.exit(2)  # Non-critical failure
        else:
            sys.exit(0)  # All passed
            
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}⚠️  Tests interrupted by user{Colors.END}")
        sys.exit(130)
        
    except Exception as e:
        print(f"\n\n{Colors.RED}❌ Fatal error: {str(e)}{Colors.END}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()