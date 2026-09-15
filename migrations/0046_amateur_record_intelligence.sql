PRAGMA foreign_keys = ON;

-- Amateur MMA record: a fighter's win-loss-draw tally before turning professional. Unlike
-- contract/camp/anti-doping changes, this is a static biographical fact, not a recurring news event --
-- there is no real feed of "amateur record" announcements to crawl the way there's a news feed for
-- signings or suspensions. It typically surfaces once, in a promotion bio page, a Sherdog/Tapology
-- profile, or a regional amateur sanctioning body's results page, and has to be looked up per fighter.
-- So this ships as manual, evidence-backed admin entry only (mirrors fighter_management_history's
-- source_url-or-verified_profile requirement) -- no discovery/candidate pipeline, because building one
-- against a feed that doesn't exist would mean either finding nothing or fabricating a source.
CREATE TABLE IF NOT EXISTS fighter_amateur_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
  no_contests INTEGER NOT NULL DEFAULT 0 CHECK (no_contests >= 0),
  promotion_or_body TEXT,
  turned_pro_date TEXT,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'public_record',
  confidence TEXT NOT NULL DEFAULT 'C' CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  CHECK (wins + losses + draws + no_contests > 0),
  CHECK (source_url IS NOT NULL OR source_type='verified_profile')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fighter_amateur_record_one
  ON fighter_amateur_record(source_key,source_fighter_id);

-- Every published record can retain multiple corroborating public sources, same as
-- fighter_contract_evidence/fighter_camp_evidence/fighter_management_evidence.
CREATE TABLE IF NOT EXISTS fighter_amateur_record_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amateur_record_id INTEGER NOT NULL REFERENCES fighter_amateur_record(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  published_at TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'fighter_direct','coach_or_camp_direct','promotion_direct','sanctioning_body_direct',
    'athletic_commission_record','reputable_trade_reporting','reputable_interview',
    'secondary_reporting_with_attribution','archived_public_statement'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(amateur_record_id,source_url)
);
CREATE INDEX IF NOT EXISTS idx_amateur_record_evidence_record
  ON fighter_amateur_record_evidence(amateur_record_id,confidence,verified_at DESC);
