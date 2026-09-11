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
