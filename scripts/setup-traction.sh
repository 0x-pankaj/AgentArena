#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Agent Arena — Traction Deployment Script
# One-command setup for Solana Frontier hackathon traction phase
# ═══════════════════════════════════════════════════════════════

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     Agent Arena — Traction Deployment Setup                   ║"
echo "║     8004 Registry + ATOM Reputation + Privy Agentic           ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

# ── 1. Check prerequisites ─────────────────────────────────────
echo ""
echo "[1/6] Checking prerequisites..."

if ! command -v bun &> /dev/null; then
    echo "❌ Bun not found. Install: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org/"
    exit 1
fi

echo "✅ Bun $(bun --version) detected"
echo "✅ Node $(node --version) detected"

# ── 2. Install dependencies ────────────────────────────────────
echo ""
echo "[2/6] Installing dependencies..."
cd "$(dirname "$0")/.."
bun install
echo "✅ Dependencies installed"

# ── 3. Check environment variables ─────────────────────────────
echo ""
echo "[3/6] Checking environment..."

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  .env not found. Creating from template..."
    cat > "$ENV_FILE" << 'EOF'
# === Agent Arena Environment ===

# Deploy Phase: development | traction | production
DEPLOY_PHASE=traction

# Solana Cluster
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com

# Privy (required for Agentic Wallets)
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# Pinata IPFS (optional — enables real IPFS uploads for 8004 metadata)
# Get JWT from https://app.pinata.cloud/
PINATA_JWT=

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/agentarena

# Redis
REDIS_URL=redis://localhost:6379

# Optional: Jupiter Predict API key
# JUPITER_API_KEY=
EOF
    echo "✅ Created .env template — EDIT IT with your keys!"
else
    echo "✅ .env exists"
fi

# Check critical env vars
if [ -z "$PRIVY_APP_ID" ] || [ -z "$PRIVY_APP_SECRET" ]; then
    echo "⚠️  PRIVY_APP_ID or PRIVY_APP_SECRET not set in environment"
    echo "   Get them from https://dashboard.privy.io/"
fi

# ── 4. Run database migrations ─────────────────────────────────
echo ""
echo "[4/6] Running database migrations..."
cd apps/api

if [ -f "migrations/0001_add_8004_atom_agentic.sql" ]; then
    echo "   Migration file found: migrations/0001_add_8004_atom_agentic.sql"
    echo "   Run this SQL against your PostgreSQL database:"
    echo ""
    cat migrations/0001_add_8004_atom_agentic.sql
    echo ""
    echo "   Or use: psql $DATABASE_URL -f migrations/0001_add_8004_atom_agentic.sql"
else
    echo "   No migration files to apply"
fi

cd ../..

# ── 5. Build verification ──────────────────────────────────────
echo ""
echo "[5/6] Building for verification..."
bun run build
echo "✅ Build successful"

# ── 6. TypeScript typecheck ────────────────────────────────────
echo ""
echo "[6/6] Running typecheck..."
cd apps/api
npx tsc --noEmit
cd ../..
echo "✅ TypeScript typecheck passed"

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    SETUP COMPLETE ✅                          ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                               ║"
echo "║  Next steps:                                                  ║"
echo "║  1. Edit .env with your PRIVY_APP_ID and PRIVY_APP_SECRET     ║"
echo "║  2. Apply DB migration:                                       ║"
echo "║     psql $DATABASE_URL -f apps/api/migrations/0001_*.sql      ║"
echo "║  3. Start API:   cd apps/api && bun run dev                   ║"
echo "║  4. Start Mobile: cd apps/mobile && npx expo start            ║"
echo "║                                                               ║"
echo "║  8004 Devnet Collection: C6W2bq4BoVT8FDvqhdp3sbcHFBjNBXE8TsNak2wTXQs9 ║"
echo "║  8004 Devnet Program: 8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C   ║"
echo "║  ATOM Devnet Program: AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF   ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
