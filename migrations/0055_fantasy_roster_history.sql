CREATE TABLE IF NOT EXISTS fantasy_roster_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id) ON DELETE CASCADE,
  manager_id INTEGER NOT NULL REFERENCES fantasy_managers(id),
  fighter_key TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  released_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fantasy_roster_history_league ON fantasy_roster_history(league_id,fighter_key);
CREATE TRIGGER IF NOT EXISTS fantasy_archive_roster_swap BEFORE UPDATE OF fighter_key ON fantasy_picks
WHEN NEW.fighter_key<>OLD.fighter_key
BEGIN
  INSERT INTO fantasy_roster_history(league_id,manager_id,fighter_key,fighter_name,acquired_at,released_at)
  VALUES(OLD.league_id,OLD.manager_id,OLD.fighter_key,OLD.fighter_name,OLD.picked_at,datetime('now','+1 day'));
END;
