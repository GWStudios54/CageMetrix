-- Compact, indexed biography facts used to propagate already-accepted participant identities.
-- This is a derived cache only: immutable source snapshots remain the source of truth and
-- the resolver rebuilds these rows from accepted identity overlays before each pass.

CREATE TABLE IF NOT EXISTS mma_participant_identity_seed_facts (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fight_id TEXT NOT NULL,
  side INTEGER NOT NULL CHECK (side IN (1,2)),
  normalized_name TEXT NOT NULL,
  resolved_source_fighter_id TEXT NOT NULL,
  dob TEXT,
  gym TEXT,
  nationality TEXT,
  height_cm REAL,
  reach_cm REAL,
  stance TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key, snapshot_id, source_fight_id, side)
);

CREATE INDEX IF NOT EXISTS idx_mma_identity_seed_name
  ON mma_participant_identity_seed_facts(source_key, snapshot_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_mma_identity_seed_candidate
  ON mma_participant_identity_seed_facts(source_key, snapshot_id, normalized_name, resolved_source_fighter_id);
