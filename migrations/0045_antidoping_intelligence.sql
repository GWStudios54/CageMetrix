PRAGMA foreign_keys = ON;

-- Publicly reported anti-doping events. Rows represent disclosed facts about
-- a flag/violation/sanction/clearance, same evidentiary discipline as
-- fighter_contract_events: missing fields stay NULL and are never inferred,
-- and reputational sensitivity here specifically means every row must carry
-- real evidence -- there is no source_type='verified_profile' escape hatch
-- like the contract/management/camp tables have, unlike those tables.
CREATE TABLE IF NOT EXISTS fighter_antidoping_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'flagged','positive_test','suspended','cleared','reinstated','status_update'
  )),
  substance TEXT,
  sanctioning_body TEXT,
  suspension_months INTEGER CHECK (suspension_months IS NULL OR suspension_months >= 0),
  effective_at TEXT,
  reported_at TEXT,
  expires_at TEXT,
  public_summary TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_antidoping_events_fighter
  ON fighter_antidoping_events(source_key,source_fighter_id,COALESCE(effective_at,reported_at) DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_antidoping_events_current
  ON fighter_antidoping_events(source_key,source_fighter_id,is_current);

-- Every published anti-doping event must have public evidence -- always at
-- least one row, same requirement fighter_contract_evidence enforces via the
-- admin publish path (there is no way to write an event without one).
CREATE TABLE IF NOT EXISTS fighter_antidoping_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  antidoping_event_id INTEGER NOT NULL REFERENCES fighter_antidoping_events(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  published_at TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'promotion_direct','sanctioning_body_direct','athletic_commission_record',
    'fighter_direct','reputable_trade_reporting','reputable_interview',
    'secondary_reporting_with_attribution'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(antidoping_event_id,source_url)
);
CREATE INDEX IF NOT EXISTS idx_antidoping_evidence_event
  ON fighter_antidoping_evidence(antidoping_event_id,confidence,verified_at DESC);

-- Automated crawlers may discover possible anti-doping disclosures, but
-- discovery never equals publication -- identical policy to contract_intel_
-- candidates and camp_intel_candidates. Given the reputational stakes here,
-- this queue is the one place that policy matters most: nothing here is
-- ever a claim about a fighter until a human has read the source and
-- accepted it into fighter_antidoping_events + fighter_antidoping_evidence.
CREATE TABLE IF NOT EXISTS antidoping_intel_candidates (
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
  detected_event_type TEXT NOT NULL CHECK (detected_event_type IN ('flagged','positive_test','suspended','cleared','reinstated','status_update')),
  detected_summary TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'signal_block_scoped_subject_v1',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','duplicate','needs_identity')),
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_antidoping_candidates_review
  ON antidoping_intel_candidates(review_status,discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_antidoping_candidates_fighter
  ON antidoping_intel_candidates(source_key,source_fighter_id,review_status);

DROP VIEW IF EXISTS scout_current_antidoping_status;
CREATE VIEW scout_current_antidoping_status AS
SELECT e.*,
       (SELECT ev.source_url FROM fighter_antidoping_evidence ev WHERE ev.antidoping_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) primary_source_url,
       (SELECT ev.publisher FROM fighter_antidoping_evidence ev WHERE ev.antidoping_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) primary_publisher,
       (SELECT ev.confidence FROM fighter_antidoping_evidence ev WHERE ev.antidoping_event_id=e.id ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC LIMIT 1) evidence_grade
FROM fighter_antidoping_events e
WHERE e.is_current=1;
