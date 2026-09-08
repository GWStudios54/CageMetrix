PRAGMA foreign_keys = ON;

-- The longitudinal source carries participant names while the fighter master owns the
-- authoritative source fighter ids. Resolve only exact display names that map to one
-- and only one master id. This avoids relying on undocumented hash semantics and never
-- collapses normalized-name collisions into a single real person.
CREATE TABLE IF NOT EXISTS mma_source_master_name_identities (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  identity_basis TEXT NOT NULL CHECK (identity_basis = 'source_exact_name_unique_master'),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key,snapshot_id,fighter_name)
);
CREATE INDEX IF NOT EXISTS idx_mma_source_master_name_identity_id
  ON mma_source_master_name_identities(source_key,snapshot_id,source_fighter_id);
CREATE INDEX IF NOT EXISTS idx_mma_source_master_name_identity_normalized
  ON mma_source_master_name_identities(source_key,snapshot_id,normalized_name);
CREATE INDEX IF NOT EXISTS idx_mma_fighters_exact_name
  ON mma_fighters(source_key,snapshot_id,fighter_name);
CREATE INDEX IF NOT EXISTS idx_mma_participants_exact_name
  ON mma_fight_participants(source_key,snapshot_id,fighter_name);

-- Prefer explicit source ids, then reviewed resolutions, then exact unique master-name
-- resolution. The old MD5-derived overlay remains in the database as historical audit
-- evidence, but it no longer participates in identity resolution because the upstream
-- public schema does not promise that hash contract.
DROP VIEW IF EXISTS mma_unresolved_participants;
DROP VIEW IF EXISTS mma_effective_participants;
CREATE VIEW mma_effective_participants AS
SELECT p.*,
       COALESCE(
         p.source_fighter_id,
         r.resolved_source_fighter_id,
         m.source_fighter_id
       ) AS effective_source_fighter_id,
       CASE
         WHEN p.source_fighter_id IS NOT NULL THEN 'source_unique_name'
         WHEN r.resolved_source_fighter_id IS NOT NULL THEN r.match_method
         WHEN m.source_fighter_id IS NOT NULL THEN m.identity_basis
         ELSE NULL
       END AS identity_match_method,
       CASE
         WHEN p.source_fighter_id IS NOT NULL THEN 1.0
         WHEN r.resolved_source_fighter_id IS NOT NULL THEN r.confidence
         WHEN m.source_fighter_id IS NOT NULL THEN m.confidence
         ELSE NULL
       END AS identity_confidence
FROM mma_active_participants p
LEFT JOIN mma_participant_identity_resolutions r
  ON r.source_key=p.source_key
 AND r.snapshot_id=p.snapshot_id
 AND r.source_fight_id=p.source_fight_id
 AND r.side=p.side
 AND r.status='accepted'
LEFT JOIN mma_source_master_name_identities m
  ON m.source_key=p.source_key
 AND m.snapshot_id=p.snapshot_id
 AND m.fighter_name=p.fighter_name;

CREATE VIEW mma_unresolved_participants AS
SELECT * FROM mma_effective_participants WHERE effective_source_fighter_id IS NULL;
