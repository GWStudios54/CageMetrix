PRAGMA foreign_keys = ON;

-- Public professional contact evidence tied to one exact fighter identity.
-- These are business-facing channels deliberately published by a fighter,
-- manager, agency, team, promotion, or verified professional profile. They are
-- never inferred from private/personal data.
CREATE TABLE IF NOT EXISTS fighter_professional_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  contact_kind TEXT NOT NULL CHECK (contact_kind IN (
    'booking_email','management_email','professional_email','contact_form','professional_url'
  )),
  contact_value TEXT NOT NULL,
  label TEXT,
  publisher TEXT,
  source_url TEXT NOT NULL,
  source_title TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'fighter_direct','manager_or_agency_direct','team_direct','promotion_direct','verified_profile'
  )),
  confidence TEXT NOT NULL DEFAULT 'A' CHECK (confidence IN ('A','B','C')),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(source_key,source_fighter_id,contact_kind,contact_value,source_url)
);
CREATE INDEX IF NOT EXISTS idx_fighter_professional_contacts_current
  ON fighter_professional_contacts(source_key,source_fighter_id,is_current,verified_at DESC);

DROP VIEW IF EXISTS scout_current_fighter_contact;
CREATE VIEW scout_current_fighter_contact AS
WITH ranked AS (
  SELECT c.*,
         ROW_NUMBER() OVER (
           PARTITION BY c.source_key,c.source_fighter_id
           ORDER BY
             CASE c.contact_kind
               WHEN 'booking_email' THEN 1
               WHEN 'management_email' THEN 2
               WHEN 'professional_email' THEN 3
               WHEN 'contact_form' THEN 4
               WHEN 'professional_url' THEN 5
               ELSE 9
             END,
             CASE c.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
             c.verified_at DESC,c.id DESC
         ) rn
  FROM fighter_professional_contacts c
  WHERE c.is_current=1
)
SELECT source_key,source_fighter_id,contact_kind,contact_value,label,publisher,
       source_url,source_title,source_type,confidence,verified_at,last_checked_at
FROM ranked
WHERE rn=1;

-- Rebuild coverage so fighter-specific professional contact evidence outranks
-- an agency-wide route. A generic agency website remains display fallback only.
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
    WHEN fpc.contact_kind IN ('booking_email','management_email','professional_email') AND fpc.contact_value IS NOT NULL THEN 'mailto:'||fpc.contact_value
    WHEN fpc.contact_value IS NOT NULL THEN fpc.contact_value
    WHEN cm.agency_contact_kind IN ('booking_email','general_email') AND cm.agency_contact_value IS NOT NULL THEN 'mailto:'||cm.agency_contact_value
    WHEN cm.agency_contact_value IS NOT NULL THEN cm.agency_contact_value
    ELSE cm.agency_website
  END professional_contact_url,
  CASE
    WHEN o.public_contact_url IS NOT NULL THEN 'direct_public'
    WHEN fpc.contact_kind='booking_email' THEN 'fighter_booking_email'
    WHEN fpc.contact_kind='management_email' THEN 'fighter_management_email'
    WHEN fpc.contact_kind='professional_email' THEN 'fighter_professional_email'
    WHEN fpc.contact_kind='contact_form' THEN 'fighter_contact_form'
    WHEN fpc.contact_kind='professional_url' THEN 'fighter_professional_url'
    WHEN cm.agency_contact_kind='booking_email' THEN 'management_booking_email'
    WHEN cm.agency_contact_kind='general_email' THEN 'management_email'
    WHEN cm.agency_contact_kind='booking_form' THEN 'management_booking_form'
    WHEN cm.agency_contact_kind='contact_form' THEN 'management_contact_form'
    WHEN cm.agency_website IS NOT NULL THEN 'management_website'
    ELSE 'unknown'
  END professional_contact_kind,
  fpc.contact_kind fighter_contact_kind,fpc.contact_value fighter_contact_value,
  fpc.label fighter_contact_label,fpc.publisher fighter_contact_publisher,
  fpc.source_url fighter_contact_source_url,fpc.source_type fighter_contact_source_type,
  fpc.confidence fighter_contact_confidence,fpc.verified_at fighter_contact_verified_at,
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
    COALESCE(fpc.verified_at,''),
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
    (COALESCE(o.public_contact_url,fpc.contact_value,cm.agency_contact_value) IS NOT NULL)
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
    (COALESCE(o.public_contact_url,fpc.contact_value,cm.agency_contact_value) IS NOT NULL)
  )/17.0,1) intel_coverage_pct
FROM scout_active_global_profiles p
LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
LEFT JOIN scout_current_fighter_contact fpc ON fpc.source_key=p.source_key AND fpc.source_fighter_id=p.source_fighter_id
LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
LEFT JOIN scout_current_availability ca ON ca.source_key=p.source_key AND ca.source_fighter_id=p.source_fighter_id
LEFT JOIN scout_current_location cl ON cl.source_key=p.source_key AND cl.source_fighter_id=p.source_fighter_id
LEFT JOIN team_fact tf ON tf.source_key=p.source_key AND tf.source_fighter_id=p.source_fighter_id AND tf.rn=1
LEFT JOIN fact_counts fc ON fc.source_key=p.source_key AND fc.source_fighter_id=p.source_fighter_id
LEFT JOIN event_counts ec ON ec.source_key=p.source_key AND ec.source_fighter_id=p.source_fighter_id;

