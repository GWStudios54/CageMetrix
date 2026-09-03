-- CageMetrix master MMA research database.
-- This schema is intentionally separate from the production rating/prediction tables.
-- Source snapshots are immutable while loading; mma_source_registry switches the active
-- snapshot only after a complete import succeeds.

CREATE TABLE IF NOT EXISTS mma_source_registry (
  source_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  dataset_homepage TEXT,
  code_homepage TEXT,
  code_license TEXT,
  upstream_sources_json TEXT,
  active_snapshot_id TEXT,
  active_since TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS mma_source_snapshots (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_version TEXT,
  source_max_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('loading','complete','failed')),
  fighter_count INTEGER NOT NULL DEFAULT 0,
  fight_count INTEGER NOT NULL DEFAULT 0,
  participant_count INTEGER NOT NULL DEFAULT 0,
  technical_fight_count INTEGER NOT NULL DEFAULT 0,
  organization_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_text TEXT,
  PRIMARY KEY (source_key, snapshot_id)
);

CREATE TABLE IF NOT EXISTS mma_fighters (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  dob TEXT,
  height_cm REAL,
  reach_cm REAL,
  stance TEXT,
  nationality TEXT,
  gym TEXT,
  PRIMARY KEY (source_key, snapshot_id, source_fighter_id)
);

CREATE INDEX IF NOT EXISTS idx_mma_fighters_name
  ON mma_fighters(source_key, snapshot_id, normalized_name);

CREATE TABLE IF NOT EXISTS mma_fights (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fight_id TEXT NOT NULL,
  organization TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_year INTEGER,
  event_location TEXT,
  weight_class TEXT,
  is_major_org INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'unknown',
  winner_side INTEGER,
  is_title_fight INTEGER NOT NULL DEFAULT 0,
  method_raw TEXT,
  method_normalized TEXT,
  method_detail TEXT,
  round_num INTEGER,
  time_finish_seconds INTEGER,
  referee TEXT,
  has_technical_stats INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_key, snapshot_id, source_fight_id)
);

CREATE INDEX IF NOT EXISTS idx_mma_fights_date
  ON mma_fights(source_key, snapshot_id, event_date);
CREATE INDEX IF NOT EXISTS idx_mma_fights_org_date
  ON mma_fights(source_key, snapshot_id, organization, event_date);
CREATE INDEX IF NOT EXISTS idx_mma_fights_major_date
  ON mma_fights(source_key, snapshot_id, is_major_org, event_date);

CREATE TABLE IF NOT EXISTS mma_fight_participants (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fight_id TEXT NOT NULL,
  side INTEGER NOT NULL CHECK (side IN (1,2)),
  source_fighter_id TEXT,
  fighter_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'U' CHECK (result IN ('W','L','D','NC','U')),
  height_cm REAL,
  weight_kg REAL,
  reach_cm REAL,
  stance TEXT,
  dob TEXT,
  gym TEXT,
  nationality TEXT,
  knockdowns INTEGER,
  sig_str_landed INTEGER,
  sig_str_attempted INTEGER,
  td_landed INTEGER,
  td_attempted INTEGER,
  ctrl_seconds INTEGER,
  PRIMARY KEY (source_key, snapshot_id, source_fight_id, side)
);

CREATE INDEX IF NOT EXISTS idx_mma_participants_fighter
  ON mma_fight_participants(source_key, snapshot_id, source_fighter_id, source_fight_id);
CREATE INDEX IF NOT EXISTS idx_mma_participants_name
  ON mma_fight_participants(source_key, snapshot_id, normalized_name, source_fight_id);

CREATE TABLE IF NOT EXISTS mma_identity_links (
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  cagemetrix_fighter_id TEXT,
  match_method TEXT NOT NULL DEFAULT 'unmatched',
  confidence REAL NOT NULL DEFAULT 0,
  reviewed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key, source_fighter_id)
);

CREATE VIEW IF NOT EXISTS mma_active_fighters AS
SELECT f.*
FROM mma_fighters f
JOIN mma_source_registry s
  ON s.source_key = f.source_key
 AND s.active_snapshot_id = f.snapshot_id;

CREATE VIEW IF NOT EXISTS mma_active_fights AS
SELECT f.*
FROM mma_fights f
JOIN mma_source_registry s
  ON s.source_key = f.source_key
 AND s.active_snapshot_id = f.snapshot_id;

CREATE VIEW IF NOT EXISTS mma_active_participants AS
SELECT p.*
FROM mma_fight_participants p
JOIN mma_source_registry s
  ON s.source_key = p.source_key
 AND s.active_snapshot_id = p.snapshot_id;

-- Safe default for modeling: never include scheduled/future rows or unresolved outcomes.
CREATE VIEW IF NOT EXISTS mma_completed_fights AS
SELECT *
FROM mma_active_fights
WHERE outcome <> 'unknown'
  AND event_date <= DATE('now');

CREATE VIEW IF NOT EXISTS mma_completed_participants AS
SELECT p.*
FROM mma_active_participants p
JOIN mma_completed_fights f
  ON f.source_key = p.source_key
 AND f.snapshot_id = p.snapshot_id
 AND f.source_fight_id = p.source_fight_id;

CREATE VIEW IF NOT EXISTS mma_major_fights AS
SELECT * FROM mma_completed_fights WHERE is_major_org = 1;

CREATE VIEW IF NOT EXISTS mma_technical_participants AS
SELECT p.*
FROM mma_completed_participants p
JOIN mma_completed_fights f
  ON f.source_key = p.source_key
 AND f.snapshot_id = p.snapshot_id
 AND f.source_fight_id = p.source_fight_id
WHERE f.has_technical_stats = 1;
