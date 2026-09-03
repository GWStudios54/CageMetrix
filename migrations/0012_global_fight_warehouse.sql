-- Internal multi-organization fight warehouse.
-- This is intentionally separate from CageMetrix launch-forward bouts/predictions.
-- Imported rows are research inputs only and are never treated as historical CageMetrix predictions.

CREATE TABLE warehouse_sources (
  source_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  upstream_sources_json TEXT NOT NULL DEFAULT '[]',
  usage_note TEXT NOT NULL DEFAULT '',
  latest_source_hash TEXT,
  latest_source_version TEXT,
  latest_ingested_at TEXT,
  fighter_rows INTEGER NOT NULL DEFAULT 0,
  bout_rows INTEGER NOT NULL DEFAULT 0,
  detailed_bout_rows INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE warehouse_ingestion_runs (
  run_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES warehouse_sources(source_key),
  source_hash TEXT NOT NULL,
  source_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  fighter_rows INTEGER NOT NULL DEFAULT 0,
  bout_rows INTEGER NOT NULL DEFAULT 0,
  detailed_bout_rows INTEGER NOT NULL DEFAULT 0,
  organization_rows INTEGER NOT NULL DEFAULT 0,
  first_event_date TEXT,
  last_event_date TEXT,
  report_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_warehouse_ingestion_source ON warehouse_ingestion_runs(source_key, started_at DESC);

CREATE TABLE warehouse_fighters (
  source_key TEXT NOT NULL REFERENCES warehouse_sources(source_key),
  source_fighter_id TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  dob TEXT,
  height_cm REAL,
  reach_cm REAL,
  stance TEXT,
  nationality TEXT,
  gym TEXT,
  source_version TEXT NOT NULL,
  last_seen_run_id TEXT NOT NULL REFERENCES warehouse_ingestion_runs(run_id),
  imported_at TEXT NOT NULL,
  PRIMARY KEY(source_key, source_fighter_id)
);
CREATE INDEX idx_warehouse_fighter_name ON warehouse_fighters(normalized_name);
CREATE INDEX idx_warehouse_fighter_dob ON warehouse_fighters(dob);

CREATE TABLE warehouse_bouts (
  source_key TEXT NOT NULL REFERENCES warehouse_sources(source_key),
  source_bout_id TEXT NOT NULL,
  organization TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_year INTEGER,
  event_location TEXT,
  weight_class TEXT,
  fighter_1_name TEXT NOT NULL,
  fighter_2_name TEXT NOT NULL,
  fighter_1_normalized TEXT NOT NULL,
  fighter_2_normalized TEXT NOT NULL,
  fighter_1_source_id TEXT,
  fighter_2_source_id TEXT,
  winner_name TEXT,
  winner_side INTEGER CHECK(winner_side IS NULL OR winner_side IN (1,2)),
  outcome TEXT NOT NULL CHECK(outcome IN ('fighter_1','fighter_2','draw','no_contest','unknown')),
  is_title_fight INTEGER NOT NULL DEFAULT 0 CHECK(is_title_fight IN (0,1)),
  method_raw TEXT,
  method_normalized TEXT,
  method_detail TEXT,
  finish_round INTEGER,
  finish_time_seconds INTEGER,
  fighter_1_height_cm REAL,
  fighter_1_weight_kg REAL,
  fighter_2_height_cm REAL,
  fighter_2_weight_kg REAL,
  referee TEXT,
  fighter_1_gym TEXT,
  fighter_2_gym TEXT,
  fighter_1_nationality TEXT,
  fighter_2_nationality TEXT,
  is_major_org INTEGER NOT NULL DEFAULT 0 CHECK(is_major_org IN (0,1)),
  source_version TEXT NOT NULL,
  last_seen_run_id TEXT NOT NULL REFERENCES warehouse_ingestion_runs(run_id),
  imported_at TEXT NOT NULL,
  PRIMARY KEY(source_key, source_bout_id)
);
CREATE INDEX idx_warehouse_bouts_date ON warehouse_bouts(event_date DESC);
CREATE INDEX idx_warehouse_bouts_org_date ON warehouse_bouts(organization, event_date DESC);
CREATE INDEX idx_warehouse_bouts_f1 ON warehouse_bouts(source_key, fighter_1_source_id, event_date DESC);
CREATE INDEX idx_warehouse_bouts_f2 ON warehouse_bouts(source_key, fighter_2_source_id, event_date DESC);
CREATE INDEX idx_warehouse_bouts_name1 ON warehouse_bouts(fighter_1_normalized, event_date DESC);
CREATE INDEX idx_warehouse_bouts_name2 ON warehouse_bouts(fighter_2_normalized, event_date DESC);

CREATE TABLE warehouse_bout_stats (
  source_key TEXT NOT NULL,
  source_bout_id TEXT NOT NULL,
  organization TEXT NOT NULL,
  event_date TEXT NOT NULL,
  fighter_1_name TEXT NOT NULL,
  fighter_2_name TEXT NOT NULL,
  fighter_1_source_id TEXT,
  fighter_2_source_id TEXT,
  fighter_1_reach_cm REAL,
  fighter_2_reach_cm REAL,
  fighter_1_stance TEXT,
  fighter_2_stance TEXT,
  fighter_1_dob TEXT,
  fighter_2_dob TEXT,
  fighter_1_kd INTEGER,
  fighter_2_kd INTEGER,
  fighter_1_sig_landed INTEGER,
  fighter_1_sig_attempted INTEGER,
  fighter_2_sig_landed INTEGER,
  fighter_2_sig_attempted INTEGER,
  fighter_1_td_landed INTEGER,
  fighter_1_td_attempted INTEGER,
  fighter_2_td_landed INTEGER,
  fighter_2_td_attempted INTEGER,
  fighter_1_ctrl_seconds INTEGER,
  fighter_2_ctrl_seconds INTEGER,
  has_stats INTEGER NOT NULL DEFAULT 0 CHECK(has_stats IN (0,1)),
  is_no_contest INTEGER NOT NULL DEFAULT 0 CHECK(is_no_contest IN (0,1)),
  source_version TEXT NOT NULL,
  last_seen_run_id TEXT NOT NULL REFERENCES warehouse_ingestion_runs(run_id),
  imported_at TEXT NOT NULL,
  PRIMARY KEY(source_key, source_bout_id),
  FOREIGN KEY(source_key, source_bout_id) REFERENCES warehouse_bouts(source_key, source_bout_id)
);
CREATE INDEX idx_warehouse_stats_date ON warehouse_bout_stats(event_date DESC);
CREATE INDEX idx_warehouse_stats_f1 ON warehouse_bout_stats(source_key, fighter_1_source_id, event_date DESC);
CREATE INDEX idx_warehouse_stats_f2 ON warehouse_bout_stats(source_key, fighter_2_source_id, event_date DESC);

-- Links into CageMetrix's canonical UFC identities are deliberately explicit.
-- Automated imports never merge identities only because two people share a name.
CREATE TABLE warehouse_fighter_links (
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  cagemetrix_fighter_id INTEGER NOT NULL REFERENCES fighters(id),
  match_method TEXT NOT NULL CHECK(match_method IN ('source_id','name_dob','manual')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  notes TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_key, source_fighter_id),
  FOREIGN KEY(source_key, source_fighter_id) REFERENCES warehouse_fighters(source_key, source_fighter_id)
);
CREATE INDEX idx_warehouse_links_cagemetrix ON warehouse_fighter_links(cagemetrix_fighter_id);
