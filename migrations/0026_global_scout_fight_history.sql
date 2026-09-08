PRAGMA foreign_keys = ON;

-- Resolved, fighter-centric history used by global dossiers. This is materialized
-- separately from the raw participant mirror because the global builder can use
-- fight-row bio metadata to disambiguate same-name fighters more accurately.
CREATE TABLE IF NOT EXISTS scout_global_fights (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  source_fight_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  organization TEXT NOT NULL,
  promotion_slug TEXT REFERENCES scout_promotions(slug),
  event_name TEXT,
  event_location TEXT,
  weight_class TEXT,
  result TEXT NOT NULL CHECK (result IN ('W','L','D','NC')),
  opponent_source_fighter_id TEXT,
  opponent_name TEXT NOT NULL,
  opponent_pre_elo REAL,
  is_title_fight INTEGER NOT NULL DEFAULT 0,
  method TEXT,
  round_num INTEGER,
  time_finish_seconds INTEGER,
  PRIMARY KEY(source_key,snapshot_id,source_fighter_id,source_fight_id)
);
CREATE INDEX IF NOT EXISTS idx_scout_global_fights_fighter_date
  ON scout_global_fights(source_key,snapshot_id,source_fighter_id,event_date DESC);
CREATE INDEX IF NOT EXISTS idx_scout_global_fights_promotion_date
  ON scout_global_fights(promotion_slug,event_date DESC);

DROP VIEW IF EXISTS scout_active_global_fights;
CREATE VIEW scout_active_global_fights AS
SELECT f.*
FROM scout_global_fights f
JOIN mma_source_registry r
  ON r.source_key=f.source_key AND r.active_snapshot_id=f.snapshot_id;
