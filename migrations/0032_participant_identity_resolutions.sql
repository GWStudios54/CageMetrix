PRAGMA foreign_keys = ON;

-- The immutable MMA source mirror intentionally leaves source_fighter_id NULL when a
-- participant name is ambiguous. Keep that raw snapshot untouched and record conservative,
-- auditable identity resolutions in a separate overlay instead.
CREATE TABLE IF NOT EXISTS mma_participant_identity_resolutions (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fight_id TEXT NOT NULL,
  side INTEGER NOT NULL CHECK (side IN (1,2)),
  normalized_name TEXT NOT NULL,
  resolved_source_fighter_id TEXT NOT NULL,
  match_method TEXT NOT NULL CHECK (match_method IN ('global_builder_existing','metadata_auto','manual_verified')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  score REAL,
  margin REAL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  source_url TEXT,
  reviewed_by TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key,snapshot_id,source_fight_id,side),
  FOREIGN KEY (source_key,snapshot_id,source_fight_id,side)
    REFERENCES mma_fight_participants(source_key,snapshot_id,source_fight_id,side)
    ON DELETE CASCADE,
  FOREIGN KEY (source_key,snapshot_id,resolved_source_fighter_id)
    REFERENCES mma_fighters(source_key,snapshot_id,source_fighter_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mma_participant_resolution_fighter
  ON mma_participant_identity_resolutions(source_key,snapshot_id,resolved_source_fighter_id);
CREATE INDEX IF NOT EXISTS idx_mma_participant_resolution_name
  ON mma_participant_identity_resolutions(source_key,snapshot_id,normalized_name);
CREATE INDEX IF NOT EXISTS idx_mma_participant_resolution_method
  ON mma_participant_identity_resolutions(match_method,status,confidence);

DROP VIEW IF EXISTS mma_effective_participants;
CREATE VIEW mma_effective_participants AS
SELECT p.*,
       COALESCE(p.source_fighter_id,r.resolved_source_fighter_id) AS effective_source_fighter_id,
       CASE WHEN p.source_fighter_id IS NOT NULL THEN 'source_unique_name' ELSE r.match_method END AS identity_match_method,
       CASE WHEN p.source_fighter_id IS NOT NULL THEN 1.0 ELSE r.confidence END AS identity_confidence
FROM mma_active_participants p
LEFT JOIN mma_participant_identity_resolutions r
  ON r.source_key=p.source_key
 AND r.snapshot_id=p.snapshot_id
 AND r.source_fight_id=p.source_fight_id
 AND r.side=p.side
 AND r.status='accepted';

DROP VIEW IF EXISTS mma_unresolved_participants;
CREATE VIEW mma_unresolved_participants AS
SELECT * FROM mma_effective_participants WHERE effective_source_fighter_id IS NULL;
