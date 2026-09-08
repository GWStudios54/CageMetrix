PRAGMA foreign_keys = ON;

-- Fighter-controlled publication status. Internal research records remain intact so
-- removals do not corrupt the fight graph, ratings history, provenance, or audits.
-- Public surfaces must use scout_public_global_profiles instead of the internal
-- scout_active_global_profiles view.
CREATE TABLE IF NOT EXISTS fighter_profile_removal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_slug TEXT NOT NULL,
  source_key TEXT,
  source_fighter_id TEXT,
  fighter_name TEXT NOT NULL,
  requester_role TEXT NOT NULL CHECK (requester_role IN ('fighter','authorized_representative')),
  requester_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  verification_url TEXT,
  reason TEXT,
  attested INTEGER NOT NULL DEFAULT 0 CHECK (attested IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  abuse_key_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_profile_removal_status
  ON fighter_profile_removal_requests(status,created_at);
CREATE INDEX IF NOT EXISTS idx_profile_removal_slug
  ON fighter_profile_removal_requests(profile_slug,created_at DESC);

CREATE TABLE IF NOT EXISTS fighter_publication_controls (
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  profile_slug_snapshot TEXT NOT NULL,
  public_status TEXT NOT NULL DEFAULT 'public' CHECK (public_status IN ('public','removed')),
  basis TEXT NOT NULL DEFAULT 'operator' CHECK (basis IN ('fighter_request','authorized_representative','operator','legal','other')),
  removal_request_id INTEGER REFERENCES fighter_profile_removal_requests(id),
  reason TEXT,
  effective_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_key,source_fighter_id)
);
CREATE INDEX IF NOT EXISTS idx_fighter_publication_status
  ON fighter_publication_controls(public_status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fighter_publication_slug
  ON fighter_publication_controls(profile_slug_snapshot);

DROP VIEW IF EXISTS scout_public_global_profiles;
CREATE VIEW scout_public_global_profiles AS
SELECT p.*
FROM scout_active_global_profiles p
LEFT JOIN fighter_publication_controls c
  ON c.source_key=p.source_key AND c.source_fighter_id=p.source_fighter_id
WHERE COALESCE(c.public_status,'public')='public';

-- Source objections are separate from fighter profile removal. A management company
-- does not control whether a fighter has a public MMA Scouts profile, but an access
-- or legal notice concerning the company's own website can pause collection from
-- that source without deleting independently sourced fighter facts.
CREATE TABLE IF NOT EXISTS intel_source_access_controls (
  source_slug TEXT PRIMARY KEY,
  collection_status TEXT NOT NULL DEFAULT 'active' CHECK (collection_status IN ('active','paused','legal_hold')),
  reason TEXT,
  notice_received_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Hard database guardrails: MMA Scouts stores public professional contact routes as
-- URLs only. Raw phone numbers, personal email addresses, street/home addresses, or
-- exact personal locations do not belong in the fighter-intel fact layer.
CREATE TRIGGER IF NOT EXISTS fighter_intel_private_contact_insert
BEFORE INSERT ON fighter_intel_facts
WHEN NEW.category='contact' AND (
  NEW.value_json IS NOT NULL OR
  NEW.value_text NOT LIKE 'https://%' OR
  lower(NEW.fact_key) LIKE '%phone%' OR
  lower(NEW.fact_key) LIKE '%email%' OR
  lower(NEW.fact_key) LIKE '%address%' OR
  lower(NEW.fact_key) LIKE '%private%' OR
  lower(NEW.fact_key) LIKE '%personal%'
)
BEGIN
  SELECT RAISE(ABORT,'private contact data is not allowed in fighter intelligence');
END;

CREATE TRIGGER IF NOT EXISTS fighter_intel_private_contact_update
BEFORE UPDATE ON fighter_intel_facts
WHEN NEW.category='contact' AND (
  NEW.value_json IS NOT NULL OR
  NEW.value_text NOT LIKE 'https://%' OR
  lower(NEW.fact_key) LIKE '%phone%' OR
  lower(NEW.fact_key) LIKE '%email%' OR
  lower(NEW.fact_key) LIKE '%address%' OR
  lower(NEW.fact_key) LIKE '%private%' OR
  lower(NEW.fact_key) LIKE '%personal%'
)
BEGIN
  SELECT RAISE(ABORT,'private contact data is not allowed in fighter intelligence');
END;

CREATE TRIGGER IF NOT EXISTS fighter_intel_exact_location_insert
BEFORE INSERT ON fighter_intel_facts
WHEN NEW.category='location' AND (
  lower(NEW.fact_key) LIKE '%address%' OR
  lower(NEW.fact_key) LIKE '%street%' OR
  lower(NEW.fact_key) LIKE '%home%' OR
  lower(NEW.fact_key) LIKE '%exact%' OR
  lower(NEW.fact_key) LIKE '%residence%'
)
BEGIN
  SELECT RAISE(ABORT,'street, home, residence, and exact-location data are not allowed');
END;

CREATE TRIGGER IF NOT EXISTS fighter_intel_exact_location_update
BEFORE UPDATE ON fighter_intel_facts
WHEN NEW.category='location' AND (
  lower(NEW.fact_key) LIKE '%address%' OR
  lower(NEW.fact_key) LIKE '%street%' OR
  lower(NEW.fact_key) LIKE '%home%' OR
  lower(NEW.fact_key) LIKE '%exact%' OR
  lower(NEW.fact_key) LIKE '%residence%'
)
BEGIN
  SELECT RAISE(ABORT,'street, home, residence, and exact-location data are not allowed');
END;

CREATE TRIGGER IF NOT EXISTS fighter_opportunity_contact_insert
BEFORE INSERT ON fighter_opportunity_status
WHEN NEW.public_contact_url IS NOT NULL AND NEW.public_contact_url<>'' AND NEW.public_contact_url NOT LIKE 'https://%'
BEGIN
  SELECT RAISE(ABORT,'professional contact must be an https URL');
END;

CREATE TRIGGER IF NOT EXISTS fighter_opportunity_contact_update
BEFORE UPDATE OF public_contact_url ON fighter_opportunity_status
WHEN NEW.public_contact_url IS NOT NULL AND NEW.public_contact_url<>'' AND NEW.public_contact_url NOT LIKE 'https://%'
BEGIN
  SELECT RAISE(ABORT,'professional contact must be an https URL');
END;
