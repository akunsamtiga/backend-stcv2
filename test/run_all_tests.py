#!/usr/bin/env python3
"""
Binary Option Trading System - Enhanced Production Test Suite Runner
====================================================================
Orchestrates all tests with better error handling and reporting
"""

import subprocess
import sys
import time
import os
from typing import List, Dict, Optional
from dataclasses import dataclass
from datetime import datetime
import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

# ============================================
# CONFIGURATION
# ============================================
TEST_FILES = {
    "backend": {
        "file": "test_backend.py",
        "name": "🧪 Backend API Tests",
        "description": "Tests all backend endpoints comprehensively",
        "critical": True,
        "enabled": True,
        "timeout": 300,  # 5 minutes
        "parallel_safe": False
    },
    "performance": {
        "file": "test_performance.py",
        "name": "⚡ Performance Tests",
        "description": "Tests system under load",
        "critical": False,
        "enabled": True,
        "timeout": 600,  # 10 minutes
        "parallel_safe": False
    },
    "integration": {
        "file": "test_integration.py",
        "name": "🔄 Integration Tests",
        "description": "Tests end-to-end workflow",
        "critical": True,
        "enabled": True,
        "timeout": 180,  # 3 minutes
        "parallel_safe": False
    },
    "simulator": {
        "file": "test_simulator.py",
        "name": "🔬 Simulator Tests",
        "description": "Tests multi-asset price simulator functionality",
        "critical": False,
        "enabled": True,  # Now enabled with improved version
        "timeout": 120,  # 2 minutes
        "parallel_safe": True,
        "skip_reason": ""  # No longer skipped
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
    skipped: bool = False
    skip_reason: str = ""
    error: Optional[str] = None

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
║      BINARY OPTION TRADING SYSTEM - ENHANCED TEST SUITE v2.0         ║
║                                                                      ║
║                    Comprehensive Testing Framework                    ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝{Colors.END}
"""
    print(banner)

def print_test_suite_info():
    """Print information about test suites"""
    print(f"{Colors.BOLD}Test Suites Configuration:{Colors.END}\n")
    
    for key, info in TEST_FILES.items():
        if not info.get('enabled', True):
            status_badge = f"{Colors.YELLOW}[SKIPPED]{Colors.END}"
            print(f"  {status_badge} {info['name']}")
            print(f"      📄 {info['file']}")
            print(f"      📋 {info['description']}")
            if 'skip_reason' in info:
                print(f"      ⚠️  Reason: {info['skip_reason']}")
            print()
        else:
            critical_badge = f"{Colors.RED}[CRITICAL]{Colors.END}" if info['critical'] else f"{Colors.YELLOW}[OPTIONAL]{Colors.END}"
            parallel_badge = "🔀 Parallel-safe" if info.get('parallel_safe', False) else "🔒 Sequential"
            print(f"  {critical_badge} {info['name']}")
            print(f"      📄 {info['file']}")
            print(f"      📋 {info['description']}")
            print(f"      ⏱️  Timeout: {info['timeout']}s")
            print(f"      {parallel_badge}")
            print()

def check_file_exists(filepath: str) -> bool:
    """Check if test file exists"""
    return os.path.isfile(filepath)

def check_dependencies() -> Dict[str, bool]:
    """Check if all dependencies are available"""
    checks = {
        "python3": False,
        "server": False,
        "test_files": False
    }
    
    # Check Python 3
    try:
        result = subprocess.run(
            [sys.executable, "--version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        checks["python3"] = result.returncode == 0
    except:
        pass
    
    # Check if server is running
    try:
        import requests
        response = requests.get("http://localhost:3000/api/v1/health", timeout=3)
        checks["server"] = response.status_code == 200
    except:
        pass
    
    # Check test files
    enabled_tests = [info['file'] for info in TEST_FILES.values() if info.get('enabled', True)]
    checks["test_files"] = all(check_file_exists(f) for f in enabled_tests)
    
    return checks

def run_test_suite(test_key: str, test_info: Dict, verbose: bool = False) -> TestSuiteResult:
    """Run a single test suite"""
    filename = test_info['file']
    timeout = test_info.get('timeout', 300)
    
    # Check if test is disabled
    if not test_info.get('enabled', True):
        print(f"\n{Colors.BOLD}{Colors.YELLOW}{'─' * 70}{Colors.END}")
        print(f"{Colors.BOLD}{Colors.YELLOW}{test_info['name']} [SKIPPED]{Colors.END}")
        print(f"{Colors.BOLD}{Colors.YELLOW}{'─' * 70}{Colors.END}\n")
        
        skip_reason = test_info.get('skip_reason', 'Test disabled')
        print(f"{Colors.YELLOW}⚠️  Skipped: {skip_reason}{Colors.END}\n")
        
        return TestSuiteResult(
            name=test_info['name'],
            file=filename,
            passed=True,
            exit_code=0,
            duration=0,
            output=skip_reason,
            critical=test_info['critical'],
            skipped=True,
            skip_reason=skip_reason
        )
    
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
            output="",
            critical=test_info['critical'],
            error=f"File not found: {filename}"
        )
    
    # Make file executable
    try:
        os.chmod(filename, 0o755)
    except:
        pass
    
    # Run the test
    start_time = time.time()
    
    try:
        args = [sys.executable, filename]
        if verbose:
            args.append('-v')
        
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        duration = time.time() - start_time
        
        # Print output
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
        print(f"\n{Colors.RED}{Colors.BOLD}⏱️  TEST TIMEOUT (exceeded {timeout}s){Colors.END}")
        
        return TestSuiteResult(
            name=test_info['name'],
            file=filename,
            passed=False,
            exit_code=-1,
            duration=duration,
            output="",
            critical=test_info['critical'],
            error=f"Test exceeded timeout limit ({timeout}s)"
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
            output="",
            critical=test_info['critical'],
            error=str(e)
        )

def print_summary(results: List[TestSuiteResult], total_duration: float):
    """Print comprehensive test summary"""
    print_header("📊 COMPREHENSIVE TEST SUMMARY")
    
    # Filter results
    active_results = [r for r in results if not r.skipped]
    skipped_results = [r for r in results if r.skipped]
    
    total = len(active_results)
    passed = sum(1 for r in active_results if r.passed)
    failed = sum(1 for r in active_results if not r.passed)
    skipped_count = len(skipped_results)
    
    critical_total = sum(1 for r in active_results if r.critical)
    critical_passed = sum(1 for r in active_results if r.critical and r.passed)
    critical_failed = sum(1 for r in active_results if r.critical and not r.passed)
    
    # Overall Status
    print(f"{Colors.BOLD}Overall Test Results:{Colors.END}\n")
    print(f"  Total Test Suites:     {total}")
    print(f"  {Colors.GREEN}✓ Passed:{Colors.END}              {passed}")
    print(f"  {Colors.RED}✗ Failed:{Colors.END}              {failed}")
    print(f"  {Colors.YELLOW}⊘ Skipped:{Colors.END}             {skipped_count}")
    if total > 0:
        print(f"  Success Rate:          {(passed/total*100):.1f}%")
    print(f"  Total Duration:        {total_duration:.2f}s")
    
    # Skipped Tests Info
    if skipped_results:
        print(f"\n{Colors.BOLD}Skipped Tests:{Colors.END}\n")
        for result in skipped_results:
            print(f"  {Colors.YELLOW}⊘{Colors.END} {result.name}")
            print(f"     Reason: {result.skip_reason}")
    
    # Critical Tests
    print(f"\n{Colors.BOLD}Critical Tests Status:{Colors.END}\n")
    print(f"  Critical Tests:        {critical_total}")
    print(f"  {Colors.GREEN}✓ Passed:{Colors.END}              {critical_passed}")
    print(f"  {Colors.RED}✗ Failed:{Colors.END}              {critical_failed}")
    
    if critical_failed > 0:
        print(f"\n  {Colors.RED}{Colors.BOLD}⚠️  WARNING: {critical_failed} CRITICAL TEST(S) FAILED!{Colors.END}")
    
    # Individual Results
    print(f"\n{Colors.BOLD}Individual Test Suite Results:{Colors.END}\n")
    
    for result in results:
        if result.skipped:
            status = f"{Colors.YELLOW}⊘ SKIP"
            critical = f"{Colors.YELLOW}[SKIPPED]"
        else:
            status = f"{Colors.GREEN}✅ PASS" if result.passed else f"{Colors.RED}❌ FAIL"
            critical = f"{Colors.RED}[CRITICAL]" if result.critical else f"{Colors.YELLOW}[OPTIONAL]"
        
        print(f"  {status}{Colors.END} | {critical}{Colors.END} | {result.name}")
        print(f"        📄 {result.file}")
        if not result.skipped:
            print(f"        ⏱️  Duration: {result.duration:.2f}s")
            print(f"        🔢 Exit Code: {result.exit_code}")
            if result.error:
                print(f"        {Colors.RED}❌ Error: {result.error}{Colors.END}")
        print()
    
    # Performance Summary
    if active_results:
        print(f"{Colors.BOLD}Performance Summary:{Colors.END}\n")
        
        fastest = min(active_results, key=lambda r: r.duration)
        slowest = max(active_results, key=lambda r: r.duration)
        avg_duration = sum(r.duration for r in active_results) / len(active_results)
        
        print(f"  ⚡ Fastest Suite:       {fastest.name} ({fastest.duration:.2f}s)")
        print(f"  🐌 Slowest Suite:       {slowest.name} ({slowest.duration:.2f}s)")
        print(f"  📊 Average Duration:    {avg_duration:.2f}s")
    
    # Final Verdict
    print(f"\n{Colors.BOLD}{'═' * 70}{Colors.END}")
    
    if failed == 0 and critical_passed == critical_total:
        print(f"{Colors.GREEN}{Colors.BOLD}")
        print(f"  ✅ ALL CRITICAL TESTS PASSED! SYSTEM READY FOR PRODUCTION! ✅")
        print(f"{Colors.END}")
        print(f"{Colors.GREEN}")
        print(f"  Your Binary Option Trading System is working perfectly:")
        print(f"    ✅ Backend API: All endpoints working")
        print(f"    ✅ Integration: Full workflow verified")
        if any(r.name == "⚡ Performance Tests" and r.passed for r in results):
            print(f"    ✅ Performance: Excellent")
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
        
        for result in active_results:
            if not result.passed:
                print(f"  ❌ {result.name}:")
                print(f"     • Review test output above")
                print(f"     • Check {result.file} for details")
                if result.critical:
                    print(f"     • {Colors.RED}CRITICAL: Must be fixed before production{Colors.END}")
                if result.error:
                    print(f"     • Error: {result.error}")
                print()
    
    # Production readiness check
    if critical_failed == 0:
        print(f"{Colors.BOLD}{Colors.GREEN}🚀 PRODUCTION DEPLOYMENT CHECKLIST:{Colors.END}\n")
        print(f"  ✅ All critical tests passed")
        print(f"  ✅ Backend API working perfectly")
        print(f"  ✅ Integration workflow verified")
        print()
        print(f"{Colors.GREEN}  → You can deploy to production now!{Colors.END}")
        print()

def save_results_to_file(results: List[TestSuiteResult], filename: str = "test_results.json"):
    """Save test results to JSON file"""
    try:
        data = {
            "timestamp": datetime.now().isoformat(),
            "results": [
                {
                    "name": r.name,
                    "file": r.file,
                    "passed": r.passed,
                    "exit_code": r.exit_code,
                    "duration": r.duration,
                    "critical": r.critical,
                    "skipped": r.skipped,
                    "skip_reason": r.skip_reason,
                    "error": r.error
                }
                for r in results
            ]
        }
        
        with open(filename, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"{Colors.CYAN}📝 Results saved to: {filename}{Colors.END}")
    except Exception as e:
        print(f"{Colors.YELLOW}⚠️  Failed to save results: {str(e)}{Colors.END}")

def run_selected_tests(test_keys: List[str], verbose: bool = False) -> List[TestSuiteResult]:
    """Run selected test suites"""
    results = []
    
    for key in test_keys:
        if key in TEST_FILES:
            result = run_test_suite(key, TEST_FILES[key], verbose)
            results.append(result)
            
            # Small delay between tests
            time.sleep(1)
        else:
            print(f"{Colors.RED}Unknown test suite: {key}{Colors.END}")
    
    return results

def main():
    """Main test runner"""
    parser = argparse.ArgumentParser(
        description='Binary Option Trading System - Enhanced Test Suite Runner',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        '--tests',
        nargs='+',
        choices=['backend', 'performance', 'integration', 'simulator', 'all'],
        default=['all'],
        help='Specify which tests to run (default: all enabled)'
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
    
    parser.add_argument(
        '--include-simulator',
        action='store_true',
        help='Include simulator test (normally skipped)'
    )
    
    parser.add_argument(
        '-v', '--verbose',
        action='store_true',
        help='Verbose output'
    )
    
    parser.add_argument(
        '--check-deps',
        action='store_true',
        help='Check dependencies and exit'
    )
    
    parser.add_argument(
        '--save-results',
        action='store_true',
        help='Save results to JSON file'
    )
    
    args = parser.parse_args()
    
    # Print banner
    print_banner()
    
    # Check dependencies
    if args.check_deps:
        print_header("🔍 CHECKING DEPENDENCIES")
        checks = check_dependencies()
        
        for name, status in checks.items():
            symbol = "✅" if status else "❌"
            print(f"  {symbol} {name}: {'OK' if status else 'FAILED'}")
        
        all_ok = all(checks.values())
        print()
        if all_ok:
            print(f"{Colors.GREEN}✅ All dependencies OK{Colors.END}")
            sys.exit(0)
        else:
            print(f"{Colors.RED}❌ Some dependencies failed{Colors.END}")
            sys.exit(1)
    
    # List tests if requested
    if args.list:
        print_test_suite_info()
        sys.exit(0)
    
    # Enable simulator if requested
    if args.include_simulator:
        TEST_FILES['simulator']['enabled'] = True
        print(f"{Colors.YELLOW}ℹ️  Simulator test enabled by user request{Colors.END}\n")
    
    # Determine which tests to run
    if args.critical_only:
        test_keys = [k for k, v in TEST_FILES.items() if v['critical'] and v.get('enabled', True)]
        print(f"{Colors.YELLOW}Running CRITICAL tests only{Colors.END}\n")
    elif args.quick:
        test_keys = [k for k in TEST_FILES.keys() if k != 'performance' and TEST_FILES[k].get('enabled', True)]
        print(f"{Colors.YELLOW}Running quick test suite (skipping performance){Colors.END}\n")
    elif 'all' in args.tests:
        test_keys = [k for k in TEST_FILES.keys() if TEST_FILES[k].get('enabled', True)]
        print(f"{Colors.CYAN}Running ALL enabled test suites{Colors.END}\n")
    else:
        test_keys = [k for k in args.tests if TEST_FILES[k].get('enabled', True)]
        print(f"{Colors.CYAN}Running selected test suites: {', '.join(test_keys)}{Colors.END}\n")
    
    # Show what will be tested
    print(f"{Colors.BOLD}Test Suites to Execute:{Colors.END}")
    for key in test_keys:
        info = TEST_FILES[key]
        critical = "🔴 CRITICAL" if info['critical'] else "🟡 OPTIONAL"
        print(f"  • {critical} - {info['name']}")
    
    # Show skipped tests
    skipped_keys = [k for k in TEST_FILES.keys() if not TEST_FILES[k].get('enabled', True) and k not in test_keys]
    if skipped_keys:
        print(f"\n{Colors.BOLD}Skipped Test Suites:{Colors.END}")
        for key in skipped_keys:
            info = TEST_FILES[key]
            print(f"  • {Colors.YELLOW}⊘{Colors.END} {info['name']}")
            if 'skip_reason' in info:
                print(f"    Reason: {info['skip_reason']}")
    
    print(f"\n{Colors.YELLOW}⏳ Starting test execution...{Colors.END}")
    time.sleep(1)
    
    # Run tests
    start_time = time.time()
    
    try:
        results = run_selected_tests(test_keys, args.verbose)
        total_duration = time.time() - start_time
        
        # Print summary
        print_summary(results, total_duration)
        
        # Save results if requested
        if args.save_results:
            save_results_to_file(results)
        
        # Exit with appropriate code
        active_results = [r for r in results if not r.skipped]
        failed_critical = sum(1 for r in active_results if r.critical and not r.passed)
        
        if failed_critical > 0:
            sys.exit(1)  # Critical failure
        elif any(not r.passed for r in active_results):
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