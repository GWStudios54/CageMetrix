ALTER TABLE bouts ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX idx_bouts_source_key ON bouts(source_key) WHERE source_key IS NOT NULL;
ALTER TABLE events ADD COLUMN source_url TEXT;
ALTER TABLE events ADD COLUMN starts_at TEXT;
ALTER TABLE predictions ADD COLUMN input_snapshot_key TEXT;
ALTER TABLE predictions ADD COLUMN picked_fighter_id INTEGER REFERENCES fighters(id);
ALTER TABLE predictions ADD COLUMN sample_strength REAL;
-- Forecasts are write-once. A changed matchup creates a new bout; the original
-- is cancelled and stays in the public record without affecting accuracy.
CREATE TRIGGER predictions_immutable BEFORE UPDATE ON predictions
BEGIN SELECT RAISE(ABORT, 'Predictions are immutable'); END;

CREATE TABLE event_source_archive (
  source_url TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
