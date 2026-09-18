-- Capture confirmed schedule changes as they enter the shared MMA Scouts database.
CREATE TABLE IF NOT EXISTS fantasy_fight_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL UNIQUE,
  fighter_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('booked','cancelled')),
  opponent_name TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fantasy_fight_alerts_fighter ON fantasy_fight_alerts(fighter_key,created_at DESC);

CREATE TRIGGER IF NOT EXISTS fantasy_bout_booked AFTER INSERT ON bouts
WHEN NEW.status='scheduled' AND (SELECT event_date FROM events WHERE id=NEW.event_id)>=date('now')
BEGIN
  INSERT OR IGNORE INTO fantasy_fight_alerts(alert_key,fighter_key,kind,opponent_name,event_name,event_date,source_url)
  SELECT 'booked:'||NEW.id||':'||NEW.fighter_a_id,'ufc:'||NEW.fighter_a_id,'booked',
    (SELECT name FROM fighters WHERE id=NEW.fighter_b_id),name,event_date,source_url FROM events WHERE id=NEW.event_id;
  INSERT OR IGNORE INTO fantasy_fight_alerts(alert_key,fighter_key,kind,opponent_name,event_name,event_date,source_url)
  SELECT 'booked:'||NEW.id||':'||NEW.fighter_b_id,'ufc:'||NEW.fighter_b_id,'booked',
    (SELECT name FROM fighters WHERE id=NEW.fighter_a_id),name,event_date,source_url FROM events WHERE id=NEW.event_id;
END;

CREATE TRIGGER IF NOT EXISTS fantasy_bout_status_changed AFTER UPDATE OF status ON bouts
WHEN OLD.status<>NEW.status AND (NEW.status='scheduled' OR NEW.status='cancelled')
  AND (SELECT event_date FROM events WHERE id=NEW.event_id)>=date('now','-2 days')
BEGIN
  INSERT OR IGNORE INTO fantasy_fight_alerts(alert_key,fighter_key,kind,opponent_name,event_name,event_date,source_url)
  SELECT NEW.status||':'||NEW.id||':'||NEW.fighter_a_id,'ufc:'||NEW.fighter_a_id,
    CASE WHEN NEW.status='scheduled' THEN 'booked' ELSE 'cancelled' END,
    (SELECT name FROM fighters WHERE id=NEW.fighter_b_id),name,event_date,source_url FROM events
    WHERE id=NEW.event_id AND (NEW.status='scheduled' OR OLD.status='scheduled');
  INSERT OR IGNORE INTO fantasy_fight_alerts(alert_key,fighter_key,kind,opponent_name,event_name,event_date,source_url)
  SELECT NEW.status||':'||NEW.id||':'||NEW.fighter_b_id,'ufc:'||NEW.fighter_b_id,
    CASE WHEN NEW.status='scheduled' THEN 'booked' ELSE 'cancelled' END,
    (SELECT name FROM fighters WHERE id=NEW.fighter_a_id),name,event_date,source_url FROM events
    WHERE id=NEW.event_id AND (NEW.status='scheduled' OR OLD.status='scheduled');
END;
