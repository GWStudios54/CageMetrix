import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const DB = 'cagemetrix';
const OUT_DIR = '.cache/external-technical-audit';
mkdirSync(OUT_DIR, { recursive: true });

function wrangler(params) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...params], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    maxBuffer: 64 * 1024 * 1024
  });
}

function rows(sql) {
  const raw = wrangler(['d1', 'execute', DB, '--remote', '--command', sql, '--json']);
  const parsed = JSON.parse(raw);
  const parts = Array.isArray(parsed) ? parsed : [parsed];
  return parts.flatMap(part => part.results || []);
}

const snapshot = rows(`
  SELECT source_key,display_name,active_snapshot_id,active_since,upstream_sources_json,notes
  FROM mma_source_registry
  WHERE source_key='leandroiber_mmastats'
`)[0];
if (!snapshot?.active_snapshot_id) throw new Error('No active LeandroIber MMA master snapshot in production D1.');

const sourceSummary = rows(`
  SELECT source_key,snapshot_id,source_max_date,fighter_count,fight_count,participant_count,
         technical_fight_count,organization_count,completed_at
  FROM mma_source_snapshots
  WHERE source_key='leandroiber_mmastats' AND snapshot_id='${String(snapshot.active_snapshot_id).replaceAll("'", "''")}'
`)[0];

const byOrganization = rows(`
WITH participant_quality AS (
  SELECT source_key,snapshot_id,source_fight_id,
    COUNT(*) participants,
    SUM(CASE WHEN sig_str_landed IS NOT NULL AND sig_str_attempted IS NOT NULL THEN 1 ELSE 0 END) sig_participants,
    SUM(CASE WHEN td_landed IS NOT NULL AND td_attempted IS NOT NULL THEN 1 ELSE 0 END) td_participants,
    SUM(CASE WHEN ctrl_seconds IS NOT NULL THEN 1 ELSE 0 END) ctrl_participants,
    SUM(CASE WHEN knockdowns IS NOT NULL THEN 1 ELSE 0 END) kd_participants
  FROM mma_active_participants
  GROUP BY source_key,snapshot_id,source_fight_id
)
SELECT f.organization,
       COUNT(*) fights,
       SUM(CASE WHEN f.has_technical_stats=1 THEN 1 ELSE 0 END) technical_fights,
       ROUND(100.0*SUM(CASE WHEN f.has_technical_stats=1 THEN 1 ELSE 0 END)/COUNT(*),1) technical_pct,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.sig_participants=2 THEN 1 ELSE 0 END) fights_both_sig,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.td_participants=2 THEN 1 ELSE 0 END) fights_both_td,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.ctrl_participants=2 THEN 1 ELSE 0 END) fights_both_ctrl,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.kd_participants=2 THEN 1 ELSE 0 END) fights_both_kd,
       MIN(CASE WHEN f.has_technical_stats=1 THEN f.event_date END) first_technical_date,
       MAX(CASE WHEN f.has_technical_stats=1 THEN f.event_date END) last_technical_date
FROM mma_active_fights f
LEFT JOIN participant_quality q
  ON q.source_key=f.source_key AND q.snapshot_id=f.snapshot_id AND q.source_fight_id=f.source_fight_id
GROUP BY f.organization
HAVING technical_fights > 0
ORDER BY technical_fights DESC, fights DESC
LIMIT 250
`);

const preUfcByOrganization = rows(`
WITH pre AS (
  SELECT DISTINCT source_key,snapshot_id,source_fight_id,organization,event_date
  FROM ufc_warehouse_pre_ufc_rows
), participant_quality AS (
  SELECT source_key,snapshot_id,source_fight_id,
    SUM(CASE WHEN sig_str_landed IS NOT NULL AND sig_str_attempted IS NOT NULL THEN 1 ELSE 0 END) sig_participants,
    SUM(CASE WHEN td_landed IS NOT NULL AND td_attempted IS NOT NULL THEN 1 ELSE 0 END) td_participants,
    SUM(CASE WHEN ctrl_seconds IS NOT NULL THEN 1 ELSE 0 END) ctrl_participants,
    SUM(CASE WHEN knockdowns IS NOT NULL THEN 1 ELSE 0 END) kd_participants
  FROM mma_active_participants
  GROUP BY source_key,snapshot_id,source_fight_id
)
SELECT p.organization,
       COUNT(*) target_fights,
       SUM(CASE WHEN f.has_technical_stats=1 THEN 1 ELSE 0 END) technical_target_fights,
       ROUND(100.0*SUM(CASE WHEN f.has_technical_stats=1 THEN 1 ELSE 0 END)/COUNT(*),1) technical_pct,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.sig_participants=2 THEN 1 ELSE 0 END) fights_both_sig,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.td_participants=2 THEN 1 ELSE 0 END) fights_both_td,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.ctrl_participants=2 THEN 1 ELSE 0 END) fights_both_ctrl,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.kd_participants=2 THEN 1 ELSE 0 END) fights_both_kd,
       MIN(CASE WHEN f.has_technical_stats=1 THEN p.event_date END) first_technical_date,
       MAX(CASE WHEN f.has_technical_stats=1 THEN p.event_date END) last_technical_date
FROM pre p
JOIN mma_active_fights f
  ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
LEFT JOIN participant_quality q
  ON q.source_key=f.source_key AND q.snapshot_id=f.snapshot_id AND q.source_fight_id=f.source_fight_id
GROUP BY p.organization
ORDER BY technical_target_fights DESC, target_fights DESC
LIMIT 250
`);

const preUfcTotals = rows(`
WITH pre AS (
  SELECT DISTINCT source_key,snapshot_id,source_fight_id
  FROM ufc_warehouse_pre_ufc_rows
), quality AS (
  SELECT p.source_key,p.snapshot_id,p.source_fight_id,
    COUNT(*) participants,
    SUM(CASE WHEN p.sig_str_landed IS NOT NULL AND p.sig_str_attempted IS NOT NULL THEN 1 ELSE 0 END) sig_n,
    SUM(CASE WHEN p.td_landed IS NOT NULL AND p.td_attempted IS NOT NULL THEN 1 ELSE 0 END) td_n,
    SUM(CASE WHEN p.ctrl_seconds IS NOT NULL THEN 1 ELSE 0 END) ctrl_n,
    SUM(CASE WHEN p.knockdowns IS NOT NULL THEN 1 ELSE 0 END) kd_n
  FROM mma_active_participants p
  JOIN pre x ON x.source_key=p.source_key AND x.snapshot_id=p.snapshot_id AND x.source_fight_id=p.source_fight_id
  GROUP BY p.source_key,p.snapshot_id,p.source_fight_id
)
SELECT COUNT(*) target_fights,
       SUM(CASE WHEN f.has_technical_stats=1 THEN 1 ELSE 0 END) technical_target_fights,
       ROUND(100.0*SUM(CASE WHEN f.has_technical_stats=1 THEN 1 ELSE 0 END)/COUNT(*),1) technical_pct,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.sig_n=2 THEN 1 ELSE 0 END) fights_both_sig,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.td_n=2 THEN 1 ELSE 0 END) fights_both_td,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.ctrl_n=2 THEN 1 ELSE 0 END) fights_both_ctrl,
       SUM(CASE WHEN f.has_technical_stats=1 AND q.kd_n=2 THEN 1 ELSE 0 END) fights_both_kd
FROM pre p
JOIN mma_active_fights f
  ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
LEFT JOIN quality q
  ON q.source_key=f.source_key AND q.snapshot_id=f.snapshot_id AND q.source_fight_id=f.source_fight_id
`)[0];

const focusPatterns = [
  ['bellator','bellator'],['pfl','professional fighters league'],['lfa','legacy fighting alliance'],
  ['one','one championship'],['ksw','ksw'],['rizin','rizin'],['cage warriors','cage warriors'],
  ['strikeforce','strikeforce'],['wec','world extreme cagefighting'],['pride','pride'],['dream','dream'],
  ['elitexc','elitexc'],['affliction','affliction'],['cage rage','cage rage'],['ifl','international fight league'],
  ['invicta','invicta'],['titan','titan'],['rfa','resurrection fighting alliance']
];
const focus = {};
for (const [key, pattern] of focusPatterns) {
  focus[key] = rows(`
    WITH matched AS (
      SELECT f.* FROM mma_active_fights f
      WHERE LOWER(f.organization) LIKE '%${pattern.replaceAll("'", "''")}%' OR LOWER(f.event_name) LIKE '%${pattern.replaceAll("'", "''")}%' 
    )
    SELECT COUNT(*) fights,
           SUM(CASE WHEN has_technical_stats=1 THEN 1 ELSE 0 END) technical_fights,
           MIN(CASE WHEN has_technical_stats=1 THEN event_date END) first_technical_date,
           MAX(CASE WHEN has_technical_stats=1 THEN event_date END) last_technical_date
    FROM matched
  `)[0];
}

const report = {
  generated_at: new Date().toISOString(),
  registry: snapshot,
  source_snapshot: sourceSummary,
  pre_ufc_totals: preUfcTotals,
  focus,
  organizations_with_technical_stats: byOrganization,
  pre_ufc_organizations: preUfcByOrganization
};

writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2) + '\n');

console.log('Existing CageMetrix external technical coverage audit');
console.log(JSON.stringify({
  source_snapshot: sourceSummary,
  pre_ufc_totals: preUfcTotals,
  focus,
  top_technical_organizations: byOrganization.slice(0, 30),
  top_pre_ufc_organizations: preUfcByOrganization.slice(0, 40)
}, null, 2));
