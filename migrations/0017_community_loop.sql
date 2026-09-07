PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS community_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  recovery_hash TEXT NOT NULL,
  fan_voter_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_community_sessions_account ON community_sessions(account_id,expires_at);

CREATE TABLE IF NOT EXISTS community_event_picks (
  account_id INTEGER NOT NULL,
  bout_id INTEGER NOT NULL,
  picked_fighter_id INTEGER NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 50 CHECK(confidence BETWEEN 50 AND 100),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(account_id,bout_id),
  FOREIGN KEY(account_id) REFERENCES community_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(bout_id) REFERENCES bouts(id) ON DELETE CASCADE,
  FOREIGN KEY(picked_fighter_id) REFERENCES fighters(id)
);
CREATE INDEX IF NOT EXISTS idx_community_event_picks_bout ON community_event_picks(bout_id,picked_fighter_id);
CREATE INDEX IF NOT EXISTS idx_community_event_picks_account ON community_event_picks(account_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('event','fight')),
  scope_id INTEGER NOT NULL,
  parent_id INTEGER,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY(account_id) REFERENCES community_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_id) REFERENCES community_posts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_community_posts_scope ON community_posts(scope_type,scope_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_community_posts_account ON community_posts(account_id,created_at DESC);

CREATE TABLE IF NOT EXISTS community_reactions (
  post_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(post_id,account_id),
  FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS community_reports (
  post_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'other',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(post_id,reporter_id),
  FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  FOREIGN KEY(reporter_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS community_blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(blocker_id,blocked_id),
  CHECK(blocker_id<>blocked_id),
  FOREIGN KEY(blocker_id) REFERENCES community_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(blocked_id) REFERENCES community_accounts(id) ON DELETE CASCADE
);
