PRAGMA foreign_keys = ON;

-- Materialized UFC-scoped slice of the broad MMA warehouse. This table exists to
-- keep expensive historical joins out of normal D1 queries. It may only contain
-- rows for fighters already present in CageMetrix's native UFC fighters table.
CREATE TABLE IF NOT EXISTS ufc_warehouse_career_rows (
  fighter_id INTEGER NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fight_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  organization TEXT,
  event_name TEXT,
  weight_class TEXT,
  is_major_org INTEGER NOT NULL DEFAULT 0,
  method_raw TEXT,
  method_normalized TEXT,
  method_detail TEXT,
  round_num INTEGER,
  time_finish_seconds INTEGER,
  result TEXT NOT NULL DEFAULT 'U',
  fighter_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  opponent_name TEXT,
  opponent_normalized_name TEXT,
  PRIMARY KEY (fighter_id, source_key, snapshot_id, source_fight_id)
);

CREATE INDEX IF NOT EXISTS idx_ufc_warehouse_career_fighter_date
  ON ufc_warehouse_career_rows(fighter_id, event_date);
CREATE INDEX IF NOT EXISTS idx_ufc_warehouse_career_org_date
  ON ufc_warehouse_career_rows(organization, event_date);

CREATE VIEW IF NOT EXISTS ufc_warehouse_pre_ufc_rows AS
SELECT h.*, fb.first_ufc_date
FROM ufc_warehouse_career_rows h
JOIN mma_ufc_first_bout fb ON fb.fighter_id = h.fighter_id
WHERE h.event_date < fb.first_ufc_date
  AND LOWER(COALESCE(h.organization, '')) NOT LIKE '%ufc%'
  AND LOWER(COALESCE(h.organization, '')) NOT LIKE '%ultimate fighting championship%';
