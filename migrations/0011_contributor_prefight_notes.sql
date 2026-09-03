-- One preserved pre-fight article/note per contributor per tracked matchup.
-- Notes may be edited only before the published card start; after that they are archival.
CREATE TABLE contributor_prefight_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER NOT NULL REFERENCES bouts(id),
  contributor_id INTEGER NOT NULL REFERENCES contributors(id),
  title TEXT NOT NULL DEFAULT '' CHECK(length(title) <= 160),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 30000),
  picked_fighter_id INTEGER REFERENCES fighters(id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bout_id, contributor_id)
);
CREATE INDEX idx_contributor_prefight_notes_bout ON contributor_prefight_notes(bout_id);

CREATE TRIGGER contributor_prefight_notes_valid_insert BEFORE INSERT ON contributor_prefight_notes
WHEN NOT EXISTS (
  SELECT 1 FROM bouts b JOIN events e ON e.id=b.event_id
  WHERE b.id=NEW.bout_id
    AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id)
    AND (NEW.picked_fighter_id IS NULL OR NEW.picked_fighter_id IN (b.fighter_a_id,b.fighter_b_id))
    AND b.status='scheduled'
    AND e.starts_at IS NOT NULL
    AND unixepoch('now') < unixepoch(e.starts_at)
)
BEGIN SELECT RAISE(ABORT, 'Pre-fight notes require an upcoming tracked matchup'); END;

CREATE TRIGGER contributor_prefight_notes_valid_update BEFORE UPDATE ON contributor_prefight_notes
WHEN NOT EXISTS (
  SELECT 1 FROM bouts b JOIN events e ON e.id=b.event_id
  WHERE b.id=NEW.bout_id
    AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id)
    AND (NEW.picked_fighter_id IS NULL OR NEW.picked_fighter_id IN (b.fighter_a_id,b.fighter_b_id))
    AND b.status='scheduled'
    AND e.starts_at IS NOT NULL
    AND unixepoch('now') < unixepoch(e.starts_at)
)
BEGIN SELECT RAISE(ABORT, 'Pre-fight notes are locked once the card starts'); END;
