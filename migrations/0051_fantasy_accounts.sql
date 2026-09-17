CREATE TABLE IF NOT EXISTS fantasy_credentials (
  account_id TEXT PRIMARY KEY REFERENCES fantasy_accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fantasy_login_limits (
  email TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
UPDATE fantasy_leagues SET status='drafting' WHERE status='active'
  AND (SELECT COUNT(*) FROM fantasy_picks WHERE league_id=fantasy_leagues.id)<seats*6;
