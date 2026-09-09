PRAGMA foreign_keys = ON;

-- Publicly reported contract events. Rows represent disclosed facts about a
-- deal/status transition; missing fields remain NULL and are never inferred.
CREATE TABLE IF NOT EXISTS fighter_contract_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  promotion_slug TEXT,
  promotion_name TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'signing','extension','renewal','renegotiation','bout_agreement',
    'option_exercised','option_declined','release','expiration','free_agency',
    'status_update','other'
  )),
  agreement_type TEXT NOT NULL DEFAULT 'unknown' CHECK (agreement_type IN (
    'unknown','multi_fight','single_fight','developmental','exclusive',
    'non_exclusive','tournament','short_notice','replacement'
  )),
  status_after TEXT NOT NULL DEFAULT 'unknown' CHECK (status_after IN (
    'unknown','under_contract','non_exclusive','free_agent','released','expired'
  )),
  signed_at TEXT,
  effective_at TEXT,
  reported_at TEXT,
  expires_at TEXT,
  fights_total INTEGER CHECK (fights_total IS NULL OR fights_total >= 0),
  fights_remaining_reported INTEGER CHECK (fights_remaining_reported IS NULL OR fights_remaining_reported >= 0),
  term_months INTEGER CHECK (term_months IS NULL OR term_months >= 0),
  exclusive TEXT NOT NULL DEFAULT 'unknown' CHECK (exclusive IN ('unknown','yes','no')),
  matching_rights TEXT NOT NULL DEFAULT 'unknown' CHECK (matching_rights IN ('unknown','yes','no')),
  champion_clause TEXT NOT NULL DEFAULT 'unknown' CHECK (champion_clause IN ('unknown','yes','no')),
  extension_option TEXT NOT NULL DEFAULT 'unknown' CHECK (extension_option IN ('unknown','yes','no')),
  guaranteed_pay_minor INTEGER CHECK (guaranteed_pay_minor IS NULL OR guaranteed_pay_minor >= 0),
  win_bonus_minor INTEGER CHECK (win_bonus_minor IS NULL OR win_bonus_minor >= 0),
  currency TEXT,
  disclosure_scope TEXT NOT NULL DEFAULT 'status_only' CHECK (disclosure_scope IN ('status_only','partial_terms','reported_terms')),
  public_summary TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contract_events_fighter
  ON fighter_contract_events(source_key,source_fighter_id,COALESCE(effective_at,reported_at) DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_contract_events_current
  ON fighter_contract_events(source_key,source_fighter_id,is_current,promotion_slug);
CREATE INDEX IF NOT EXISTS idx_contract_events_promotion
  ON fighter_contract_events(promotion_slug,status_after,reported_at DESC);

-- Every published contract event must have public evidence. Multiple sources
-- may support the same event without duplicating the contract record itself.
CREATE TABLE IF NOT EXISTS fighter_contract_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_event_id INTEGER NOT NULL REFERENCES fighter_contract_events(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  published_at TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'fighter_direct','manager_or_agency_direct','promotion_direct',
    'athletic_commission_record','court_record','verified_public_filing',
    'reputable_trade_reporting','reputable_interview',
    'secondary_reporting_with_attribution','archived_public_statement'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(contract_event_id,source_url)
);
CREATE INDEX IF NOT EXISTS idx_contract_evidence_event
  ON fighter_contract_evidence(contract_event_id,confidence,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_evidence_url
  ON fighter_contract_evidence(source_url);

-- Existing representation rows can now retain multiple corroborating public
-- sources instead of one URL. The history row remains the canonical relationship.
CREATE TABLE IF NOT EXISTS fighter_management_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  management_history_id INTEGER NOT NULL REFERENCES fighter_management_history(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  published_at TEXT,
  source_type TEXT NOT NULL DEFAULT 'public_record',
  confidence TEXT NOT NULL CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(management_history_id,source_url)
);
CREATE INDEX IF NOT EXISTS idx_management_evidence_history
  ON fighter_management_evidence(management_history_id,confidence,verified_at DESC);

-- Official/profile sources support MMA Scouts' original About summary for an
-- agency. These are not fighter-roster evidence unless the importer separately
-- registers the URL as a roster source.
CREATE TABLE IF NOT EXISTS management_agency_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id INTEGER NOT NULL REFERENCES management_agencies(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  source_type TEXT NOT NULL DEFAULT 'official_profile' CHECK (source_type IN ('official_profile','official_roster','official_services','public_record')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agency_id,source_url)
);
CREATE INDEX IF NOT EXISTS idx_management_agency_sources
  ON management_agency_sources(agency_id,source_type,verified_at DESC);

-- Automated crawlers may discover possible contract disclosures, but discovery
-- never equals publication. Candidates stay private until a source-backed event
-- is accepted into fighter_contract_events + fighter_contract_evidence.
CREATE TABLE IF NOT EXISTS contract_intel_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_key TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  published_at TEXT,
  source_type TEXT,
  fighter_name TEXT,
  normalized_name TEXT,
  source_key TEXT,
  source_fighter_id TEXT,
  promotion_slug TEXT,
  detected_event_type TEXT,
  detected_status TEXT,
  detected_summary TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'keyword',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','duplicate','needs_identity')),
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_contract_candidates_review
  ON contract_intel_candidates(review_status,discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_candidates_fighter
  ON contract_intel_candidates(source_key,source_fighter_id,review_status);

-- Preserve the evidence already collected by the management importer.
INSERT OR IGNORE INTO fighter_management_evidence(
  management_history_id,source_url,source_type,confidence,verified_at,last_checked_at,notes
)
SELECT id,source_url,source_type,confidence,verified_at,last_checked_at,
       'Backfilled from the original representation-history source.'
FROM fighter_management_history
WHERE source_url IS NOT NULL;

-- Backfill each agency's canonical official site as profile evidence.
INSERT OR IGNORE INTO management_agency_sources(agency_id,source_url,source_type,verified_at,last_checked_at)
SELECT id,website_url,'official_profile',COALESCE(verified_at,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP
FROM management_agencies
WHERE website_url IS NOT NULL;

DROP VIEW IF EXISTS scout_current_contracts;
CREATE VIEW scout_current_contracts AS
SELECT e.*,
       (SELECT ev.source_url FROM fighter_contract_evidence ev WHERE ev.contract_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) primary_source_url,
       (SELECT ev.source_title FROM fighter_contract_evidence ev WHERE ev.contract_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) primary_source_title,
       (SELECT ev.publisher FROM fighter_contract_evidence ev WHERE ev.contract_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) primary_publisher,
       (SELECT ev.confidence FROM fighter_contract_evidence ev WHERE ev.contract_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) evidence_grade
FROM fighter_contract_events e
WHERE e.is_current=1;
