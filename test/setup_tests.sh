#!/bin/bash

# ============================================
# Binary Option Trading System
# Test Suite Setup Script
# ============================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║                                                                   ║${NC}"
echo -e "${BOLD}${CYAN}║      🧪 BINARY OPTION TRADING SYSTEM 🧪                           ║${NC}"
echo -e "${BOLD}${CYAN}║           TEST SUITE SETUP                                        ║${NC}"
echo -e "${BOLD}${CYAN}║                                                                   ║${NC}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# Check Python
# ============================================
echo -e "${BOLD}1️⃣  Checking Python...${NC}"

if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    echo -e "${GREEN}✓${NC} Python 3 found: ${PYTHON_VERSION}"
else
    echo -e "${RED}✗${NC} Python 3 not found"
    echo -e "${YELLOW}Please install Python 3.7+${NC}"
    exit 1
fi

# ============================================
# Check pip
# ============================================
echo ""
echo -e "${BOLD}2️⃣  Checking pip...${NC}"

if command -v pip3 &> /dev/null; then
    PIP_VERSION=$(pip3 --version | cut -d' ' -f2)
    echo -e "${GREEN}✓${NC} pip found: ${PIP_VERSION}"
else
    echo -e "${RED}✗${NC} pip not found"
    echo -e "${YELLOW}Please install pip${NC}"
    exit 1
fi

# ============================================
# Create requirements.txt
# ============================================
echo ""
echo -e "${BOLD}3️⃣  Creating requirements.txt...${NC}"

cat > requirements.txt << 'EOF'
requests==2.31.0
pytest==7.4.3
pytest-timeout==2.2.0
pytest-asyncio==0.21.1
colorama==0.4.6
tabulate==0.9.0
EOF

echo -e "${GREEN}✓${NC} requirements.txt created"

# ============================================
# Install Dependencies
# ============================================
echo ""
echo -e "${BOLD}4️⃣  Installing dependencies...${NC}"

pip3 install -r requirements.txt

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Dependencies installed"
else
    echo -e "${RED}✗${NC} Failed to install dependencies"
    exit 1
fi

# ============================================
# Make scripts executable
# ============================================
echo ""
echo -e "${BOLD}5️⃣  Making test scripts executable...${NC}"

chmod +x test_backend.py 2>/dev/null && echo -e "${GREEN}✓${NC} test_backend.py"
chmod +x test_simulator.py 2>/dev/null && echo -e "${GREEN}✓${NC} test_simulator.py"
chmod +x test_performance.py 2>/dev/null && echo -e "${GREEN}✓${NC} test_performance.py"
chmod +x test_integration.py 2>/dev/null && echo -e "${GREEN}✓${NC} test_integration.py"
chmod +x run_all_tests.py 2>/dev/null && echo -e "${GREEN}✓${NC} run_all_tests.py"

# ============================================
# Check Backend
# ============================================
echo ""
echo -e "${BOLD}6️⃣  Checking backend...${NC}"

if curl -s http://localhost:3000/api/v1/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Backend is running"
    BACKEND_RUNNING=true
else
    echo -e "${YELLOW}⚠${NC} Backend not running"
    echo -e "${YELLOW}  Start backend: cd backendv2 && npm run start:dev${NC}"
    BACKEND_RUNNING=false
fi

# ============================================
# Check Simulator
# ============================================
echo ""
echo -e "${BOLD}7️⃣  Checking simulator...${NC}"

if curl -s "https://stc-autotrade-18f67-default-rtdb.asia-southeast1.firebasedatabase.app/idx_stc/current_price.json" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Simulator is accessible"
    SIMULATOR_RUNNING=true
else
    echo -e "${YELLOW}⚠${NC} Simulator not accessible"
    echo -e "${YELLOW}  Start simulator: cd trading-simulator && npm start${NC}"
    SIMULATOR_RUNNING=false
fi

# ============================================
# Summary
# ============================================
echo ""
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}✅ SETUP COMPLETE!${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

if [ "$BACKEND_RUNNING" = true ] && [ "$SIMULATOR_RUNNING" = true ]; then
    echo -e "${GREEN}${BOLD}🎉 All systems ready!${NC}"
    echo ""
    echo -e "${BOLD}Quick Commands:${NC}"
    echo ""
    echo -e "  ${CYAN}python3 test_backend.py${NC}      - Test backend API"
    echo -e "  ${CYAN}python3 test_simulator.py${NC}    - Test simulator"
    echo -e "  ${CYAN}python3 test_performance.py${NC}  - Load testing"
    echo -e "  ${CYAN}python3 test_integration.py${NC}  - End-to-end test"
    echo -e "  ${CYAN}python3 run_all_tests.py${NC}     - Run ALL tests"
    echo ""
    echo -e "${GREEN}${BOLD}Ready to test! Run: python3 run_all_tests.py${NC}"
else
    echo -e "${YELLOW}${BOLD}⚠️  Some services are not running${NC}"
    echo ""
    echo -e "${BOLD}Start services:${NC}"
    
    if [ "$BACKEND_RUNNING" = false ]; then
        echo -e "  1. Backend:   ${CYAN}cd backendv2 && npm run start:dev${NC}"
    fi
    
    if [ "$SIMULATOR_RUNNING" = false ]; then
        echo -e "  2. Simulator: ${CYAN}cd trading-simulator && npm start${NC}"
    fi
    
    echo ""
    echo -e "Then run: ${CYAN}python3 run_all_tests.py${NC}"
fi

echo ""

# ============================================
# Test Files Summary
# ============================================
echo -e "${BOLD}Test Files:${NC}"
echo ""

if [ -f "test_backend.py" ]; then
    echo -e "  ${GREEN}✓${NC} test_backend.py        - Backend API tests"
else
    echo -e "  ${RED}✗${NC} test_backend.py        - MISSING"
fi

if [ -f "test_simulator.py" ]; then
    echo -e "  ${GREEN}✓${NC} test_simulator.py      - Simulator tests"
else
    echo -e "  ${RED}✗${NC} test_simulator.py      - MISSING"
fi

if [ -f "test_performance.py" ]; then
    echo -e "  ${GREEN}✓${NC} test_performance.py    - Load tests"
else
    echo -e "  ${RED}✗${NC} test_performance.py    - MISSING"
fi

if [ -f "test_integration.py" ]; then
    echo -e "  ${GREEN}✓${NC} test_integration.py    - Integration tests"
else
    echo -e "  ${RED}✗${NC} test_integration.py    - MISSING"
fi

if [ -f "run_all_tests.py" ]; then
    echo -e "  ${GREEN}✓${NC} run_all_tests.py       - Master runner"
else
    echo -e "  ${RED}✗${NC} run_all_tests.py       - MISSING"
fi

echo ""
echo -e "${BOLD}Documentation:${NC}"
echo -e "  📚 README_TESTING.md   - Complete guide"
echo ""

# ============================================
# Quick Test
# ============================================
if [ "$BACKEND_RUNNING" = true ]; then
    echo -e "${BOLD}Quick Test (5 seconds):${NC}"
    echo ""
    echo -n "  Testing backend health... "
    
    HEALTH_RESPONSE=$(curl -s http://localhost:3000/api/v1/health)
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""