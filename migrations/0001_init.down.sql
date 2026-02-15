DROP INDEX IF EXISTS idx_contracts_status_deadline_at;
DROP INDEX IF EXISTS idx_bids_slot_id_amount_created_at;
DROP INDEX IF EXISTS idx_slots_status_auction_ends_at;

DROP TABLE IF EXISTS contracts;
DROP TABLE IF EXISTS bids;
DROP TABLE IF EXISTS executive_profiles;
DROP TABLE IF EXISTS slots;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS contract_status;
DROP TYPE IF EXISTS escrow_status;
DROP TYPE IF EXISTS slot_status;
DROP TYPE IF EXISTS slot_tier;
DROP TYPE IF EXISTS user_type;
