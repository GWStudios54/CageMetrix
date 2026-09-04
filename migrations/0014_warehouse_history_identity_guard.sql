PRAGMA foreign_keys = ON;

-- Forward correction for databases that may already have applied 0013 before the
-- stricter unresolved-participant guard was added. Rebuild only the dependent
-- history views; no stored warehouse or production UFC data is deleted.

DROP VIEW IF EXISTS mma_ufc_pre_ufc_history;
DROP VIEW IF EXISTS mma_ufc_career_history;

CREATE VIEW mma_ufc_career_history AS
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

CREATE VIEW mma_ufc_pre_ufc_history AS
SELECT h.*, fb.first_ufc_date
FROM mma_ufc_career_history h
JOIN mma_ufc_first_bout fb ON fb.fighter_id = h.fighter_id
WHERE h.event_date < fb.first_ufc_date
  AND LOWER(COALESCE(h.organization, '')) NOT LIKE '%ufc%'
  AND LOWER(COALESCE(h.organization, '')) NOT LIKE '%ultimate fighting championship%';
