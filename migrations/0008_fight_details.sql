-- Fight pages never read today's ratings as a substitute for a prediction input.
-- New forecasts capture their inputs in the same immutable INSERT as the odds.
ALTER TABLE predictions ADD COLUMN input_snapshot_json TEXT CHECK(input_snapshot_json IS NULL OR json_valid(input_snapshot_json));
CREATE TABLE prediction_snapshots (
  prediction_id INTEGER PRIMARY KEY REFERENCES predictions(id),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  provenance TEXT NOT NULL CHECK(provenance IN ('at_prediction','verified_archive','unavailable')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER prediction_snapshots_no_update BEFORE UPDATE ON prediction_snapshots
BEGIN SELECT RAISE(ABORT, 'Prediction snapshots are immutable'); END;
CREATE TRIGGER prediction_snapshots_no_delete BEFORE DELETE ON prediction_snapshots
BEGIN SELECT RAISE(ABORT, 'Prediction snapshots are immutable'); END;
CREATE TRIGGER predictions_no_delete BEFORE DELETE ON predictions
BEGIN SELECT RAISE(ABORT, 'Predictions are immutable'); END;
-- Replacements get their own bout ID. Result/status updates remain unrestricted.
CREATE TRIGGER predicted_bout_identity BEFORE UPDATE OF fighter_a_id,fighter_b_id,event_id,source_key ON bouts
WHEN EXISTS(SELECT 1 FROM predictions WHERE bout_id=OLD.id)
 AND (NEW.fighter_a_id IS NOT OLD.fighter_a_id OR NEW.fighter_b_id IS NOT OLD.fighter_b_id
 OR NEW.event_id IS NOT OLD.event_id OR NEW.source_key IS NOT OLD.source_key)
BEGIN SELECT RAISE(ABORT, 'Predicted matchup identity is immutable'); END;

CREATE TABLE contributors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  bio TEXT NOT NULL DEFAULT '' CHECK(length(bio)<=500)
);
CREATE TABLE contributor_keys (
  id TEXT PRIMARY KEY,
  contributor_id INTEGER NOT NULL REFERENCES contributors(id),
  token_hash TEXT NOT NULL UNIQUE,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE fight_commentary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER NOT NULL REFERENCES bouts(id),
  contributor_id INTEGER NOT NULL REFERENCES contributors(id),
  rounds_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(rounds_json) AND json_type(rounds_json)='array' AND json_array_length(rounds_json)<=5),
  final_thoughts TEXT NOT NULL DEFAULT '' CHECK(length(final_thoughts)<=6000),
  revision INTEGER NOT NULL CHECK(revision>=1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bout_id,contributor_id)
);
-- Validate the ten-point must card at the storage boundary too.
CREATE TRIGGER commentary_rounds_insert BEFORE INSERT ON fight_commentary
WHEN EXISTS(SELECT 1 FROM json_each(NEW.rounds_json) WHERE
  json_type(value,'$.round') IS NOT 'integer' OR json_extract(value,'$.round') NOT BETWEEN 1 AND 5
  OR json_type(value,'$.text') IS NOT 'text' OR length(json_extract(value,'$.text'))>4000
  OR NOT ((json_type(value,'$.score_a')='null' AND json_type(value,'$.score_b')='null')
    OR (json_type(value,'$.score_a')='integer' AND json_type(value,'$.score_b')='integer'
      AND json_extract(value,'$.score_a') BETWEEN 7 AND 10 AND json_extract(value,'$.score_b') BETWEEN 7 AND 10
      AND max(json_extract(value,'$.score_a'),json_extract(value,'$.score_b'))=10))
  OR json_type(value,'$.score_a') IS NULL OR json_type(value,'$.score_b') IS NULL)
 OR (SELECT count(*) FROM json_each(NEW.rounds_json))<>(SELECT count(DISTINCT json_extract(value,'$.round')) FROM json_each(NEW.rounds_json))
BEGIN SELECT RAISE(ABORT, 'Invalid commentary round or score'); END;
CREATE TRIGGER commentary_rounds_update BEFORE UPDATE OF rounds_json ON fight_commentary
WHEN EXISTS(SELECT 1 FROM json_each(NEW.rounds_json) WHERE
  json_type(value,'$.round') IS NOT 'integer' OR json_extract(value,'$.round') NOT BETWEEN 1 AND 5
  OR json_type(value,'$.text') IS NOT 'text' OR length(json_extract(value,'$.text'))>4000
  OR NOT ((json_type(value,'$.score_a')='null' AND json_type(value,'$.score_b')='null')
    OR (json_type(value,'$.score_a')='integer' AND json_type(value,'$.score_b')='integer'
      AND json_extract(value,'$.score_a') BETWEEN 7 AND 10 AND json_extract(value,'$.score_b') BETWEEN 7 AND 10
      AND max(json_extract(value,'$.score_a'),json_extract(value,'$.score_b'))=10))
  OR json_type(value,'$.score_a') IS NULL OR json_type(value,'$.score_b') IS NULL)
 OR (SELECT count(*) FROM json_each(NEW.rounds_json))<>(SELECT count(DISTINCT json_extract(value,'$.round')) FROM json_each(NEW.rounds_json))
BEGIN SELECT RAISE(ABORT, 'Invalid commentary round or score'); END;
