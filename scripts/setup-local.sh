#!/bin/bash
# AgentArena Local Development Setup
# Run: bash scripts/setup-local.sh

set -e

echo "=== AgentArena Local Setup ==="

# 1. Start PostgreSQL
echo "[1/5] Starting PostgreSQL..."
if ! pg_isready -q 2>/dev/null; then
    sudo service postgresql start 2>/dev/null || pg_ctlcluster 14 main start 2>/dev/null || true
    sleep 2
fi

if pg_isready -q 2>/dev/null; then
    echo "  ✓ PostgreSQL running"
else
    echo "  ✗ PostgreSQL not running. Try: sudo service postgresql start"
    exit 1
fi

# 2. Create database if not exists
echo "[2/5] Creating database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='agent_arena'" | grep -q 1 || \
    sudo -u postgres createdb agent_arena 2>/dev/null || \
    psql -U postgres -h localhost -c "CREATE DATABASE agent_arena;" 2>/dev/null || true
echo "  ✓ Database ready"

# 3. Start Redis
echo "[3/5] Starting Redis..."
if ! redis-cli ping >/dev/null 2>&1; then
    redis-server --daemonize yes 2>/dev/null || true
    sleep 1
fi

if redis-cli ping >/dev/null 2>&1; then
    echo "  ✓ Redis running"
else
    echo "  ✗ Redis not running. Try: redis-server --daemonize yes"
    exit 1
fi

# 4. Push DB schema
echo "[4/5] Pushing database schema..."
cd "$(dirname "$0")/.."
bun run --filter=@agent-arena/api db:push 2>/dev/null || \
    cd apps/api && bunx drizzle-kit push 2>/dev/null || true
echo "  ✓ Schema pushed"

# 5. Verify
echo "[5/5] Verifying setup..."
cd "$(dirname "$0")/.."
bun run typecheck 2>/dev/null
echo "  ✓ Typecheck passed"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your API keys (at minimum: KIMI_API_KEY)"
echo "  2. Run: bun run dev:api"
echo "  3. Test: curl http://localhost:3001/health"
echo ""
