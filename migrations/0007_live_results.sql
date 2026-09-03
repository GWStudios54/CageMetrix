CREATE INDEX idx_events_starts_at ON events(starts_at);
CREATE TABLE event_result_sync (
  event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  last_attempted_at TEXT NOT NULL,
  last_success_at TEXT,
  last_changed_at TEXT,
  error TEXT
);
CREATE TABLE bout_result_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER NOT NULL REFERENCES bouts(id),
  observed_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX idx_result_observations_bout ON bout_result_observations(bout_id,id DESC);
