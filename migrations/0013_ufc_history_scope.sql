PRAGMA foreign_keys = ON;

-- CageMetrix intentionally remains UFC-scoped. The warehouse may contain broad
-- professional MMA history, but only fighters already present in the native UFC
-- fighters table can be linked into CageMetrix. Regional opponents remain
-- warehouse-only and are used solely as career/resume context.

CREATE TABLE IF NOT EXISTS ufc_fighter_identity_keys (
  fighter_id INTEGER PRIMARY KEY REFERENCES fighters(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  dob TEXT,
  height_cm REAL,
  reach_cm REAL,
  stance TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ufc_identity_name
  ON ufc_fighter_identity_keys(normalized_name);

CREATE TABLE IF NOT EXISTS ufc_fighter_history_summary (
  fighter_id INTEGER PRIMARY KEY REFERENCES fighters(id) ON DELETE CASCADE,
  first_ufc_date TEXT,
  first_pre_ufc_fight_date TEXT,
  last_pre_ufc_fight_date TEXT,
  days_from_last_pre_ufc_to_debut INTEGER,
  pre_ufc_bouts INTEGER NOT NULL DEFAULT 0,
  pre_ufc_wins INTEGER NOT NULL DEFAULT 0,
  pre_ufc_losses INTEGER NOT NULL DEFAULT 0,
  pre_ufc_draws INTEGER NOT NULL DEFAULT 0,
  pre_ufc_no_contests INTEGER NOT NULL DEFAULT 0,
  pre_ufc_finishes INTEGER NOT NULL DEFAULT 0,
  pre_ufc_ko_tko_wins INTEGER NOT NULL DEFAULT 0,
  pre_ufc_submission_wins INTEGER NOT NULL DEFAULT 0,
  pre_ufc_decision_wins INTEGER NOT NULL DEFAULT 0,
  pre_ufc_major_org_bouts INTEGER NOT NULL DEFAULT 0,
  pre_ufc_distinct_opponents INTEGER NOT NULL DEFAULT 0,
  source_key TEXT,
  snapshot_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ufc_prefight_history_features (
  fighter_id INTEGER NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  ufc_source_key TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  warehouse_career_bouts INTEGER NOT NULL DEFAULT 0,
  warehouse_career_wins INTEGER NOT NULL DEFAULT 0,
  warehouse_career_losses INTEGER NOT NULL DEFAULT 0,
  warehouse_career_draws INTEGER NOT NULL DEFAULT 0,
  warehouse_career_no_contests INTEGER NOT NULL DEFAULT 0,
  warehouse_career_finishes INTEGER NOT NULL DEFAULT 0,
  warehouse_finish_rate REAL,
  warehouse_major_org_bouts INTEGER NOT NULL DEFAULT 0,
  warehouse_recent_bouts_730d INTEGER NOT NULL DEFAULT 0,
  warehouse_recent_wins_730d INTEGER NOT NULL DEFAULT 0,
  warehouse_days_since_last_fight INTEGER,
  pre_ufc_bouts INTEGER NOT NULL DEFAULT 0,
  source_key TEXT,
  snapshot_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fighter_id, ufc_source_key)
);

CREATE INDEX IF NOT EXISTS idx_ufc_prefight_features_date
  ON ufc_prefight_history_features(as_of_date, fighter_id);

CREATE VIEW IF NOT EXISTS mma_ufc_linked_fighters AS
SELECT
  CAST(l.cagemetrix_fighter_id AS INTEGER) AS fighter_id,
  cf.name AS cagemetrix_name,
  cf.slug AS cagemetrix_slug,
  l.source_key,
  l.source_fighter_id,
  wf.snapshot_id,
  wf.fighter_name AS warehouse_name,
  wf.normalized_name,
  wf.dob,
  wf.height_cm,
  wf.reach_cm,
  wf.stance,
  l.match_method,
  l.confidence,
  l.reviewed
FROM mma_identity_links l
JOIN fighters cf
  ON cf.id = CAST(l.cagemetrix_fighter_id AS INTEGER)
JOIN mma_active_fighters wf
  ON wf.source_key = l.source_key
 AND wf.source_fighter_id = l.source_fighter_id
WHERE l.cagemetrix_fighter_id IS NOT NULL
  AND l.confidence >= 0.90;

CREATE VIEW IF NOT EXISTS mma_ufc_first_bout AS
SELECT fighter_id, MIN(event_date) AS first_ufc_date
FROM bout_totals
GROUP BY fighter_id;

-- Career rows for UFC-linked fighters only. The second branch recovers warehouse
-- participant rows whose source fighter ID is unresolved, but only when the
-- normalized name is unique across the entire active warehouse snapshot.
CREATE VIEW IF NOT EXISTS mma_ufc_career_history AS
SELECT
  lf.fighter_id,
  lf.cagemetrix_name,
  lf.source_key,
  lf.snapshot_id,
  f.source_fight_id,
  f.event_date,
  f.organization,
  f.event_name,
  f.weight_class,
  f.is_major_org,
  f.method_raw,
  f.method_normalized,
  f.method_detail,
  f.round_num,
  f.time_finish_seconds,
  p.result,
  p.fighter_name,
  p.normalized_name,
  o.fighter_name AS opponent_name,
  o.normalized_name AS opponent_normalized_name
FROM mma_ufc_linked_fighters lf
JOIN mma_completed_participants p
  ON p.source_key = lf.source_key
 AND p.snapshot_id = lf.snapshot_id
 AND p.source_fighter_id = lf.source_fighter_id
JOIN mma_completed_fights f
  ON f.source_key = p.source_key
 AND f.snapshot_id = p.snapshot_id
 AND f.source_fight_id = p.source_fight_id
LEFT JOIN mma_completed_participants o
  ON o.source_key = p.source_key
 AND o.snapshot_id = p.snapshot_id
 AND o.source_fight_id = p.source_fight_id
 AND o.side <> p.side
UNION ALL
SELECT
  lf.fighter_id,
  lf.cagemetrix_name,
  lf.source_key,
  lf.snapshot_id,
  f.source_fight_id,
  f.event_date,
  f.organization,
  f.event_name,
  f.weight_class,
  f.is_major_org,
  f.method_raw,
  f.method_normalized,
  f.method_detail,
  f.round_num,
  f.time_finish_seconds,
  p.result,
  p.fighter_name,
  p.normalized_name,
  o.fighter_name AS opponent_name,
  o.normalized_name AS opponent_normalized_name
FROM mma_ufc_linked_fighters lf
JOIN (
  SELECT source_key,snapshot_id,normalized_name
  FROM mma_active_fighters
  GROUP BY source_key,snapshot_id,normalized_name
  HAVING COUNT(*) = 1
) wq
  ON wq.source_key = lf.source_key
 AND wq.snapshot_id = lf.snapshot_id
 AND wq.normalized_name = lf.normalized_name
JOIN mma_completed_participants p
  ON p.source_key = lf.source_key
 AND p.snapshot_id = lf.snapshot_id
 AND p.source_fighter_id IS NULL
 AND p.normalized_name = lf.normalized_name
JOIN mma_completed_fights f
  ON f.source_key = p.source_key
 AND f.snapshot_id = p.snapshot_id
 AND f.source_fight_id = p.source_fight_id
LEFT JOIN mma_completed_participants o
  ON o.source_key = p.source_key
 AND o.snapshot_id = p.snapshot_id
 AND o.source_fight_id = p.source_fight_id
 AND o.side <> p.side;

-- Non-UFC history is only exposed for fighters who later reached the UFC.
CREATE VIEW IF NOT EXISTS mma_ufc_pre_ufc_history AS
SELECT h.*, fb.first_ufc_date
FROM mma_ufc_career_history h
JOIN mma_ufc_first_bout fb ON fb.fighter_id = h.fighter_id
WHERE h.event_date < fb.first_ufc_date
  AND LOWER(COALESCE(h.organization, '')) NOT LIKE '%ufc%'
  AND LOWER(COALESCE(h.organization, '')) NOT LIKE '%ultimate fighting championship%';
