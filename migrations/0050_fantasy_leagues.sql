PRAGMA foreign_keys=ON;

CREATE TABLE fantasy_leagues (
  id TEXT PRIMARY KEY,
  owner_account_id INTEGER NOT NULL REFERENCES community_accounts(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 60),
  tier TEXT NOT NULL CHECK(tier IN ('premier','challengers')),
  seats INTEGER NOT NULL CHECK(seats BETWEEN 2 AND 8),
  status TEXT NOT NULL DEFAULT 'drafting' CHECK(status IN ('drafting','active')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE fantasy_managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES community_accounts(id),
  bot_name TEXT,
  draft_position INTEGER NOT NULL,
  UNIQUE(league_id,account_id),
  UNIQUE(league_id,draft_position),
  CHECK((account_id IS NULL) <> (bot_name IS NULL))
);
CREATE TABLE fantasy_picks (
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
CREATE INDEX fantasy_picks_manager ON fantasy_picks(manager_id);
