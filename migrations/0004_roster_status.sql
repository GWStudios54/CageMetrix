PRAGMA foreign_keys = ON;

ALTER TABLE fighters ADD COLUMN roster_status TEXT NOT NULL DEFAULT 'inactive';
ALTER TABLE fighters ADD COLUMN status_source TEXT;

CREATE INDEX IF NOT EXISTS idx_fighters_roster_status
ON fighters(roster_status, current_weight_class);
