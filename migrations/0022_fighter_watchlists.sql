PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS community_fighter_follows (
  account_id INTEGER NOT NULL,
  fighter_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(account_id,fighter_id),
  FOREIGN KEY(account_id) REFERENCES community_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(fighter_id) REFERENCES fighters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_community_fighter_follows_account
  ON community_fighter_follows(account_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_fighter_follows_fighter
  ON community_fighter_follows(fighter_id,created_at DESC);
