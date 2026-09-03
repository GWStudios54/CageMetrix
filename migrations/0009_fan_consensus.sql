-- Fans vs. Model data is launch-forward only: rows are created only for bouts
-- that already have a saved CageMetrix prediction. Historical training bouts
-- are never backfilled into these tables.
CREATE TABLE fan_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER NOT NULL REFERENCES bouts(id),
  voter_id TEXT NOT NULL CHECK(length(voter_id) BETWEEN 20 AND 80),
  picked_fighter_id INTEGER NOT NULL REFERENCES fighters(id),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bout_id, voter_id)
);
CREATE INDEX idx_fan_predictions_bout ON fan_predictions(bout_id);

CREATE TRIGGER fan_predictions_valid_insert BEFORE INSERT ON fan_predictions
WHEN NOT EXISTS (
  SELECT 1 FROM bouts b
  WHERE b.id=NEW.bout_id
    AND NEW.picked_fighter_id IN (b.fighter_a_id,b.fighter_b_id)
    AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id)
)
BEGIN SELECT RAISE(ABORT, 'Fan prediction requires a tracked matchup and one of its fighters'); END;

CREATE TRIGGER fan_predictions_valid_update BEFORE UPDATE OF picked_fighter_id,bout_id,voter_id ON fan_predictions
WHEN NOT EXISTS (
  SELECT 1 FROM bouts b
  WHERE b.id=NEW.bout_id
    AND NEW.picked_fighter_id IN (b.fighter_a_id,b.fighter_b_id)
    AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id)
)
BEGIN SELECT RAISE(ABORT, 'Fan prediction requires a tracked matchup and one of its fighters'); END;

-- Exact individual bout start times are not reliably published in advance.
-- To prevent any post-start leakage, fan picks lock at the published card start.
CREATE TRIGGER fan_predictions_lock_insert BEFORE INSERT ON fan_predictions
WHEN EXISTS (
  SELECT 1 FROM bouts b JOIN events e ON e.id=b.event_id
  WHERE b.id=NEW.bout_id
    AND (b.status<>'scheduled' OR e.starts_at IS NULL OR unixepoch('now')>=unixepoch(e.starts_at))
)
BEGIN SELECT RAISE(ABORT, 'Fan predictions are locked'); END;

CREATE TRIGGER fan_predictions_lock_update BEFORE UPDATE ON fan_predictions
WHEN EXISTS (
  SELECT 1 FROM bouts b JOIN events e ON e.id=b.event_id
  WHERE b.id=NEW.bout_id
    AND (b.status<>'scheduled' OR e.starts_at IS NULL OR unixepoch('now')>=unixepoch(e.starts_at))
)
BEGIN SELECT RAISE(ABORT, 'Fan predictions are locked'); END;

CREATE TABLE fan_scorecards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER NOT NULL REFERENCES bouts(id),
  voter_id TEXT NOT NULL CHECK(length(voter_id) BETWEEN 20 AND 80),
  rounds_json TEXT NOT NULL CHECK(json_valid(rounds_json) AND json_type(rounds_json)='array'),
  total_a INTEGER NOT NULL CHECK(total_a>=0),
  total_b INTEGER NOT NULL CHECK(total_b>=0),
  scored_rounds INTEGER NOT NULL CHECK(scored_rounds BETWEEN 1 AND 5),
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bout_id, voter_id)
);
CREATE INDEX idx_fan_scorecards_bout ON fan_scorecards(bout_id);

CREATE TRIGGER fan_scorecards_tracked_insert BEFORE INSERT ON fan_scorecards
WHEN NOT EXISTS (
  SELECT 1 FROM bouts b
  WHERE b.id=NEW.bout_id AND b.status='completed'
    AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id)
)
BEGIN SELECT RAISE(ABORT, 'Fan scorecards require a completed tracked matchup'); END;

CREATE TRIGGER fan_scorecards_tracked_update BEFORE UPDATE ON fan_scorecards
WHEN NOT EXISTS (
  SELECT 1 FROM bouts b
  WHERE b.id=NEW.bout_id AND b.status='completed'
    AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id)
)
BEGIN SELECT RAISE(ABORT, 'Fan scorecards require a completed tracked matchup'); END;
