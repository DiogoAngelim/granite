CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_type') THEN
    CREATE TYPE user_type AS ENUM ('EXECUTIVE', 'OWNER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'slot_tier') THEN
    CREATE TYPE slot_tier AS ENUM ('7_DAYS', '14_DAYS', '30_DAYS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'slot_status') THEN
    CREATE TYPE slot_status AS ENUM ('OPEN', 'AUCTION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'BREACH', 'VOID');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'escrow_status') THEN
    CREATE TYPE escrow_status AS ENUM ('LOCKED', 'RELEASED', 'REFUNDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_status') THEN
    CREATE TYPE contract_status AS ENUM ('ACTIVE', 'COMPLETED', 'BREACH');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type user_type NOT NULL,
  email text NOT NULL UNIQUE,
  verified boolean NOT NULL DEFAULT false,
  rating_internal numeric(4,2) NOT NULL DEFAULT '0.00',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executive_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tier slot_tier NOT NULL,
  category text NOT NULL,
  status slot_status NOT NULL DEFAULT 'OPEN',
  auction_ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS executive_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  invite_only boolean NOT NULL DEFAULT true,
  active_slot_id uuid REFERENCES slots(id) ON DELETE SET NULL,
  reserve_price integer NOT NULL,
  categories text[] NOT NULL DEFAULT ARRAY[]::text[]
);

CREATE TABLE IF NOT EXISTS bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount integer NOT NULL,
  escrow_status escrow_status NOT NULL DEFAULT 'LOCKED',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL UNIQUE REFERENCES slots(id) ON DELETE CASCADE,
  winning_bid_id uuid NOT NULL UNIQUE REFERENCES bids(id) ON DELETE RESTRICT,
  clearing_price integer NOT NULL,
  status contract_status NOT NULL DEFAULT 'ACTIVE',
  started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slots_status_auction_ends_at ON slots(status, auction_ends_at);
CREATE INDEX IF NOT EXISTS idx_bids_slot_id_amount_created_at ON bids(slot_id, amount DESC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_contracts_status_deadline_at ON contracts(status, deadline_at);
