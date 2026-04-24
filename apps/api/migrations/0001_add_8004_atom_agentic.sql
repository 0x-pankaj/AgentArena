-- Migration: Add 8004 Agent Registry + ATOM Reputation + Privy Agentic Wallet columns
-- Run this against your PostgreSQL database

-- Agents table: 8004 + ATOM
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS asset_address VARCHAR(44),
  ADD COLUMN IF NOT EXISTS atom_stats_address VARCHAR(44),
  ADD COLUMN IF NOT EXISTS trust_tier VARCHAR(20) DEFAULT 'Unknown',
  ADD COLUMN IF NOT EXISTS reputation_score DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS atom_enabled BOOLEAN DEFAULT false;

-- Jobs table: policy expiry for Agentic Wallets
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS policy_expiry_at TIMESTAMP;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS agents_asset_idx ON agents(asset_address);
CREATE INDEX IF NOT EXISTS agents_trust_tier_idx ON agents(trust_tier);

-- Note: on_chain_address and atom_stats_address columns already exist or will be handled by your ORM
