#!/bin/bash

# ============================================
# BINARY OPTION BACKEND - MONITORING SCRIPT
# ============================================
# Run on VPS to check backend health
# ============================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}🔍 Binary Option Backend - Health Monitor${NC}"
echo "=========================================="
echo ""

# Check if running
check_status() {
    if pm2 list | grep -q "binary-backend.*online"; then
        echo -e "${GREEN}✅ Status: RUNNING${NC}"
        return 0
    else
        echo -e "${RED}❌ Status: NOT RUNNING${NC}"
        return 1
    fi
}

# Get restart count
check_restarts() {
    RESTART_COUNT=$(pm2 jlist | grep -A 20 "binary-backend" | grep "restart_time" | grep -o '[0-9]*' | head -1)
    echo -n "🔄 Restart Count: $RESTART_COUNT "
    if [ "$RESTART_COUNT" -lt 5 ]; then
        echo -e "${GREEN}(OK)${NC}"
        return 0
    else
        echo -e "${YELLOW}(High)${NC}"
        return 1
    fi
}

# Check memory
check_memory() {
    MEMORY=$(pm2 jlist | grep -A 20 "binary-backend" | grep '"memory"' | grep -o '[0-9]*' | head -1)
    MEMORY_MB=$((MEMORY / 1024 / 1024))
    echo -n "💾 Memory Usage: ${MEMORY_MB}MB "
    if [ "$MEMORY_MB" -lt 250 ]; then
        echo -e "${GREEN}(OK)${NC}"
        return 0
    else
        echo -e "${YELLOW}(High)${NC}"
        return 1
    fi
}

# Check CPU
check_cpu() {
    CPU=$(pm2 jlist | grep -A 20 "binary-backend" | grep '"cpu"' | grep -o '[0-9.]*' | head -1)
    echo -n "⚡ CPU Usage: ${CPU}% "
    if (( $(echo "$CPU < 50" | bc -l) )); then
        echo -e "${GREEN}(OK)${NC}"
        return 0
    else
        echo -e "${YELLOW}(High)${NC}"
        return 1
    fi
}

# Check uptime
check_uptime() {
    UPTIME=$(pm2 jlist | grep -A 20 "binary-backend" | grep "pm_uptime" | grep -o '[0-9]*' | head -1)
    if [ -n "$UPTIME" ]; then
        UPTIME_SECONDS=$(($(date +%s) - UPTIME / 1000))
        UPTIME_MINUTES=$((UPTIME_SECONDS / 60))
        UPTIME_HOURS=$((UPTIME_MINUTES / 60))
        UPTIME_DAYS=$((UPTIME_HOURS / 24))
        
        echo -n "⏱️  Uptime: "
        if [ "$UPTIME_DAYS" -gt 0 ]; then
            echo -n "${UPTIME_DAYS}d ${UPTIME_HOURS}h"
        elif [ "$UPTIME_HOURS" -gt 0 ]; then
            echo -n "${UPTIME_HOURS}h ${UPTIME_MINUTES}m"
        else
            echo -n "${UPTIME_MINUTES}m"
        fi
        
        if [ "$UPTIME_MINUTES" -gt 5 ]; then
            echo -e " ${GREEN}(OK)${NC}"
            return 0
        else
            echo -e " ${YELLOW}(Recently restarted)${NC}"
            return 1
        fi
    else
        echo -e "${RED}❌ Cannot get uptime${NC}"
        return 1
    fi
}

# Check API health
check_api() {
    echo -n "🌐 API Health: "
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health --max-time 5)
    if [ "$RESPONSE" = "200" ]; then
        echo -e "${GREEN}OK (200)${NC}"
        return 0
    else
        echo -e "${RED}FAIL ($RESPONSE)${NC}"
        return 1
    fi
}

# Check Firebase connection
check_firebase() {
    echo -n "🔥 Firebase: "
    if tail -100 logs/out.log 2>/dev/null | grep -q "Firestore initialized"; then
        echo -e "${GREEN}Connected${NC}"
        return 0
    else
        echo -e "${YELLOW}Unknown${NC}"
        return 1
    fi
}

# Check errors in logs
check_errors() {
    ERROR_COUNT=$(tail -100 logs/error.log 2>/dev/null | wc -l)
    echo -n "📝 Recent Errors: $ERROR_COUNT "
    if [ "$ERROR_COUNT" -lt 10 ]; then
        echo -e "${GREEN}(OK)${NC}"
        return 0
    else
        echo -e "${YELLOW}(High)${NC}"
        return 1
    fi
}

# Main checks
FAILED=0

check_status || FAILED=$((FAILED + 1))
echo ""

if pm2 list | grep -q "binary-backend.*online"; then
    check_restarts || FAILED=$((FAILED + 1))
    check_memory || FAILED=$((FAILED + 1))
    check_cpu || FAILED=$((FAILED + 1))
    check_uptime || FAILED=$((FAILED + 1))
    check_api || FAILED=$((FAILED + 1))
    check_firebase || FAILED=$((FAILED + 1))
    check_errors || FAILED=$((FAILED + 1))
fi

echo ""
echo "=========================================="

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}${BOLD}🎉 All checks passed!${NC}"
else
    echo -e "${YELLOW}${BOLD}⚠️  $FAILED checks failed${NC}"
fi

echo "=========================================="
echo ""

# Show recent activity
echo "📊 Recent Activity (last 10 logs):"
echo "-----------------------------------"
tail -10 logs/out.log 2>/dev/null | grep -E "OHLC|Order|Settlement" || echo "No recent activity"
echo ""

# Show PM2 details
echo "📋 PM2 Details:"
echo "-----------------------------------"
pm2 show binary-backend 2>/dev/null | grep -E "status|uptime|restart|memory|cpu" || echo "Process not running"
echo ""

exit $FAILED