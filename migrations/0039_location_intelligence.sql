PRAGMA foreign_keys = ON;

-- Public professional-location evidence is stored separately from opportunity
-- assertions so a location refresh can never overwrite contract, availability,
-- management, or contact provenance.
CREATE TABLE IF NOT EXISTS fighter_location_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  location_kind TEXT NOT NULL CHECK (location_kind IN (
    'fighting_out_of','training_base','camp_location','hometown','other_professional'
  )),
  city TEXT,
  region TEXT,
  country TEXT,
  raw_value TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'fighter_direct','manager_or_agency_direct','promotion_direct',
    'athletic_commission_record','verified_public_filing',
    'reputable_trade_reporting','reputable_interview',
    'secondary_reporting_with_attribution','archived_public_statement'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('A','B','C')),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  CHECK (city IS NOT NULL OR region IS NOT NULL OR country IS NOT NULL OR trim(raw_value)<>''),
  UNIQUE(source_key,source_fighter_id,source_url,location_kind,raw_value)
);
CREATE INDEX IF NOT EXISTS idx_location_evidence_fighter
  ON fighter_location_evidence(source_key,source_fighter_id,is_current,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_evidence_kind
  ON fighter_location_evidence(location_kind,is_current,verified_at DESC);

DROP VIEW IF EXISTS scout_current_location;
CREATE VIEW scout_current_location AS
WITH ranked AS (
  SELECT e.*,
         ROW_NUMBER() OVER (
           PARTITION BY e.source_key,e.source_fighter_id
           ORDER BY
             CASE e.location_kind WHEN 'fighting_out_of' THEN 1 WHEN 'training_base' THEN 2 ELSE 3 END,
             CASE e.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
             e.verified_at DESC,e.id DESC
         ) rn
  FROM fighter_location_evidence e
  WHERE e.is_current=1
    AND e.location_kind IN ('fighting_out_of','training_base')
)
SELECT source_key,source_fighter_id,location_kind,city base_city,region base_region,country base_country,
       raw_value,source_url,source_title,publisher,source_type,confidence,verified_at,last_checked_at
FROM ranked
WHERE rn=1;

-- Rebuild coverage so explicit verified-profile base data wins as a complete
-- record; otherwise use source-backed professional location evidence. Official
-- team facts can fill a missing warehouse gym without mutating the warehouse.
DROP VIEW IF EXISTS scout_fighter_intel_coverage;
CREATE VIEW scout_fighter_intel_coverage AS
WITH fact_counts AS (
  SELECT source_key,source_fighter_id,
         COUNT(*) current_external_facts,
         MAX(verified_at) last_fact_verified_at
  FROM fighter_intel_facts
  WHERE is_current=1
  GROUP BY source_key,source_fighter_id
), event_counts AS (
  SELECT source_key,source_fighter_id,COUNT(*) intel_events,MAX(verified_at) last_event_verified_at
  FROM fighter_intel_events
  GROUP BY source_key,source_fighter_id
), team_fact AS (
  SELECT source_key,source_fighter_id,value_text team_name,verified_at team_verified_at,
         ROW_NUMBER() OVER (
           PARTITION BY source_key,source_fighter_id
           ORDER BY CASE confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,verified_at DESC,id DESC
         ) rn
  FROM fighter_intel_facts
  WHERE is_current=1 AND fact_key='team.primary' AND value_text IS NOT NULL AND trim(value_text)<>''
)
SELECT
  p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,
  p.dob,p.height_cm,p.reach_cm,p.stance,p.nationality,
  COALESCE(NULLIF(trim(p.gym),''),tf.team_name) gym,
  p.current_organization,p.current_promotion_slug,p.current_weight_class,
  p.career_start_date,p.last_fight_date,p.data_completeness,
  CASE WHEN cm.source_fighter_id IS NOT NULL THEN 'represented' ELSE COALESCE(o.management_status,'unknown') END management_status,
  cm.agency_slug,cm.agency_name,cm.manager_name,cm.confidence management_confidence,cm.verified_at management_verified_at,
  COALESCE(o.contract_status,'unknown') contract_status,
  COALESCE(o.open_to_fights,'unknown') open_to_fights,
  COALESCE(o.open_to_management,'unknown') open_to_management,
  COALESCE(o.open_to_team,'unknown') open_to_team,
  o.preferred_weight_class,
  CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_city ELSE cl.base_city END base_city,
  CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_region ELSE cl.base_region END base_region,
  CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_country ELSE cl.base_country END base_country,
  CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.source_url ELSE cl.source_url END base_source_url,
  CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.source_type ELSE cl.source_type END base_source_type,
  CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.confidence ELSE cl.confidence END base_confidence,
  CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.verified_at ELSE cl.verified_at END base_verified_at,
  o.public_contact_url,o.availability_note,
  o.confidence opportunity_confidence,o.verified_at opportunity_verified_at,
  COALESCE(fc.current_external_facts,0) current_external_facts,
  COALESCE(ec.intel_events,0) intel_events,
  MAX(
    COALESCE(fc.last_fact_verified_at,''),
    COALESCE(ec.last_event_verified_at,''),
    COALESCE(cm.verified_at,''),
    COALESCE(o.verified_at,''),
    COALESCE(cl.verified_at,''),
    COALESCE(tf.team_verified_at,'')
  ) last_intel_verified_at,
  (
    (p.dob IS NOT NULL) + (p.height_cm IS NOT NULL) + (p.reach_cm IS NOT NULL) + (p.stance IS NOT NULL) +
    (p.nationality IS NOT NULL) + (COALESCE(NULLIF(trim(p.gym),''),tf.team_name) IS NOT NULL) +
    (p.current_organization IS NOT NULL AND trim(p.current_organization)<>'') + (p.current_weight_class IS NOT NULL) +
    (p.career_start_date IS NOT NULL) + (p.last_fight_date IS NOT NULL) +
    (CASE WHEN cm.source_fighter_id IS NOT NULL OR COALESCE(o.management_status,'unknown')<>'unknown' THEN 1 ELSE 0 END) +
    (COALESCE(o.contract_status,'unknown')<>'unknown') +
    (COALESCE(o.open_to_fights,'unknown')<>'unknown') +
    (COALESCE(o.open_to_management,'unknown')<>'unknown') +
    (COALESCE(o.open_to_team,'unknown')<>'unknown') +
    (CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country,cl.base_city,cl.base_region,cl.base_country) IS NOT NULL THEN 1 ELSE 0 END) +
    (o.public_contact_url IS NOT NULL)
  ) known_intel_fields,
  ROUND(100.0*(
    (p.dob IS NOT NULL) + (p.height_cm IS NOT NULL) + (p.reach_cm IS NOT NULL) + (p.stance IS NOT NULL) +
    (p.nationality IS NOT NULL) + (COALESCE(NULLIF(trim(p.gym),''),tf.team_name) IS NOT NULL) +
    (p.current_organization IS NOT NULL AND trim(p.current_organization)<>'') + (p.current_weight_class IS NOT NULL) +
    (p.career_start_date IS NOT NULL) + (p.last_fight_date IS NOT NULL) +
    (CASE WHEN cm.source_fighter_id IS NOT NULL OR COALESCE(o.management_status,'unknown')<>'unknown' THEN 1 ELSE 0 END) +
    (COALESCE(o.contract_status,'unknown')<>'unknown') +
    (COALESCE(o.open_to_fights,'unknown')<>'unknown') +
    (COALESCE(o.open_to_management,'unknown')<>'unknown') +
    (COALESCE(o.open_to_team,'unknown')<>'unknown') +
    (CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country,cl.base_city,cl.base_region,cl.base_country) IS NOT NULL THEN 1 ELSE 0 END) +
    (o.public_contact_url IS NOT NULL)
  )/17.0,1) intel_coverage_pct
FROM scout_active_global_profiles p
LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
LEFT JOIN scout_current_location cl ON cl.source_key=p.source_key AND cl.source_fighter_id=p.source_fighter_id
LEFT JOIN team_fact tf ON tf.source_key=p.source_key AND tf.source_fighter_id=p.source_fighter_id AND tf.rn=1
LEFT JOIN fact_counts fc ON fc.source_key=p.source_key AND fc.source_fighter_id=p.source_fighter_id
LEFT JOIN event_counts ec ON ec.source_key=p.source_key AND ec.source_fighter_id=p.source_fighter_id;
