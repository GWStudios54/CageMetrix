PRAGMA foreign_keys = ON;

-- The upstream MMA Global Database keys fighters as MD5(exact UTF-8 display name),
-- while its longitudinal fight table carries names rather than fighter ids.  Preserve
-- the imported source snapshot verbatim and keep source-contract-derived history ids
-- in a separate, auditable overlay.
CREATE TABLE IF NOT EXISTS mma_source_identity_contracts (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  master_rows_checked INTEGER NOT NULL DEFAULT 0,
  mismatch_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('verified','failed')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key,snapshot_id)
);

CREATE TABLE IF NOT EXISTS mma_source_name_identities (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  derived_source_fighter_id TEXT NOT NULL,
  identity_basis TEXT NOT NULL CHECK (identity_basis IN ('source_exact_name_md5')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key,snapshot_id,fighter_name)
);
CREATE INDEX IF NOT EXISTS idx_mma_source_name_identity_id
  ON mma_source_name_identities(source_key,snapshot_id,derived_source_fighter_id);
CREATE INDEX IF NOT EXISTS idx_mma_source_name_identity_normalized
  ON mma_source_name_identities(source_key,snapshot_id,normalized_name);

-- Prefer raw ids, then reviewed/metadata resolution, then the verified upstream
-- exact-name identity contract.  The derived layer is useful for complete source
-- history bookkeeping; it is not permission to merge similarly named real people.
DROP VIEW IF EXISTS mma_unresolved_participants;
DROP VIEW IF EXISTS mma_effective_participants;
CREATE VIEW mma_effective_participants AS
SELECT p.*,
       COALESCE(p.source_fighter_id,r.resolved_source_fighter_id,h.derived_source_fighter_id) AS effective_source_fighter_id,
       CASE
         WHEN p.source_fighter_id IS NOT NULL THEN 'source_unique_name'
         WHEN r.resolved_source_fighter_id IS NOT NULL THEN r.match_method
         WHEN h.derived_source_fighter_id IS NOT NULL THEN h.identity_basis
         ELSE NULL
       END AS identity_match_method,
       CASE
         WHEN p.source_fighter_id IS NOT NULL THEN 1.0
         WHEN r.resolved_source_fighter_id IS NOT NULL THEN r.confidence
         WHEN h.derived_source_fighter_id IS NOT NULL THEN h.confidence
         ELSE NULL
       END AS identity_confidence
FROM mma_active_participants p
LEFT JOIN mma_participant_identity_resolutions r
  ON r.source_key=p.source_key
 AND r.snapshot_id=p.snapshot_id
 AND r.source_fight_id=p.source_fight_id
 AND r.side=p.side
 AND r.status='accepted'
LEFT JOIN mma_source_name_identities h
  ON h.source_key=p.source_key
 AND h.snapshot_id=p.snapshot_id
 AND h.fighter_name=p.fighter_name;

CREATE VIEW mma_unresolved_participants AS
SELECT * FROM mma_effective_participants WHERE effective_source_fighter_id IS NULL;

-- Durable proof of what "complete history" means for each master fighter: every
-- completed bout reported by the active source snapshot is compared with the public
-- materialized dossier history.  Freshness is tracked separately so a perfectly
-- materialized stale source can never masquerade as current-world completeness.
CREATE TABLE IF NOT EXISTS mma_fighter_history_coverage (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  source_reported_completed_bouts INTEGER NOT NULL DEFAULT 0,
  materialized_completed_bouts INTEGER NOT NULL DEFAULT 0,
  missing_bout_count INTEGER NOT NULL DEFAULT 0,
  first_source_bout_date TEXT,
  last_source_bout_date TEXT,
  first_materialized_bout_date TEXT,
  last_materialized_bout_date TEXT,
  materialization_status TEXT NOT NULL CHECK (materialization_status IN ('complete','gap','no_source_bouts')),
  source_max_date TEXT,
  source_age_days INTEGER,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('current','aging','stale','unknown')),
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_key,snapshot_id,source_fighter_id)
);
CREATE INDEX IF NOT EXISTS idx_mma_history_coverage_status
  ON mma_fighter_history_coverage(materialization_status,freshness_status,missing_bout_count);

DROP VIEW IF EXISTS mma_active_fighter_history_coverage;
CREATE VIEW mma_active_fighter_history_coverage AS
SELECT c.*
FROM mma_fighter_history_coverage c
JOIN mma_source_registry r
  ON r.source_key=c.source_key AND r.active_snapshot_id=c.snapshot_id;
