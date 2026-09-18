-- Sourced, editorially reviewed matchup reports. Discovery candidates never appear in leagues.
CREATE TABLE IF NOT EXISTS fantasy_fight_rumors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fighter_key TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  event_name TEXT,
  expected_date TEXT,
  source_url TEXT NOT NULL,
  publisher TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retracted')),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(status<>'published' OR reviewed_at IS NOT NULL),
  UNIQUE(fighter_key,opponent_name,source_url)
);
CREATE INDEX IF NOT EXISTS idx_fantasy_fight_rumors_fighter ON fantasy_fight_rumors(fighter_key,status,expires_at);
