PRAGMA foreign_keys = ON;

-- Publicly reported injury/withdrawal history: a fighter pulling out of a booked bout, a disclosed
-- injury, a medical clearance to return, or a replacement being announced for their spot. Distinct
-- from fighter_availability_evidence (migrations/0040), which tracks a generic yes/no "open to
-- booking" signal from any source for any reason -- this is the structured, dated, evidence-backed
-- history of *why*, mirroring fighter_camp_history/fighter_contract_events in shape. Unlike
-- anti-doping, this is a routine, non-stigmatizing part of a fighting career (most fighters get hurt
-- at some point), so it keeps the same source_type='verified_profile' bypass contract/camp/management
-- allow, rather than anti-doping's stricter no-bypass rule.
CREATE TABLE IF NOT EXISTS fighter_injury_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'withdrawal','injury_disclosed','cleared_to_compete','replacement_announced'
  )),
  injury_description TEXT,
  affected_event TEXT,
  opponent_name TEXT,
  effective_at TEXT,
  reported_at TEXT,
  expected_return_at TEXT,
  public_summary TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'reputable_trade_reporting',
  confidence TEXT NOT NULL DEFAULT 'C' CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_url IS NOT NULL OR source_type='verified_profile')
);
CREATE INDEX IF NOT EXISTS idx_injury_events_fighter
  ON fighter_injury_events(source_key,source_fighter_id,COALESCE(effective_at,reported_at) DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_injury_events_current
  ON fighter_injury_events(source_key,source_fighter_id,is_current);

-- Every published event can retain multiple corroborating public sources, same as
-- fighter_camp_evidence/fighter_antidoping_evidence.
CREATE TABLE IF NOT EXISTS fighter_injury_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  injury_event_id INTEGER NOT NULL REFERENCES fighter_injury_events(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  published_at TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'fighter_direct','coach_or_camp_direct','promotion_direct',
    'reputable_trade_reporting','reputable_interview',
    'secondary_reporting_with_attribution','archived_public_statement'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(injury_event_id,source_url)
);
CREATE INDEX IF NOT EXISTS idx_injury_evidence_event
  ON fighter_injury_evidence(injury_event_id,confidence,verified_at DESC);

-- Automated crawlers may discover possible injury/withdrawal disclosures, but discovery never equals
-- publication -- identical policy to contract_intel_candidates/camp_intel_candidates/
-- antidoping_intel_candidates.
CREATE TABLE IF NOT EXISTS injury_intel_candidates (
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
  detected_event_type TEXT NOT NULL CHECK (detected_event_type IN ('withdrawal','injury_disclosed','cleared_to_compete','replacement_announced')),
  detected_summary TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'signal_block_scoped_subject_v1',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','duplicate','needs_identity')),
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_injury_candidates_review
  ON injury_intel_candidates(review_status,discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_injury_candidates_fighter
  ON injury_intel_candidates(source_key,source_fighter_id,review_status);

DROP VIEW IF EXISTS scout_current_injury_status;
CREATE VIEW scout_current_injury_status AS
SELECT e.*,
       (SELECT ev.source_url FROM fighter_injury_evidence ev WHERE ev.injury_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) primary_source_url,
       (SELECT ev.publisher FROM fighter_injury_evidence ev WHERE ev.injury_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) primary_publisher,
       (SELECT ev.confidence FROM fighter_injury_evidence ev WHERE ev.injury_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) evidence_grade
FROM fighter_injury_events e
WHERE e.is_current=1;
