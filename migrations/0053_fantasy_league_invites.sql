CREATE TABLE IF NOT EXISTS fantasy_invites (
  token_hash TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES fantasy_accounts(id),
  expires_at TEXT NOT NULL,
  used_by TEXT REFERENCES fantasy_accounts(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS fantasy_invites_league ON fantasy_invites(league_id,expires_at,used_by);
