import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeWarehouseName, sqlValue } from './lib/warehouse-history.mjs';

const DB = 'cagemetrix';
const remote = process.argv.includes('--remote');
const locationFlag = remote ? '--remote' : '--local';

function wrangler(args, capture = false) {
  return execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env
  }) || '';
}

function queryRows(sql) {
  const raw = wrangler(['d1', 'execute', DB, locationFlag, '--command', sql, '--json'], true);
  const parsed = JSON.parse(raw);
  return parsed.flatMap(part => part?.results || []);
}

function executeFile(path) {
  wrangler(['d1', 'execute', DB, locationFlag, '--file', path]);
}

function nativeFighters() {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = queryRows(`SELECT id,name,dob,height_cm,reach_cm,stance FROM fighters ORDER BY id LIMIT ${pageSize} OFFSET ${offset}`);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function writeIdentityKeys(dir, fighters) {
  const statements = ['DELETE FROM ufc_fighter_identity_keys;'];
  for (let i = 0; i < fighters.length; i += 120) {
    const values = fighters.slice(i, i + 120).map(f => `(${Number(f.id)},${sqlValue(normalizeWarehouseName(f.name))},${sqlValue(String(f.dob || '').slice(0, 10) || null)},${sqlValue(Number.isFinite(Number(f.height_cm)) ? Number(f.height_cm) : null)},${sqlValue(Number.isFinite(Number(f.reach_cm)) ? Number(f.reach_cm) : null)},${sqlValue(f.stance || null)},CURRENT_TIMESTAMP)`).join(',\n');
    statements.push(`INSERT OR REPLACE INTO ufc_fighter_identity_keys (fighter_id,normalized_name,dob,height_cm,reach_cm,stance,updated_at) VALUES\n${values};`);
  }
  const path = join(dir, 'identity-keys.sql');
  writeFileSync(path, `${statements.join('\n')}\n`, 'utf8');
  executeFile(path);
}

const refreshSql = `
-- Preserve reviewed/manual links and rebuild only automatic matches.
DELETE FROM mma_identity_links WHERE reviewed = 0;

-- Safest automatic path: the normalized name is unique in both universes.
INSERT OR IGNORE INTO mma_identity_links (
  source_key,source_fighter_id,cagemetrix_fighter_id,match_method,confidence,reviewed,notes,updated_at
)
SELECT
  wf.source_key,
  wf.source_fighter_id,
  CAST(n.fighter_id AS TEXT),
  'auto_exact_unique_name',
  CASE
    WHEN n.dob IS NOT NULL AND wf.dob IS NOT NULL AND SUBSTR(n.dob,1,10)=SUBSTR(wf.dob,1,10) THEN 0.995
    ELSE 0.95
  END,
  0,
  'Automatically linked only because this fighter already exists in the UFC-native CageMetrix fighters table. Regional opponents remain warehouse-only.',
  CURRENT_TIMESTAMP
FROM mma_active_fighters wf
JOIN (
  SELECT normalized_name
  FROM mma_active_fighters
  GROUP BY normalized_name
  HAVING COUNT(*) = 1
) wu ON wu.normalized_name = wf.normalized_name
JOIN ufc_fighter_identity_keys n ON n.normalized_name = wf.normalized_name
JOIN (
  SELECT normalized_name
  FROM ufc_fighter_identity_keys
  GROUP BY normalized_name
  HAVING COUNT(*) = 1
) nu ON nu.normalized_name = n.normalized_name
WHERE NOT (
  n.dob IS NOT NULL AND wf.dob IS NOT NULL
  AND SUBSTR(n.dob,1,10) <> SUBSTR(wf.dob,1,10)
);

-- Resolve otherwise ambiguous same-name cases only when DOB uniquely identifies
-- one warehouse fighter and one existing UFC-native fighter.
INSERT OR IGNORE INTO mma_identity_links (
  source_key,source_fighter_id,cagemetrix_fighter_id,match_method,confidence,reviewed,notes,updated_at
)
SELECT
  wf.source_key,
  wf.source_fighter_id,
  CAST(n.fighter_id AS TEXT),
  'auto_exact_name_dob',
  0.995,
  0,
  'Same-name ambiguity resolved by exact DOB. Scope remains existing UFC-native fighters only.',
  CURRENT_TIMESTAMP
FROM mma_active_fighters wf
JOIN ufc_fighter_identity_keys n
  ON n.normalized_name = wf.normalized_name
 AND n.dob IS NOT NULL
 AND wf.dob IS NOT NULL
 AND SUBSTR(n.dob,1,10) = SUBSTR(wf.dob,1,10)
JOIN (
  SELECT normalized_name,SUBSTR(dob,1,10) AS dob_key
  FROM mma_active_fighters
  WHERE dob IS NOT NULL
  GROUP BY normalized_name,SUBSTR(dob,1,10)
  HAVING COUNT(*) = 1
) wu ON wu.normalized_name = wf.normalized_name AND wu.dob_key = SUBSTR(wf.dob,1,10)
JOIN (
  SELECT normalized_name,SUBSTR(dob,1,10) AS dob_key
  FROM ufc_fighter_identity_keys
  WHERE dob IS NOT NULL
  GROUP BY normalized_name,SUBSTR(dob,1,10)
  HAVING COUNT(*) = 1
) nu ON nu.normalized_name = n.normalized_name AND nu.dob_key = SUBSTR(n.dob,1,10);

DELETE FROM ufc_fighter_history_summary;
INSERT INTO ufc_fighter_history_summary (
  fighter_id,first_ufc_date,first_pre_ufc_fight_date,last_pre_ufc_fight_date,
  days_from_last_pre_ufc_to_debut,pre_ufc_bouts,pre_ufc_wins,pre_ufc_losses,
  pre_ufc_draws,pre_ufc_no_contests,pre_ufc_finishes,pre_ufc_ko_tko_wins,
  pre_ufc_submission_wins,pre_ufc_decision_wins,pre_ufc_major_org_bouts,
  pre_ufc_distinct_opponents,source_key,snapshot_id,updated_at
)
SELECT
  fb.fighter_id,
  fb.first_ufc_date,
  MIN(h.event_date),
  MAX(h.event_date),
  CASE WHEN MAX(h.event_date) IS NULL THEN NULL
       ELSE CAST(JULIANDAY(fb.first_ufc_date) - JULIANDAY(MAX(h.event_date)) AS INTEGER) END,
  COUNT(h.source_fight_id),
  SUM(CASE WHEN h.result='W' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='L' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='D' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='NC' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='W' AND LOWER(COALESCE(h.method_normalized,h.method_raw,'')) NOT LIKE '%decision%' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='W' AND (LOWER(COALESCE(h.method_normalized,h.method_raw,'')) LIKE '%ko%' OR LOWER(COALESCE(h.method_normalized,h.method_raw,'')) LIKE '%tko%') THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='W' AND LOWER(COALESCE(h.method_normalized,h.method_raw,'')) LIKE '%sub%' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='W' AND LOWER(COALESCE(h.method_normalized,h.method_raw,'')) LIKE '%decision%' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.is_major_org=1 THEN 1 ELSE 0 END),
  COUNT(DISTINCT h.opponent_normalized_name),
  MAX(h.source_key),
  MAX(h.snapshot_id),
  CURRENT_TIMESTAMP
FROM mma_ufc_first_bout fb
LEFT JOIN mma_ufc_pre_ufc_history h ON h.fighter_id = fb.fighter_id
GROUP BY fb.fighter_id,fb.first_ufc_date;

DELETE FROM ufc_prefight_history_features;
INSERT INTO ufc_prefight_history_features (
  fighter_id,ufc_source_key,as_of_date,warehouse_career_bouts,warehouse_career_wins,
  warehouse_career_losses,warehouse_career_draws,warehouse_career_no_contests,
  warehouse_career_finishes,warehouse_finish_rate,warehouse_major_org_bouts,
  warehouse_recent_bouts_730d,warehouse_recent_wins_730d,warehouse_days_since_last_fight,
  pre_ufc_bouts,source_key,snapshot_id,updated_at
)
SELECT
  bt.fighter_id,
  bt.source_key,
  bt.event_date,
  COUNT(h.source_fight_id),
  SUM(CASE WHEN h.result='W' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='L' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='D' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='NC' THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.result='W' AND LOWER(COALESCE(h.method_normalized,h.method_raw,'')) NOT LIKE '%decision%' THEN 1 ELSE 0 END),
  CASE WHEN SUM(CASE WHEN h.result='W' THEN 1 ELSE 0 END) = 0 THEN NULL
       ELSE 1.0 * SUM(CASE WHEN h.result='W' AND LOWER(COALESCE(h.method_normalized,h.method_raw,'')) NOT LIKE '%decision%' THEN 1 ELSE 0 END)
            / SUM(CASE WHEN h.result='W' THEN 1 ELSE 0 END) END,
  SUM(CASE WHEN h.is_major_org=1 THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.event_date >= DATE(bt.event_date,'-730 day') THEN 1 ELSE 0 END),
  SUM(CASE WHEN h.event_date >= DATE(bt.event_date,'-730 day') AND h.result='W' THEN 1 ELSE 0 END),
  CASE WHEN MAX(h.event_date) IS NULL THEN NULL
       ELSE CAST(JULIANDAY(bt.event_date) - JULIANDAY(MAX(h.event_date)) AS INTEGER) END,
  COALESCE(s.pre_ufc_bouts,0),
  MAX(h.source_key),
  MAX(h.snapshot_id),
  CURRENT_TIMESTAMP
FROM bout_totals bt
LEFT JOIN mma_ufc_career_history h
  ON h.fighter_id = bt.fighter_id
 AND h.event_date < bt.event_date
LEFT JOIN ufc_fighter_history_summary s ON s.fighter_id = bt.fighter_id
GROUP BY bt.fighter_id,bt.source_key,bt.event_date,s.pre_ufc_bouts;
`;

function main() {
  const fighters = nativeFighters();
  if (!fighters.length) throw new Error('No UFC-native fighters found; refusing warehouse identity refresh.');

  const dir = mkdtempSync(join(tmpdir(), 'cagemetrix-ufc-history-'));
  try {
    writeIdentityKeys(dir, fighters);
    const refreshPath = join(dir, 'refresh.sql');
    writeFileSync(refreshPath, refreshSql, 'utf8');
    executeFile(refreshPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const linked = queryRows(`SELECT COUNT(*) AS n FROM mma_ufc_linked_fighters`)[0]?.n || 0;
  const preUfcRows = queryRows(`SELECT COUNT(*) AS n FROM mma_ufc_pre_ufc_history`)[0]?.n || 0;
  const summaries = queryRows(`SELECT COUNT(*) AS n FROM ufc_fighter_history_summary`)[0]?.n || 0;
  const prefight = queryRows(`SELECT COUNT(*) AS n FROM ufc_prefight_history_features`)[0]?.n || 0;
  const badScope = queryRows(`SELECT COUNT(*) AS n FROM mma_identity_links l LEFT JOIN fighters f ON f.id=CAST(l.cagemetrix_fighter_id AS INTEGER) WHERE l.cagemetrix_fighter_id IS NOT NULL AND f.id IS NULL`)[0]?.n || 0;
  const futureLeak = queryRows(`SELECT COUNT(*) AS n FROM mma_ufc_pre_ufc_history WHERE event_date >= first_ufc_date`)[0]?.n || 0;

  if (Number(badScope) !== 0) throw new Error(`Warehouse identity scope violation: ${badScope} links target non-UFC-native fighters.`);
  if (Number(futureLeak) !== 0) throw new Error(`Pre-UFC history leakage detected: ${futureLeak} rows are not before UFC debut.`);
  if (Number(linked) < 500) throw new Error(`Warehouse identity coverage unexpectedly low: ${linked} UFC-linked fighters.`);

  const audit = {
    native_ufc_fighters: fighters.length,
    warehouse_linked_ufc_fighters: Number(linked),
    pre_ufc_regional_history_rows: Number(preUfcRows),
    fighter_history_summaries: Number(summaries),
    prefight_history_feature_rows: Number(prefight),
    non_ufc_native_link_violations: Number(badScope),
    pre_ufc_future_leak_rows: Number(futureLeak),
    scope: 'Non-UFC warehouse bouts are retained only as history/context for fighters already present in CageMetrix UFC-native fighters.',
    generated_at: new Date().toISOString()
  };
  mkdirSync('.cache/mma-master', { recursive: true });
  writeFileSync('.cache/mma-master/ufc-history-summary.json', `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(audit, null, 2));
}

main();
