PRAGMA foreign_keys=ON;
-- Standalone consumer identities. Source fighter and fight tables are read only here.
CREATE TABLE IF NOT EXISTS fantasy_accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fantasy_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES fantasy_accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fantasy_sessions_account ON fantasy_sessions(account_id,expires_at);
CREATE TABLE IF NOT EXISTS fantasy_leagues (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL REFERENCES fantasy_accounts(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 60),
  tier TEXT NOT NULL CHECK(tier IN ('premier','challengers')),
  seats INTEGER NOT NULL CHECK(seats BETWEEN 2 AND 8),
  status TEXT NOT NULL DEFAULT 'drafting' CHECK(status IN ('drafting','active')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fantasy_managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES fantasy_accounts(id),
  bot_name TEXT,
  draft_position INTEGER NOT NULL,
  UNIQUE(league_id,account_id),
  UNIQUE(league_id,draft_position),
  CHECK((account_id IS NULL) <> (bot_name IS NULL))
);
CREATE TABLE IF NOT EXISTS fantasy_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
  manager_id INTEGER NOT NULL REFERENCES fantasy_managers(id),
  pick_number INTEGER NOT NULL,
  fighter_key TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  picked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(league_id,pick_number),
  UNIQUE(league_id,fighter_key)
);
CREATE INDEX IF NOT EXISTS fantasy_picks_manager ON fantasy_picks(manager_id);
