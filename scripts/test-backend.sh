#!/bin/bash
# AgentArena Backend Test Script
# Run: bash scripts/test-backend.sh

set -e

API_URL="${API_URL:-http://localhost:3001}"
WS_URL="${WS_URL:-ws://localhost:3002}"

echo "=== AgentArena Backend Test ==="
echo "API: $API_URL"
echo ""

PASS=0
FAIL=0

test() {
    local name="$1"
    local result="$2"
    if [ "$result" = "pass" ]; then
        echo "  ✓ $name"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $name"
        FAIL=$((FAIL + 1))
    fi
}

# 1. Health check
echo "[1] Health Check"
HEALTH=$(curl -sf "$API_URL/health" 2>/dev/null || echo "fail")
if echo "$HEALTH" | grep -q "ok"; then
    test "API server running" "pass"
else
    test "API server running" "fail"
    echo "  → Is the server running? Run: bun run dev:api"
    exit 1
fi

# 2. tRPC endpoint
echo "[2] tRPC Endpoint"
TRPC=$(curl -sf "$API_URL/trpc/agent.list" 2>/dev/null || echo "fail")
if echo "$TRPC" | grep -q "result"; then
    test "tRPC responding" "pass"
else
    test "tRPC responding" "fail"
fi

# 3. Agent listing
echo "[3] Agent Routes"
AGENTS=$(curl -sf "$API_URL/trpc/agent.list" 2>/dev/null || echo "{}")
if echo "$AGENTS" | grep -q "agents"; then
    test "agent.list returns data" "pass"
else
    test "agent.list returns data" "fail"
fi

# 4. Market listing
echo "[4] Market Routes"
MARKETS=$(curl -sf "$API_URL/trpc/market.list" 2>/dev/null || echo "{}")
if echo "$MARKETS" | grep -q "markets"; then
    test "market.list returns data" "pass"
else
    test "market.list returns data" "fail"
fi

# 5. Feed endpoint
echo "[5] Feed Routes"
FEED=$(curl -sf "$API_URL/trpc/feed.getRecent" 2>/dev/null || echo "{}")
if echo "$FEED" | grep -q "events"; then
    test "feed.getRecent returns data" "pass"
else
    test "feed.getRecent returns data" "fail"
fi

# 6. Leaderboard
echo "[6] Leaderboard Routes"
LB=$(curl -sf "$API_URL/trpc/leaderboard.getAllTime" 2>/dev/null || echo "{}")
if echo "$LB" | grep -q "entries"; then
    test "leaderboard.getAllTime returns data" "pass"
else
    test "leaderboard.getAllTime returns data" "fail"
fi

# 7. WebSocket
echo "[7] WebSocket Server"
WS_TEST=$(timeout 3 websocat "$WS_URL" <<< '{"action":"subscribe","channel":"feed"}' 2>/dev/null || echo "fail")
if echo "$WS_TEST" | grep -q "connected\|subscribed"; then
    test "WebSocket accepting connections" "pass"
else
    # websocat not installed, try basic TCP
    if timeout 2 bash -c "echo > /dev/tcp/localhost/3002" 2>/dev/null; then
        test "WebSocket port open" "pass"
    else
        test "WebSocket server reachable" "fail"
    fi
fi

# 8. Redis connection
echo "[8] Redis"
if redis-cli ping >/dev/null 2>&1; then
    test "Redis responding" "pass"
else
    test "Redis responding" "fail"
fi

# 9. PostgreSQL connection
echo "[9] PostgreSQL"
if pg_isready -q 2>/dev/null; then
    test "PostgreSQL accepting connections" "pass"
else
    test "PostgreSQL accepting connections" "fail"
fi

echo ""
echo "=== Results ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "All tests passed! Backend is ready."
else
    echo "Some tests failed. Check the output above."
fi
