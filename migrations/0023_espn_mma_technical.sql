PRAGMA foreign_keys = ON;

-- Cross-promotion technical overlay for CageMetrix. ESPN is used only for
-- completed non-UFC bouts that belong to fighters already in the native UFC
-- universe. UFC-native fight statistics remain sourced from UFC LiveStats/
-- UFCStats and stay authoritative.
CREATE TABLE IF NOT EXISTS espn_mma_technical_bouts (
  fighter_id INTEGER NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  source_fight_id TEXT NOT NULL,
  league_slug TEXT NOT NULL,
  event_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_name TEXT,
  weight_class TEXT,
  result TEXT,
  fighter_espn_id TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  fighter_normalized_name TEXT NOT NULL,
  opponent_espn_id TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  opponent_normalized_name TEXT NOT NULL,
  duration_seconds INTEGER,
  knockdowns INTEGER,
  sig_str_landed INTEGER,
  sig_str_attempted INTEGER,
  total_str_landed INTEGER,
  total_str_attempted INTEGER,
  td_landed INTEGER,
  td_attempted INTEGER,
  sub_attempts INTEGER,
  ctrl_seconds INTEGER,
  opponent_knockdowns INTEGER,
  opponent_sig_str_landed INTEGER,
  opponent_sig_str_attempted INTEGER,
  opponent_total_str_landed INTEGER,
  opponent_total_str_attempted INTEGER,
  opponent_td_landed INTEGER,
  opponent_td_attempted INTEGER,
  opponent_sub_attempts INTEGER,
  opponent_ctrl_seconds INTEGER,
  source_url TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fighter_id, league_slug, competition_id)
);

CREATE INDEX IF NOT EXISTS idx_espn_mma_technical_fighter_date
  ON espn_mma_technical_bouts(fighter_id, event_date);
CREATE INDEX IF NOT EXISTS idx_espn_mma_technical_league_date
  ON espn_mma_technical_bouts(league_slug, event_date);
CREATE INDEX IF NOT EXISTS idx_espn_mma_technical_opponent
  ON espn_mma_technical_bouts(opponent_normalized_name, event_date);

CREATE TABLE IF NOT EXISTS espn_mma_sync_state (
  league_slug TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  target_fingerprint TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('complete','failed')),
  completed_at TEXT,
  error_text TEXT,
  PRIMARY KEY (league_slug, season_year)
);

-- Add the materialized external technical prior to the existing pre-UFC summary.
-- Keeping it on this row means the normal CMR fingerprint and benchmark surfaces
-- can consume it without a runtime join over the broad warehouse.
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_technical_bouts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_technical_minutes REAL NOT NULL DEFAULT 0;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_technical_score REAL;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_striking_offense REAL;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_striking_defense REAL;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_wrestling_offense REAL;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_wrestling_defense REAL;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_grappling REAL;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_pace REAL;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_technical_reliability REAL NOT NULL DEFAULT 0;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_espn_bouts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_warehouse_bouts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_technical_first_date TEXT;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_technical_last_date TEXT;
ALTER TABLE ufc_fighter_history_summary ADD COLUMN external_technical_sources_json TEXT;

DROP VIEW IF EXISTS ufc_warehouse_pre_ufc_technical;
CREATE VIEW ufc_warehouse_pre_ufc_technical AS
SELECT
  h.fighter_id,
  h.source_key,
  h.snapshot_id,
  h.source_fight_id,
  h.event_date,
  h.organization,
  h.event_name,
  h.weight_class,
  h.result,
  h.round_num,
  h.time_finish_seconds,
  h.fighter_name,
  h.normalized_name,
  h.opponent_name,
  h.opponent_normalized_name,
  p.knockdowns,
  p.sig_str_landed,
  p.sig_str_attempted,
  p.td_landed,
  p.td_attempted,
  p.ctrl_seconds,
  o.knockdowns AS opponent_knockdowns,
  o.sig_str_landed AS opponent_sig_str_landed,
  o.sig_str_attempted AS opponent_sig_str_attempted,
  o.td_landed AS opponent_td_landed,
  o.td_attempted AS opponent_td_attempted,
  o.ctrl_seconds AS opponent_ctrl_seconds
FROM ufc_warehouse_pre_ufc_rows h
JOIN mma_technical_participants p
  ON p.source_key = h.source_key
 AND p.snapshot_id = h.snapshot_id
 AND p.source_fight_id = h.source_fight_id
 AND p.normalized_name = h.normalized_name
LEFT JOIN mma_technical_participants o
  ON o.source_key = p.source_key
 AND o.snapshot_id = p.snapshot_id
 AND o.source_fight_id = p.source_fight_id
 AND o.side <> p.side;
