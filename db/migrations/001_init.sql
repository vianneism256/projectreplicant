-- Sprawlborn / Project Replicant — Phase 1 economy schema.
-- Static definitions (items, recipes, districts) live in shared/ and are referenced by text id.
-- Credits are whole integers (bigint).

CREATE TABLE players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle      text NOT NULL UNIQUE,
  credits     bigint NOT NULL DEFAULT 0 CHECK (credits >= 0),
  -- Credits locked in open buy orders (escrow).
  credits_escrow bigint NOT NULL DEFAULT 0 CHECK (credits_escrow >= 0),
  location    text NOT NULL,            -- district id the player is in
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Items physically stored in a district (no global inventory, design doc section 2).
CREATE TABLE inventories (
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  district_id text NOT NULL,
  item_id     text NOT NULL,
  qty         bigint NOT NULL CHECK (qty >= 0),
  -- Units locked in open sell orders or jobs.
  qty_escrow  bigint NOT NULL DEFAULT 0 CHECK (qty_escrow >= 0),
  PRIMARY KEY (player_id, district_id, item_id)
);

CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_status AS ENUM ('open', 'filled', 'cancelled', 'expired');

CREATE TABLE orders (
  id          bigserial PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players(id),
  district_id text NOT NULL,
  item_id     text NOT NULL,
  side        order_side NOT NULL,
  price       bigint NOT NULL CHECK (price > 0),   -- credits per unit
  qty         bigint NOT NULL CHECK (qty > 0),
  remaining   bigint NOT NULL CHECK (remaining >= 0),
  status      order_status NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX orders_book_idx ON orders (district_id, item_id, side, status, price, created_at);

CREATE TABLE trades (
  id            bigserial PRIMARY KEY,
  district_id   text NOT NULL,
  item_id       text NOT NULL,
  buy_order_id  bigint NOT NULL REFERENCES orders(id),
  sell_order_id bigint NOT NULL REFERENCES orders(id),
  price         bigint NOT NULL,
  qty           bigint NOT NULL,
  sales_tax     bigint NOT NULL,
  executed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trades_history_idx ON trades (district_id, item_id, executed_at);

-- Faucet / sink / transfer ledger (design doc sections 4, 5, 15). Every value change is logged.
CREATE TYPE ledger_kind AS ENUM ('faucet', 'sink', 'transfer');

CREATE TABLE ledger (
  id          bigserial PRIMARY KEY,
  kind        ledger_kind NOT NULL,
  source      text NOT NULL,            -- e.g. 'salvage', 'broker_fee', 'sales_tax', 'refine_loss', 'starter_grant'
  player_id   uuid REFERENCES players(id),
  district_id text,
  credits     bigint NOT NULL DEFAULT 0, -- + created, - destroyed (for faucet/sink)
  item_id     text,
  qty         bigint NOT NULL DEFAULT 0,
  ref         text,                     -- order id, job id, etc.
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_daily_idx ON ledger (created_at, kind, source);

-- Refining / fabrication / assembly jobs.
CREATE TYPE job_status AS ENUM ('running', 'done', 'collected');

CREATE TABLE industry_jobs (
  id          bigserial PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players(id),
  district_id text NOT NULL,
  recipe_id   text NOT NULL,
  runs        int NOT NULL CHECK (runs > 0),
  status      job_status NOT NULL DEFAULT 'running',
  started_at  timestamptz NOT NULL DEFAULT now(),
  finishes_at timestamptz NOT NULL
);

-- Hauls between districts.
CREATE TABLE hauls (
  id          bigserial PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players(id),
  from_id     text NOT NULL,
  to_id       text NOT NULL,
  item_id     text NOT NULL,
  qty         bigint NOT NULL CHECK (qty > 0),
  departs_at  timestamptz NOT NULL DEFAULT now(),
  arrives_at  timestamptz NOT NULL,
  delivered   boolean NOT NULL DEFAULT false
);
