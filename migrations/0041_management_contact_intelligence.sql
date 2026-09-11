PRAGMA foreign_keys = ON;

-- Public professional contact routes for management agencies. These rows are
-- evidence-backed contact channels, not fighter-direct contact claims.
CREATE TABLE IF NOT EXISTS management_agency_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id INTEGER NOT NULL REFERENCES management_agencies(id) ON DELETE CASCADE,
  contact_kind TEXT NOT NULL CHECK (contact_kind IN (
    'booking_email','general_email','booking_form','contact_form'
  )),
  contact_value TEXT NOT NULL,
  label TEXT,
  source_url TEXT NOT NULL,
  source_title TEXT,
  source_type TEXT NOT NULL DEFAULT 'official_profile'
    CHECK (source_type IN ('official_profile','official_services','official_contact')),
  confidence TEXT NOT NULL DEFAULT 'A' CHECK (confidence IN ('A','B','C')),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(agency_id,contact_kind,contact_value,source_url)
);
CREATE INDEX IF NOT EXISTS idx_management_contacts_agency
  ON management_agency_contacts(agency_id,is_current,verified_at DESC);

DROP VIEW IF EXISTS scout_primary_management_contact;
CREATE VIEW scout_primary_management_contact AS
WITH ranked AS (
  SELECT c.*,
         ROW_NUMBER() OVER (
           PARTITION BY c.agency_id
           ORDER BY
             CASE c.contact_kind
               WHEN 'booking_email' THEN 1
               WHEN 'booking_form' THEN 2
               WHEN 'general_email' THEN 3
               WHEN 'contact_form' THEN 4
               ELSE 9
             END,
             CASE c.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
             c.verified_at DESC,c.id DESC
         ) rn
  FROM management_agency_contacts c
  WHERE c.is_current=1
)
SELECT agency_id,contact_kind,contact_value,label,source_url,source_title,
       source_type,confidence,verified_at,last_checked_at
FROM ranked
WHERE rn=1;

DROP VIEW IF EXISTS scout_current_management;
CREATE VIEW scout_current_management AS
SELECT h.source_key,h.source_fighter_id,h.agency_id,a.slug agency_slug,a.name agency_name,
       a.website_url agency_website,
       c.contact_kind agency_contact_kind,
       c.contact_value agency_contact_value,
       c.label agency_contact_label,
       c.source_url agency_contact_source_url,
       c.confidence agency_contact_confidence,
       c.verified_at agency_contact_verified_at,
       h.manager_name,h.started_at,h.source_url,
       h.source_type,h.confidence,h.verified_at,h.last_checked_at
FROM fighter_management_history h
LEFT JOIN management_agencies a ON a.id=h.agency_id
LEFT JOIN scout_primary_management_contact c ON c.agency_id=a.id
WHERE h.is_current=1;

-- Rebuild fighter intelligence coverage so verified public management contact
-- evidence outranks a generic agency website while fighter-direct contact still wins.
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
  CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.open_to_fights ELSE COALESCE(ca.open_to_fights,'unknown') END open_to_fights,
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
  o.public_contact_url,
  CASE
    WHEN o.public_contact_url IS NOT NULL THEN o.public_contact_url
    WHEN cm.agency_contact_kind IN ('booking_email','general_email') AND cm.agency_contact_value IS NOT NULL THEN 'mailto:'||cm.agency_contact_value
    WHEN cm.agency_contact_value IS NOT NULL THEN cm.agency_contact_value
    ELSE cm.agency_website
  END professional_contact_url,
  CASE
    WHEN o.public_contact_url IS NOT NULL THEN 'direct_public'
    WHEN cm.agency_contact_kind='booking_email' THEN 'management_booking_email'
    WHEN cm.agency_contact_kind='general_email' THEN 'management_email'
    WHEN cm.agency_contact_kind='booking_form' THEN 'management_booking_form'
    WHEN cm.agency_contact_kind='contact_form' THEN 'management_contact_form'
    WHEN cm.agency_website IS NOT NULL THEN 'management_website'
    ELSE 'unknown'
  END professional_contact_kind,
  cm.agency_contact_kind,cm.agency_contact_value,cm.agency_contact_label,
  cm.agency_contact_source_url,cm.agency_contact_confidence,cm.agency_contact_verified_at,
  o.availability_note,
  o.confidence opportunity_confidence,o.verified_at opportunity_verified_at,
  CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.source_url ELSE ca.source_url END availability_source_url,
  CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.source_type ELSE ca.source_type END availability_source_type,
  CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.confidence ELSE ca.confidence END availability_confidence,
  CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.verified_at ELSE ca.verified_at END availability_verified_at,
  COALESCE(fc.current_external_facts,0) current_external_facts,
  COALESCE(ec.intel_events,0) intel_events,
  MAX(
    COALESCE(fc.last_fact_verified_at,''),
    COALESCE(ec.last_event_verified_at,''),
    COALESCE(cm.verified_at,''),
    COALESCE(cm.agency_contact_verified_at,''),
    COALESCE(o.verified_at,''),
    COALESCE(cl.verified_at,''),
    COALESCE(ca.verified_at,''),
    COALESCE(tf.team_verified_at,'')
  ) last_intel_verified_at,
  (
    (p.dob IS NOT NULL) + (p.height_cm IS NOT NULL) + (p.reach_cm IS NOT NULL) + (p.stance IS NOT NULL) +
    (p.nationality IS NOT NULL) + (COALESCE(NULLIF(trim(p.gym),''),tf.team_name) IS NOT NULL) +
    (p.current_organization IS NOT NULL AND trim(p.current_organization)<>'') + (p.current_weight_class IS NOT NULL) +
    (p.career_start_date IS NOT NULL) + (p.last_fight_date IS NOT NULL) +
    (CASE WHEN cm.source_fighter_id IS NOT NULL OR COALESCE(o.management_status,'unknown')<>'unknown' THEN 1 ELSE 0 END) +
    (COALESCE(o.contract_status,'unknown')<>'unknown') +
    (CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN 1 WHEN COALESCE(ca.open_to_fights,'unknown')<>'unknown' THEN 1 ELSE 0 END) +
    (COALESCE(o.open_to_management,'unknown')<>'unknown') +
    (COALESCE(o.open_to_team,'unknown')<>'unknown') +
    (CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country,cl.base_city,cl.base_region,cl.base_country) IS NOT NULL THEN 1 ELSE 0 END) +
    (COALESCE(o.public_contact_url,cm.agency_contact_value,cm.agency_website) IS NOT NULL)
  ) known_intel_fields,
  ROUND(100.0*(
    (p.dob IS NOT NULL) + (p.height_cm IS NOT NULL) + (p.reach_cm IS NOT NULL) + (p.stance IS NOT NULL) +
    (p.nationality IS NOT NULL) + (COALESCE(NULLIF(trim(p.gym),''),tf.team_name) IS NOT NULL) +
    (p.current_organization IS NOT NULL AND trim(p.current_organization)<>'') + (p.current_weight_class IS NOT NULL) +
    (p.career_start_date IS NOT NULL) + (p.last_fight_date IS NOT NULL) +
    (CASE WHEN cm.source_fighter_id IS NOT NULL OR COALESCE(o.management_status,'unknown')<>'unknown' THEN 1 ELSE 0 END) +
    (COALESCE(o.contract_status,'unknown')<>'unknown') +
    (CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN 1 WHEN COALESCE(ca.open_to_fights,'unknown')<>'unknown' THEN 1 ELSE 0 END) +
    (COALESCE(o.open_to_management,'unknown')<>'unknown') +
    (COALESCE(o.open_to_team,'unknown')<>'unknown') +
    (CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country,cl.base_city,cl.base_region,cl.base_country) IS NOT NULL THEN 1 ELSE 0 END) +
    (COALESCE(o.public_contact_url,cm.agency_contact_value,cm.agency_website) IS NOT NULL)
  )/17.0,1) intel_coverage_pct
FROM scout_active_global_profiles p
LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
LEFT JOIN scout_current_availability ca ON ca.source_key=p.source_key AND ca.source_fighter_id=p.source_fighter_id
LEFT JOIN scout_current_location cl ON cl.source_key=p.source_key AND cl.source_fighter_id=p.source_fighter_id
LEFT JOIN team_fact tf ON tf.source_key=p.source_key AND tf.source_fighter_id=p.source_fighter_id AND tf.rn=1
LEFT JOIN fact_counts fc ON fc.source_key=p.source_key AND fc.source_fighter_id=p.source_fighter_id
LEFT JOIN event_counts ec ON ec.source_key=p.source_key AND ec.source_fighter_id=p.source_fighter_id;
