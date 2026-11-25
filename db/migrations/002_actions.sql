-- Phase 1: player actions (salvage cooldown, travel/transit) and crafting ledger kind.

-- 'transform' = items converted by industry (inputs consumed, outputs produced).
-- Kept apart from faucet/sink so crafting doesn't distort economy stats.
ALTER TYPE ledger_kind ADD VALUE IF NOT EXISTS 'transform';

ALTER TABLE players
  ADD COLUMN last_salvage_at timestamptz,
  -- While set and in the future, the player is travelling to `location` and can't act.
  ADD COLUMN transit_until  timestamptz;

-- Haul rows are grouped by trip.
ALTER TABLE hauls ADD COLUMN trip_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX hauls_pending_idx ON hauls (player_id, delivered, arrives_at);

-- Fast lookups for a player's open orders and jobs.
CREATE INDEX orders_player_idx ON orders (player_id, status);
CREATE INDEX jobs_player_idx ON industry_jobs (player_id, status);
CREATE INDEX orders_expiry_idx ON orders (status, expires_at);
