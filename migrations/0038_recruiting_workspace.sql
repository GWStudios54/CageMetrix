PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS recruiting_openings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_account_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  promotion_name TEXT,
  weight_class TEXT,
  target_date TEXT,
  event_city TEXT,
  event_region TEXT,
  event_country TEXT,
  age_min INTEGER CHECK (age_min IS NULL OR age_min BETWEEN 14 AND 60),
  age_max INTEGER CHECK (age_max IS NULL OR age_max BETWEEN 14 AND 60),
  min_wins INTEGER CHECK (min_wins IS NULL OR min_wins >= 0),
  min_rating REAL CHECK (min_rating IS NULL OR min_rating BETWEEN 0 AND 100),
  min_evidence REAL CHECK (min_evidence IS NULL OR min_evidence BETWEEN 0 AND 100),
  active_months INTEGER CHECK (active_months IS NULL OR active_months BETWEEN 1 AND 60),
  management_filter TEXT NOT NULL DEFAULT 'any'
    CHECK (management_filter IN ('any','unknown','represented','unmanaged')),
  contract_filter TEXT NOT NULL DEFAULT 'any'
    CHECK (contract_filter IN ('any','unknown','under_contract','free_agent','non_exclusive')),
  opportunity_filter TEXT NOT NULL DEFAULT 'any'
    CHECK (opportunity_filter IN ('any','fights','management','team')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','paused','filled','closed')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_account_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recruiting_openings_owner_status
  ON recruiting_openings(owner_account_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS recruiting_opening_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opening_id INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  profile_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','shortlisted','contacted','passed','declined','booked')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 5),
  notes TEXT,
  contacted_at TEXT,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(opening_id,source_key,source_fighter_id),
  FOREIGN KEY(opening_id) REFERENCES recruiting_openings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recruiting_candidates_opening_status
  ON recruiting_opening_candidates(opening_id,status,priority DESC,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recruiting_candidates_fighter
  ON recruiting_opening_candidates(source_key,source_fighter_id,updated_at DESC);
