PRAGMA foreign_keys = ON;

-- Source-backed professional scouting intelligence. This layer intentionally
-- excludes private personal data. Public professional contact routes are
-- allowed; private phone numbers, home addresses and inferred contract or
-- representation claims are not.
CREATE TABLE IF NOT EXISTS fighter_intel_sources (
  source_slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('warehouse','official_promotion','official_management','official_team','fighter_public','commission','credible_media','verified_profile','other_public')),
  base_url TEXT,
  official INTEGER NOT NULL DEFAULT 0 CHECK (official IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes TEXT,
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO fighter_intel_sources(source_slug,name,source_kind,official,priority,notes) VALUES
('mma-master','MMA Scouts global fight warehouse','warehouse',0,80,'Structured fight, profile and career data already normalized into the MMA Scouts warehouse.'),
('management-rosters','Official management agency rosters','official_management',1,100,'Agency roster evidence imported by the management sync.'),
('promotion-sites','Official promotion websites','official_promotion',1,95,'Official promotion rosters, releases and event pages.'),
('team-sites','Official team and gym websites','official_team',1,95,'Public professional team and coaching information.'),
('fighter-public','Fighter public professional channels','fighter_public',1,90,'Public professional statements and profile links explicitly published by the fighter.'),
('commissions','Athletic commissions and public bout records','commission',1,95,'Public regulatory bout, licensing and event records where available.'),
('credible-media','Credible MMA media','credible_media',0,70,'Secondary reporting used for career movement only when a primary source is unavailable.'),
('verified-profile','MMA Scouts verified profile submissions','verified_profile',1,100,'Information explicitly verified by the fighter or authorized representative.');

CREATE TABLE IF NOT EXISTS fighter_intel_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('identity','physical','career','team','management','contract','availability','contact','credential','media','location','other')),
  fact_key TEXT NOT NULL,
  value_text TEXT,
  value_json TEXT,
  effective_at TEXT,
  ended_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  source_slug TEXT REFERENCES fighter_intel_sources(source_slug),
  source_url TEXT,
  source_type TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'C' CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  CHECK (value_text IS NOT NULL OR value_json IS NOT NULL),
  CHECK (source_url IS NOT NULL OR source_type IN ('warehouse','verified_profile','derived_warehouse'))
);
CREATE INDEX IF NOT EXISTS idx_fighter_intel_fact_fighter
  ON fighter_intel_facts(source_key,source_fighter_id,is_current,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_fighter_intel_fact_key
  ON fighter_intel_facts(fact_key,is_current,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_fighter_intel_fact_source
  ON fighter_intel_facts(source_slug,is_current,last_checked_at DESC);

CREATE TABLE IF NOT EXISTS fighter_intel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('fight','promotion_change','weight_change','team_change','management_change','contract_change','availability','credential','career_note','media')),
  title TEXT NOT NULL,
  summary TEXT,
  occurred_at TEXT,
  source_slug TEXT REFERENCES fighter_intel_sources(source_slug),
  source_url TEXT,
  source_type TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'C' CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_url IS NOT NULL OR source_type IN ('warehouse','verified_profile','derived_warehouse'))
);
CREATE INDEX IF NOT EXISTS idx_fighter_intel_event_fighter
  ON fighter_intel_events(source_key,source_fighter_id,occurred_at DESC,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_fighter_intel_event_type
  ON fighter_intel_events(event_type,occurred_at DESC);

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
)
SELECT
  p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,
  p.dob,p.height_cm,p.reach_cm,p.stance,p.nationality,p.gym,
  p.current_organization,p.current_promotion_slug,p.current_weight_class,
  p.career_start_date,p.last_fight_date,p.data_completeness,
  CASE WHEN cm.source_fighter_id IS NOT NULL THEN 'represented' ELSE COALESCE(o.management_status,'unknown') END management_status,
  cm.agency_slug,cm.agency_name,cm.manager_name,cm.confidence management_confidence,cm.verified_at management_verified_at,
  COALESCE(o.contract_status,'unknown') contract_status,
  COALESCE(o.open_to_fights,'unknown') open_to_fights,
  COALESCE(o.open_to_management,'unknown') open_to_management,
  COALESCE(o.open_to_team,'unknown') open_to_team,
  o.preferred_weight_class,o.base_city,o.base_region,o.base_country,o.public_contact_url,o.availability_note,
  o.confidence opportunity_confidence,o.verified_at opportunity_verified_at,
  COALESCE(fc.current_external_facts,0) current_external_facts,
  COALESCE(ec.intel_events,0) intel_events,
  MAX(COALESCE(fc.last_fact_verified_at,''),COALESCE(ec.last_event_verified_at,''),COALESCE(cm.verified_at,''),COALESCE(o.verified_at,'')) last_intel_verified_at,
  (
    (p.dob IS NOT NULL) + (p.height_cm IS NOT NULL) + (p.reach_cm IS NOT NULL) + (p.stance IS NOT NULL) +
    (p.nationality IS NOT NULL) + (p.gym IS NOT NULL AND trim(p.gym)<>'') +
    (p.current_organization IS NOT NULL AND trim(p.current_organization)<>'') + (p.current_weight_class IS NOT NULL) +
    (p.career_start_date IS NOT NULL) + (p.last_fight_date IS NOT NULL) +
    (CASE WHEN cm.source_fighter_id IS NOT NULL OR COALESCE(o.management_status,'unknown')<>'unknown' THEN 1 ELSE 0 END) +
    (COALESCE(o.contract_status,'unknown')<>'unknown') +
    (COALESCE(o.open_to_fights,'unknown')<>'unknown') +
    (COALESCE(o.open_to_management,'unknown')<>'unknown') +
    (COALESCE(o.open_to_team,'unknown')<>'unknown') +
    (COALESCE(o.base_country,o.base_city) IS NOT NULL) +
    (o.public_contact_url IS NOT NULL)
  ) known_intel_fields,
  ROUND(100.0*(
    (p.dob IS NOT NULL) + (p.height_cm IS NOT NULL) + (p.reach_cm IS NOT NULL) + (p.stance IS NOT NULL) +
    (p.nationality IS NOT NULL) + (p.gym IS NOT NULL AND trim(p.gym)<>'') +
    (p.current_organization IS NOT NULL AND trim(p.current_organization)<>'') + (p.current_weight_class IS NOT NULL) +
    (p.career_start_date IS NOT NULL) + (p.last_fight_date IS NOT NULL) +
    (CASE WHEN cm.source_fighter_id IS NOT NULL OR COALESCE(o.management_status,'unknown')<>'unknown' THEN 1 ELSE 0 END) +
    (COALESCE(o.contract_status,'unknown')<>'unknown') +
    (COALESCE(o.open_to_fights,'unknown')<>'unknown') +
    (COALESCE(o.open_to_management,'unknown')<>'unknown') +
    (COALESCE(o.open_to_team,'unknown')<>'unknown') +
    (COALESCE(o.base_country,o.base_city) IS NOT NULL) +
    (o.public_contact_url IS NOT NULL)
  )/17.0,1) intel_coverage_pct
FROM scout_active_global_profiles p
LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
LEFT JOIN fact_counts fc ON fc.source_key=p.source_key AND fc.source_fighter_id=p.source_fighter_id
LEFT JOIN event_counts ec ON ec.source_key=p.source_key AND ec.source_fighter_id=p.source_fighter_id;
