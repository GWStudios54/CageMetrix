PRAGMA foreign_keys = ON;

-- Coach affiliation, distinct from camp/team affiliation (migrations/0044): a fighter can change head
-- coach without changing gym, and vice versa -- confirmed real and reported separately from camp news
-- (e.g. "Henry Cejudo parts with longtime coach Eric Albarracin" while remaining at the same camp;
-- "Ilia Topuria splits from coaches" ahead of a title fight). A fighter with no row here is NOT
-- assumed to be coachless -- same policy as camp/management. Keeps the source_type='verified_profile'
-- bypass contract/camp/management allow (routine, non-stigmatizing), unlike anti-doping.
CREATE TABLE IF NOT EXISTS fighter_coach_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  coach_name TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'reputable_trade_reporting',
  confidence TEXT NOT NULL DEFAULT 'C' CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  CHECK (source_url IS NOT NULL OR source_type='verified_profile')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fighter_coach_one_current
  ON fighter_coach_history(source_key,source_fighter_id)
  WHERE is_current=1;
CREATE INDEX IF NOT EXISTS idx_fighter_coach_fighter
  ON fighter_coach_history(source_key,source_fighter_id,verified_at DESC);

-- Every published coach-affiliation row can retain multiple corroborating public sources, same as
-- fighter_camp_evidence/fighter_contract_evidence.
CREATE TABLE IF NOT EXISTS fighter_coach_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_history_id INTEGER NOT NULL REFERENCES fighter_coach_history(id) ON DELETE CASCADE,
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
  UNIQUE(coach_history_id,source_url)
);
CREATE INDEX IF NOT EXISTS idx_coach_evidence_history
  ON fighter_coach_evidence(coach_history_id,confidence,verified_at DESC);

-- Automated crawlers may discover possible coach-change disclosures, but discovery never equals
-- publication -- identical policy to camp_intel_candidates/injury_intel_candidates. Coach names are
-- arbitrary people, not a fixed known list the way camps are, so detected_coach_name is free text
-- for a human to confirm or correct before publishing, same as injury's opponent_name field.
CREATE TABLE IF NOT EXISTS coach_intel_candidates (
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
  detected_coach_name TEXT,
  detected_event_type TEXT NOT NULL CHECK (detected_event_type IN ('hired','parted_ways')),
  detected_summary TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'signal_block_scoped_subject_v1',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','duplicate','needs_identity')),
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_coach_candidates_review
  ON coach_intel_candidates(review_status,discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_candidates_fighter
  ON coach_intel_candidates(source_key,source_fighter_id,review_status);

DROP VIEW IF EXISTS scout_current_coach;
CREATE VIEW scout_current_coach AS
SELECT h.source_key,h.source_fighter_id,h.coach_name,h.started_at,h.source_url,
       h.source_type,h.confidence,h.verified_at,h.last_checked_at
FROM fighter_coach_history h
WHERE h.is_current=1;
