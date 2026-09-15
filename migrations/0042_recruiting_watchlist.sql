PRAGMA foreign_keys=ON;

-- A persistent, cross-opening shortlist. recruiting_opening_candidates only
-- exists in the context of one opening; this lets a recruiter track a
-- promising fighter before any opening fits them, and surfaces when their
-- management/contract/availability status has moved since it was last
-- reviewed, without needing a separate notification system.
CREATE TABLE IF NOT EXISTS recruiting_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_account_id INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  profile_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'watching'
    CHECK (status IN ('watching','contacted','passed','signed')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 5),
  notes TEXT,
  snapshot_management_status TEXT,
  snapshot_contract_status TEXT,
  snapshot_open_to_fights TEXT,
  last_reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_account_id,source_key,source_fighter_id),
  FOREIGN KEY(owner_account_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recruiting_watchlist_owner_status
  ON recruiting_watchlist(owner_account_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recruiting_watchlist_fighter
  ON recruiting_watchlist(source_key,source_fighter_id);
