PRAGMA foreign_keys = ON;

-- Public representation directory. Agency prestige is context only and never
-- contributes to Global Scout Rating or future Scout Score calculations.
CREATE TABLE IF NOT EXISTS management_agencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT,
  website_url TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_management_agencies_name
  ON management_agencies(name);

-- Historical, source-backed representation relationships. A fighter with no
-- row here is NOT assumed to be unmanaged. Current rows are unique per fighter.
CREATE TABLE IF NOT EXISTS fighter_management_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  agency_id INTEGER REFERENCES management_agencies(id) ON DELETE SET NULL,
  manager_name TEXT,
  started_at TEXT,
  ended_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'public_record',
  confidence TEXT NOT NULL DEFAULT 'C' CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  CHECK (agency_id IS NOT NULL OR manager_name IS NOT NULL),
  CHECK (source_url IS NOT NULL OR source_type='verified_profile')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fighter_management_one_current
  ON fighter_management_history(source_key,source_fighter_id)
  WHERE is_current=1;
CREATE INDEX IF NOT EXISTS idx_fighter_management_agency_current
  ON fighter_management_history(agency_id,is_current,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_fighter_management_fighter
  ON fighter_management_history(source_key,source_fighter_id,verified_at DESC);

-- Explicit opportunity/availability assertions. Missing rows and unknown
-- values stay unknown; MMA Scouts never converts missing evidence to a claim.
CREATE TABLE IF NOT EXISTS fighter_opportunity_status (
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  management_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (management_status IN ('unknown','represented','unmanaged')),
  contract_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (contract_status IN ('unknown','under_contract','free_agent','non_exclusive')),
  open_to_fights TEXT NOT NULL DEFAULT 'unknown'
    CHECK (open_to_fights IN ('unknown','yes','no')),
  open_to_management TEXT NOT NULL DEFAULT 'unknown'
    CHECK (open_to_management IN ('unknown','yes','no')),
  open_to_team TEXT NOT NULL DEFAULT 'unknown'
    CHECK (open_to_team IN ('unknown','yes','no')),
  preferred_weight_class TEXT,
  base_city TEXT,
  base_region TEXT,
  base_country TEXT,
  public_contact_url TEXT,
  availability_note TEXT,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'public_record',
  confidence TEXT NOT NULL DEFAULT 'C' CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_key,source_fighter_id),
  CHECK (
    (management_status='unknown' AND contract_status='unknown' AND open_to_fights='unknown' AND open_to_management='unknown' AND open_to_team='unknown')
    OR source_url IS NOT NULL
    OR source_type='verified_profile'
  )
);
CREATE INDEX IF NOT EXISTS idx_fighter_opportunity_management
  ON fighter_opportunity_status(management_status,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_fighter_opportunity_contract
  ON fighter_opportunity_status(contract_status,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_fighter_opportunity_open
  ON fighter_opportunity_status(open_to_fights,open_to_management,open_to_team);

DROP VIEW IF EXISTS scout_current_management;
CREATE VIEW scout_current_management AS
SELECT h.source_key,h.source_fighter_id,h.agency_id,a.slug agency_slug,a.name agency_name,
       a.website_url agency_website,h.manager_name,h.started_at,h.source_url,
       h.source_type,h.confidence,h.verified_at,h.last_checked_at
FROM fighter_management_history h
LEFT JOIN management_agencies a ON a.id=h.agency_id
WHERE h.is_current=1;
