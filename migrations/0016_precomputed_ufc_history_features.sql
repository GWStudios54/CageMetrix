PRAGMA foreign_keys = ON;

-- The broad warehouse is a source, not a runtime query surface. Keep only the
-- precomputed UFC-linked slice in production-facing history views so normal D1
-- reads never rescan the 258k-row participant warehouse.
DROP VIEW IF EXISTS mma_ufc_pre_ufc_history;
DROP VIEW IF EXISTS mma_ufc_career_history;

CREATE VIEW mma_ufc_career_history AS
SELECT
  h.fighter_id,
  f.name AS cagemetrix_name,
  h.source_key,
  h.snapshot_id,
  h.source_fight_id,
  h.event_date,
  h.organization,
  h.event_name,
  h.weight_class,
  h.is_major_org,
  h.method_raw,
  h.method_normalized,
  h.method_detail,
  h.round_num,
  h.time_finish_seconds,
  h.result,
  h.fighter_name,
  h.normalized_name,
  h.opponent_name,
  h.opponent_normalized_name
FROM ufc_warehouse_career_rows h
JOIN fighters f ON f.id = h.fighter_id;

CREATE VIEW mma_ufc_pre_ufc_history AS
SELECT * FROM ufc_warehouse_pre_ufc_rows;

-- Recreate the still-unused feature table with explicit semantics: warehouse
-- contributes pre-UFC history only; prior UFC results come from native bout_totals.
DROP TABLE IF EXISTS ufc_prefight_history_features;
CREATE TABLE ufc_prefight_history_features (
  fighter_id INTEGER NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  ufc_source_key TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  pre_ufc_bouts INTEGER NOT NULL DEFAULT 0,
  pre_ufc_wins INTEGER NOT NULL DEFAULT 0,
  pre_ufc_losses INTEGER NOT NULL DEFAULT 0,
  pre_ufc_draws INTEGER NOT NULL DEFAULT 0,
  pre_ufc_no_contests INTEGER NOT NULL DEFAULT 0,
  pre_ufc_finishes INTEGER NOT NULL DEFAULT 0,
  pre_ufc_finish_rate REAL,
  pre_ufc_major_org_bouts INTEGER NOT NULL DEFAULT 0,
  pre_ufc_recent_bouts_730d INTEGER NOT NULL DEFAULT 0,
  pre_ufc_recent_wins_730d INTEGER NOT NULL DEFAULT 0,
  days_since_last_pre_ufc_fight INTEGER,
  prior_ufc_bouts INTEGER NOT NULL DEFAULT 0,
  prior_ufc_wins INTEGER NOT NULL DEFAULT 0,
  prior_ufc_losses INTEGER NOT NULL DEFAULT 0,
  prior_ufc_draws INTEGER NOT NULL DEFAULT 0,
  prior_ufc_finishes INTEGER NOT NULL DEFAULT 0,
  known_career_bouts INTEGER NOT NULL DEFAULT 0,
  source_key TEXT,
  snapshot_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fighter_id, ufc_source_key)
);

CREATE INDEX idx_ufc_prefight_features_date
  ON ufc_prefight_history_features(as_of_date, fighter_id);
