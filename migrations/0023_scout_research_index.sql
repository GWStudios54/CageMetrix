PRAGMA foreign_keys = ON;

-- Scout AI needs broad MMA discovery without rescanning the full warehouse on
-- every request. Materialize one compact row per warehouse fighter and refresh
-- it whenever an imported source switches to a new active snapshot.
CREATE TABLE IF NOT EXISTS scout_fighter_index (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  dob TEXT,
  nationality TEXT,
  gym TEXT,
  last_fight_date TEXT,
  last_organization TEXT,
  last_weight_class TEXT,
  career_bouts INTEGER NOT NULL DEFAULT 0,
  career_wins INTEGER NOT NULL DEFAULT 0,
  career_losses INTEGER NOT NULL DEFAULT 0,
  career_draws INTEGER NOT NULL DEFAULT 0,
  career_no_contests INTEGER NOT NULL DEFAULT 0,
  career_finishes INTEGER NOT NULL DEFAULT 0,
  career_major_org_bouts INTEGER NOT NULL DEFAULT 0,
  recent_bouts_730d INTEGER NOT NULL DEFAULT 0,
  recent_wins_730d INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key, snapshot_id, source_fighter_id)
);

CREATE INDEX IF NOT EXISTS idx_scout_fighter_recent
  ON scout_fighter_index(last_fight_date DESC, career_wins DESC);
CREATE INDEX IF NOT EXISTS idx_scout_fighter_weight
  ON scout_fighter_index(last_weight_class, last_fight_date DESC);
CREATE INDEX IF NOT EXISTS idx_scout_fighter_name
  ON scout_fighter_index(normalized_name);

DELETE FROM scout_fighter_index;

INSERT OR REPLACE INTO scout_fighter_index (
  source_key,snapshot_id,source_fighter_id,fighter_name,normalized_name,dob,nationality,gym,
  last_fight_date,last_organization,last_weight_class,
  career_bouts,career_wins,career_losses,career_draws,career_no_contests,career_finishes,
  career_major_org_bouts,recent_bouts_730d,recent_wins_730d,updated_at
)
SELECT
  c.source_key,c.snapshot_id,c.source_fighter_id,c.fighter_name,c.normalized_name,c.dob,c.nationality,c.gym,
  c.last_fight_date,l.organization,l.weight_class,
  c.career_bouts,c.career_wins,c.career_losses,c.career_draws,c.career_no_contests,c.career_finishes,
  c.career_major_org_bouts,c.recent_bouts_730d,c.recent_wins_730d,CURRENT_TIMESTAMP
FROM (
  SELECT
    p.source_key,p.snapshot_id,p.source_fighter_id,
    MAX(mf.fighter_name) AS fighter_name,
    MAX(mf.normalized_name) AS normalized_name,
    MAX(mf.dob) AS dob,
    MAX(mf.nationality) AS nationality,
    MAX(mf.gym) AS gym,
    MAX(f.event_date) AS last_fight_date,
    COUNT(*) AS career_bouts,
    SUM(CASE WHEN p.result='W' THEN 1 ELSE 0 END) AS career_wins,
    SUM(CASE WHEN p.result='L' THEN 1 ELSE 0 END) AS career_losses,
    SUM(CASE WHEN p.result='D' THEN 1 ELSE 0 END) AS career_draws,
    SUM(CASE WHEN p.result='NC' THEN 1 ELSE 0 END) AS career_no_contests,
    SUM(CASE WHEN p.result='W' AND LOWER(COALESCE(f.method_normalized,f.method_raw,'')) NOT LIKE '%decision%' THEN 1 ELSE 0 END) AS career_finishes,
    SUM(CASE WHEN f.is_major_org=1 THEN 1 ELSE 0 END) AS career_major_org_bouts,
    SUM(CASE WHEN f.event_date>=DATE('now','-730 days') THEN 1 ELSE 0 END) AS recent_bouts_730d,
    SUM(CASE WHEN f.event_date>=DATE('now','-730 days') AND p.result='W' THEN 1 ELSE 0 END) AS recent_wins_730d
  FROM mma_fight_participants p
  JOIN mma_source_registry r
    ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id
  JOIN mma_fights f
    ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
  JOIN mma_fighters mf
    ON mf.source_key=p.source_key AND mf.snapshot_id=p.snapshot_id AND mf.source_fighter_id=p.source_fighter_id
  WHERE p.source_fighter_id IS NOT NULL
    AND f.outcome<>'unknown'
    AND f.event_date<=DATE('now')
  GROUP BY p.source_key,p.snapshot_id,p.source_fighter_id
) c
LEFT JOIN (
  SELECT source_key,snapshot_id,source_fighter_id,organization,weight_class,event_date
  FROM (
    SELECT
      p.source_key,p.snapshot_id,p.source_fighter_id,f.organization,f.weight_class,f.event_date,
      ROW_NUMBER() OVER (
        PARTITION BY p.source_key,p.snapshot_id,p.source_fighter_id
        ORDER BY f.event_date DESC,f.source_fight_id DESC
      ) AS rn
    FROM mma_fight_participants p
    JOIN mma_source_registry r
      ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id
    JOIN mma_fights f
      ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
    WHERE p.source_fighter_id IS NOT NULL
      AND f.outcome<>'unknown'
      AND f.event_date<=DATE('now')
  ) ranked
  WHERE rn=1
) l
  ON l.source_key=c.source_key AND l.snapshot_id=c.snapshot_id AND l.source_fighter_id=c.source_fighter_id;

DROP TRIGGER IF EXISTS trg_refresh_scout_fighter_index;
CREATE TRIGGER trg_refresh_scout_fighter_index
AFTER UPDATE OF active_snapshot_id ON mma_source_registry
WHEN NEW.active_snapshot_id IS NOT NULL
BEGIN
  DELETE FROM scout_fighter_index WHERE source_key=NEW.source_key;

  INSERT OR REPLACE INTO scout_fighter_index (
    source_key,snapshot_id,source_fighter_id,fighter_name,normalized_name,dob,nationality,gym,
    last_fight_date,last_organization,last_weight_class,
    career_bouts,career_wins,career_losses,career_draws,career_no_contests,career_finishes,
    career_major_org_bouts,recent_bouts_730d,recent_wins_730d,updated_at
  )
  SELECT
    c.source_key,c.snapshot_id,c.source_fighter_id,c.fighter_name,c.normalized_name,c.dob,c.nationality,c.gym,
    c.last_fight_date,l.organization,l.weight_class,
    c.career_bouts,c.career_wins,c.career_losses,c.career_draws,c.career_no_contests,c.career_finishes,
    c.career_major_org_bouts,c.recent_bouts_730d,c.recent_wins_730d,CURRENT_TIMESTAMP
  FROM (
    SELECT
      p.source_key,p.snapshot_id,p.source_fighter_id,
      MAX(mf.fighter_name) AS fighter_name,
      MAX(mf.normalized_name) AS normalized_name,
      MAX(mf.dob) AS dob,
      MAX(mf.nationality) AS nationality,
      MAX(mf.gym) AS gym,
      MAX(f.event_date) AS last_fight_date,
      COUNT(*) AS career_bouts,
      SUM(CASE WHEN p.result='W' THEN 1 ELSE 0 END) AS career_wins,
      SUM(CASE WHEN p.result='L' THEN 1 ELSE 0 END) AS career_losses,
      SUM(CASE WHEN p.result='D' THEN 1 ELSE 0 END) AS career_draws,
      SUM(CASE WHEN p.result='NC' THEN 1 ELSE 0 END) AS career_no_contests,
      SUM(CASE WHEN p.result='W' AND LOWER(COALESCE(f.method_normalized,f.method_raw,'')) NOT LIKE '%decision%' THEN 1 ELSE 0 END) AS career_finishes,
      SUM(CASE WHEN f.is_major_org=1 THEN 1 ELSE 0 END) AS career_major_org_bouts,
      SUM(CASE WHEN f.event_date>=DATE('now','-730 days') THEN 1 ELSE 0 END) AS recent_bouts_730d,
      SUM(CASE WHEN f.event_date>=DATE('now','-730 days') AND p.result='W' THEN 1 ELSE 0 END) AS recent_wins_730d
    FROM mma_fight_participants p
    JOIN mma_fights f
      ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
    JOIN mma_fighters mf
      ON mf.source_key=p.source_key AND mf.snapshot_id=p.snapshot_id AND mf.source_fighter_id=p.source_fighter_id
    WHERE p.source_key=NEW.source_key
      AND p.snapshot_id=NEW.active_snapshot_id
      AND p.source_fighter_id IS NOT NULL
      AND f.outcome<>'unknown'
      AND f.event_date<=DATE('now')
    GROUP BY p.source_key,p.snapshot_id,p.source_fighter_id
  ) c
  LEFT JOIN (
    SELECT source_key,snapshot_id,source_fighter_id,organization,weight_class,event_date
    FROM (
      SELECT
        p.source_key,p.snapshot_id,p.source_fighter_id,f.organization,f.weight_class,f.event_date,
        ROW_NUMBER() OVER (
          PARTITION BY p.source_key,p.snapshot_id,p.source_fighter_id
          ORDER BY f.event_date DESC,f.source_fight_id DESC
        ) AS rn
      FROM mma_fight_participants p
      JOIN mma_fights f
        ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
      WHERE p.source_key=NEW.source_key
        AND p.snapshot_id=NEW.active_snapshot_id
        AND p.source_fighter_id IS NOT NULL
        AND f.outcome<>'unknown'
        AND f.event_date<=DATE('now')
    ) ranked
    WHERE rn=1
  ) l
    ON l.source_key=c.source_key AND l.snapshot_id=c.snapshot_id AND l.source_fighter_id=c.source_fighter_id;
END;
