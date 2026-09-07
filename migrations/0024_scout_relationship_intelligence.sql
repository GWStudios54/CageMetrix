PRAGMA foreign_keys = ON;

-- Scout AI 0.3 relationship intelligence.
-- Collapse the broad fight warehouse into one directional row per fighter/opponent
-- pair so relationship questions do not rescan raw participant history at runtime.
CREATE TABLE IF NOT EXISTS scout_relationship_index (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  opponent_source_fighter_id TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  fights INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  no_contests INTEGER NOT NULL DEFAULT 0,
  first_fight_date TEXT,
  last_fight_date TEXT,
  major_org_fights INTEGER NOT NULL DEFAULT 0,
  opponent_ufc_fighter_id INTEGER,
  opponent_ufc_name TEXT,
  opponent_first_ufc_date TEXT,
  wins_before_opponent_ufc INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key, snapshot_id, source_fighter_id, opponent_source_fighter_id)
);

CREATE INDEX IF NOT EXISTS idx_scout_relationship_fighter
  ON scout_relationship_index(source_key, snapshot_id, source_fighter_id);
CREATE INDEX IF NOT EXISTS idx_scout_relationship_opponent
  ON scout_relationship_index(source_key, snapshot_id, opponent_source_fighter_id);
CREATE INDEX IF NOT EXISTS idx_scout_relationship_future_ufc
  ON scout_relationship_index(wins_before_opponent_ufc DESC, source_fighter_id);

CREATE TABLE IF NOT EXISTS scout_relationship_summary (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  distinct_opponents INTEGER NOT NULL DEFAULT 0,
  ufc_linked_opponents INTEGER NOT NULL DEFAULT 0,
  future_ufc_opponents_beaten INTEGER NOT NULL DEFAULT 0,
  future_ufc_wins INTEGER NOT NULL DEFAULT 0,
  future_ufc_examples TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key, snapshot_id, source_fighter_id)
);

CREATE INDEX IF NOT EXISTS idx_scout_relationship_summary_future
  ON scout_relationship_summary(future_ufc_opponents_beaten DESC, future_ufc_wins DESC);

DELETE FROM scout_relationship_index;
DELETE FROM scout_relationship_summary;

INSERT OR REPLACE INTO scout_relationship_index (
  source_key,snapshot_id,source_fighter_id,fighter_name,
  opponent_source_fighter_id,opponent_name,
  fights,wins,losses,draws,no_contests,first_fight_date,last_fight_date,major_org_fights,
  opponent_ufc_fighter_id,opponent_ufc_name,opponent_first_ufc_date,wins_before_opponent_ufc,updated_at
)
SELECT
  p.source_key,p.snapshot_id,p.source_fighter_id,MAX(p.fighter_name),
  o.source_fighter_id,MAX(o.fighter_name),
  COUNT(*),
  SUM(CASE WHEN p.result='W' THEN 1 ELSE 0 END),
  SUM(CASE WHEN p.result='L' THEN 1 ELSE 0 END),
  SUM(CASE WHEN p.result='D' THEN 1 ELSE 0 END),
  SUM(CASE WHEN p.result='NC' THEN 1 ELSE 0 END),
  MIN(f.event_date),MAX(f.event_date),
  SUM(CASE WHEN f.is_major_org=1 THEN 1 ELSE 0 END),
  CAST(l.cagemetrix_fighter_id AS INTEGER),
  MAX(cf.name),
  MAX(fb.first_ufc_date),
  SUM(CASE WHEN p.result='W' AND fb.first_ufc_date IS NOT NULL AND f.event_date < fb.first_ufc_date THEN 1 ELSE 0 END),
  CURRENT_TIMESTAMP
FROM mma_fight_participants p
JOIN mma_source_registry r
  ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id
JOIN mma_fights f
  ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
JOIN mma_fight_participants o
  ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id
 AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
LEFT JOIN mma_identity_links l
  ON l.source_key=o.source_key AND l.source_fighter_id=o.source_fighter_id
 AND l.cagemetrix_fighter_id IS NOT NULL AND l.confidence>=0.90
LEFT JOIN fighters cf
  ON cf.id=CAST(l.cagemetrix_fighter_id AS INTEGER)
LEFT JOIN mma_ufc_first_bout fb
  ON fb.fighter_id=CAST(l.cagemetrix_fighter_id AS INTEGER)
WHERE p.source_fighter_id IS NOT NULL
  AND o.source_fighter_id IS NOT NULL
  AND f.outcome<>'unknown'
  AND f.event_date<=DATE('now')
GROUP BY p.source_key,p.snapshot_id,p.source_fighter_id,o.source_fighter_id,l.cagemetrix_fighter_id;

INSERT OR REPLACE INTO scout_relationship_summary (
  source_key,snapshot_id,source_fighter_id,fighter_name,
  distinct_opponents,ufc_linked_opponents,future_ufc_opponents_beaten,future_ufc_wins,
  future_ufc_examples,updated_at
)
SELECT
  source_key,snapshot_id,source_fighter_id,MAX(fighter_name),
  COUNT(*),
  SUM(CASE WHEN opponent_ufc_fighter_id IS NOT NULL THEN 1 ELSE 0 END),
  SUM(CASE WHEN wins_before_opponent_ufc>0 THEN 1 ELSE 0 END),
  SUM(wins_before_opponent_ufc),
  GROUP_CONCAT(CASE WHEN wins_before_opponent_ufc>0 THEN opponent_name END, ' | '),
  CURRENT_TIMESTAMP
FROM scout_relationship_index
GROUP BY source_key,snapshot_id,source_fighter_id;

DROP TRIGGER IF EXISTS trg_refresh_scout_relationship_index;
CREATE TRIGGER trg_refresh_scout_relationship_index
AFTER UPDATE OF active_snapshot_id ON mma_source_registry
WHEN NEW.active_snapshot_id IS NOT NULL
BEGIN
  DELETE FROM scout_relationship_index WHERE source_key=NEW.source_key;
  DELETE FROM scout_relationship_summary WHERE source_key=NEW.source_key;

  INSERT OR REPLACE INTO scout_relationship_index (
    source_key,snapshot_id,source_fighter_id,fighter_name,
    opponent_source_fighter_id,opponent_name,
    fights,wins,losses,draws,no_contests,first_fight_date,last_fight_date,major_org_fights,
    opponent_ufc_fighter_id,opponent_ufc_name,opponent_first_ufc_date,wins_before_opponent_ufc,updated_at
  )
  SELECT
    p.source_key,p.snapshot_id,p.source_fighter_id,MAX(p.fighter_name),
    o.source_fighter_id,MAX(o.fighter_name),
    COUNT(*),
    SUM(CASE WHEN p.result='W' THEN 1 ELSE 0 END),
    SUM(CASE WHEN p.result='L' THEN 1 ELSE 0 END),
    SUM(CASE WHEN p.result='D' THEN 1 ELSE 0 END),
    SUM(CASE WHEN p.result='NC' THEN 1 ELSE 0 END),
    MIN(f.event_date),MAX(f.event_date),
    SUM(CASE WHEN f.is_major_org=1 THEN 1 ELSE 0 END),
    CAST(l.cagemetrix_fighter_id AS INTEGER),
    MAX(cf.name),
    MAX(fb.first_ufc_date),
    SUM(CASE WHEN p.result='W' AND fb.first_ufc_date IS NOT NULL AND f.event_date < fb.first_ufc_date THEN 1 ELSE 0 END),
    CURRENT_TIMESTAMP
  FROM mma_fight_participants p
  JOIN mma_fights f
    ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
  JOIN mma_fight_participants o
    ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id
   AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
  LEFT JOIN mma_identity_links l
    ON l.source_key=o.source_key AND l.source_fighter_id=o.source_fighter_id
   AND l.cagemetrix_fighter_id IS NOT NULL AND l.confidence>=0.90
  LEFT JOIN fighters cf
    ON cf.id=CAST(l.cagemetrix_fighter_id AS INTEGER)
  LEFT JOIN mma_ufc_first_bout fb
    ON fb.fighter_id=CAST(l.cagemetrix_fighter_id AS INTEGER)
  WHERE p.source_key=NEW.source_key
    AND p.snapshot_id=NEW.active_snapshot_id
    AND p.source_fighter_id IS NOT NULL
    AND o.source_fighter_id IS NOT NULL
    AND f.outcome<>'unknown'
    AND f.event_date<=DATE('now')
  GROUP BY p.source_key,p.snapshot_id,p.source_fighter_id,o.source_fighter_id,l.cagemetrix_fighter_id;

  INSERT OR REPLACE INTO scout_relationship_summary (
    source_key,snapshot_id,source_fighter_id,fighter_name,
    distinct_opponents,ufc_linked_opponents,future_ufc_opponents_beaten,future_ufc_wins,
    future_ufc_examples,updated_at
  )
  SELECT
    source_key,snapshot_id,source_fighter_id,MAX(fighter_name),
    COUNT(*),
    SUM(CASE WHEN opponent_ufc_fighter_id IS NOT NULL THEN 1 ELSE 0 END),
    SUM(CASE WHEN wins_before_opponent_ufc>0 THEN 1 ELSE 0 END),
    SUM(wins_before_opponent_ufc),
    GROUP_CONCAT(CASE WHEN wins_before_opponent_ufc>0 THEN opponent_name END, ' | '),
    CURRENT_TIMESTAMP
  FROM scout_relationship_index
  WHERE source_key=NEW.source_key AND snapshot_id=NEW.active_snapshot_id
  GROUP BY source_key,snapshot_id,source_fighter_id;
END;
