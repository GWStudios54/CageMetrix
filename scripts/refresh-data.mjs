import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { prepareDataset, datasetSql, statusSql, q, hash, STATS_URL, DETAILS_URL } from './lib/dataset.mjs';
import { parseDelimited, parseDate } from './lib/csv.mjs';
import { applyWarehousePrior, normalizeFighterName, warehouseSummarySnapshot } from './lib/warehouse-prior.mjs';
import { PREDICTOR_V02_PRIOR_OPTIONS } from './lib/predictor_v02.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const remote = args.includes('--remote');
const dryRun = args.includes('--dry-run');
if (!remote && !dryRun && !args.includes('--local')) throw new Error('Choose --dry-run, --local or --remote explicitly');
const directory = option('--output') || '.cache/refresh';
mkdirSync(directory, { recursive: true });
async function source(file, url) {
  if (file) return readFileSync(file, 'utf8');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Source request failed: ${response.status} (${url})`);
  return response.text();
}
function wrangler(params, capture = false) {
  // Invoke the installed JavaScript entrypoint directly; portable on Windows.
  const output = execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...params], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer:50*1024*1024 });
  if (!capture) writeFileSync(`${directory}/wrangler-output.log`,output);
  return output;
}
function d1Rows(target, sql) {
  const parsed = JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  const parts = Array.isArray(parsed) ? parsed : [parsed];
  return parts.flatMap(part => part.results || []);
}
function loadWarehouseHistory(target, required = false) {
  try {
    const rows = d1Rows(target, `SELECT f.name AS fighter_name,h.* FROM ufc_fighter_history_summary h JOIN fighters f ON f.id=h.fighter_id WHERE h.pre_ufc_bouts>0 ORDER BY h.fighter_id`);
    if (required && rows.length < 1000) throw new Error(`Warehouse history coverage is unexpectedly small: ${rows.length}`);
    return rows;
  } catch (error) {
    if (required) throw error;
    console.warn('Warehouse history unavailable for this dry/local preparation; base UFC ratings only.');
    return [];
  }
}
function applyWarehouseHistory(data, rows) {
  const summaries = new Map();
  for (const row of rows) {
    const key = normalizeFighterName(row.fighter_name);
    if (key && !summaries.has(key)) summaries.set(key,row);
  }
  const names = new Map(data.fighters.map(f => [f.id,f.name]));
  let applied = 0;
  data.ratings = data.ratings.map(rating => {
    const summary = summaries.get(normalizeFighterName(names.get(rating.fighterId))) || null;
    if (!summary) return rating;
    const enriched = applyWarehousePrior(rating, summary, PREDICTOR_V02_PRIOR_OPTIONS);
    if (!enriched) return rating;
    applied += 1;
    enriched.warehouseSummary = summary;
    enriched.components = {
      ...(rating.components || {}),
      warehouse_prior: {
        pre_ufc_bouts: Number(summary.pre_ufc_bouts || 0),
        pre_ufc_wins: Number(summary.pre_ufc_wins || 0),
        pre_ufc_losses: Number(summary.pre_ufc_losses || 0),
        pre_ufc_finishes: Number(summary.pre_ufc_finishes || 0),
        pre_ufc_major_org_bouts: Number(summary.pre_ufc_major_org_bouts || 0),
        prior_score: enriched.warehousePrior?.score ?? null,
        reliability: enriched.warehousePrior?.reliability ?? null,
        applied_weight: enriched.warehousePriorWeight ?? 0,
        scope: 'completed pre-UFC history only'
      }
    };
    return enriched;
  });
  return applied;
}

const [baseStats, details] = await Promise.all([source(option('--stats'), STATS_URL), source(option('--details'), DETAILS_URL)]);
const baseRows = parseDelimited(baseStats, ';');
const baseMax = baseRows.map(r => parseDate(r.event_date)).sort().at(-1);
const supplement = JSON.parse(readFileSync('scripts/data/recent-bouts.json','utf8'));
if (remote) {
  const saved = JSON.parse(wrangler(['d1','execute','cagemetrix','--remote','--command','SELECT payload_json FROM event_source_archive','--json'],true))[0]?.results || [];
  for (const row of saved) {
    const event = JSON.parse(row.payload_json);
    if (!supplement.events.some(e=>e.official_url===event.official_url)) supplement.events.push(event);
  }
  supplement.events.sort((a,b)=>a.date.localeCompare(b.date));
  writeFileSync('scripts/data/recent-bouts.json',JSON.stringify(supplement,null,2)+'\n');
}
const merged = [...baseRows, ...supplement.events.filter(e => e.date > baseMax).flatMap(e => e.rows)];
const columns = [...new Set(merged.flatMap(r => Object.keys(r)))];
const csvField = value => `"${String(value ?? '').replaceAll('"','""')}"`;
const stats = [columns.join(';'), ...merged.map(r => columns.map(k => csvField(r[k])).join(';'))].join('\n');
writeFileSync(`${directory}/stats.csv`, stats);
writeFileSync(`${directory}/details.csv`, details);
const target = remote ? '--remote' : '--local';
const warehouseRows = loadWarehouseHistory(target, remote);
const warehouseFingerprint = warehouseRows.length ? hash(JSON.stringify(warehouseSummarySnapshot(warehouseRows))) : null;
const data = prepareDataset(stats, details, new Date().toISOString(), { warehouseFingerprint });
data.eventArchive = supplement.events;
const warehousePriorRatings = applyWarehouseHistory(data, warehouseRows);
// A partial source fetch must never replace the full database.
if (data.pairs.length < 8500 || data.fighters.length < 2600) throw new Error('Source is incomplete; retaining existing dataset');
const sqlPath = `${directory}/refresh.sql`;
writeFileSync(`${directory}/summary.json`, JSON.stringify({ snapshot_key: data.snapshotKey, source_max_date: data.sourceMaxDate, warehouse_fingerprint: warehouseFingerprint, warehouse_summary_rows: warehouseRows.length, fighters: data.fighters.length, ratings: data.ratings.length, bouts: data.pairs.length, warehouse_prior_ratings: warehousePriorRatings }, null, 2));
if (!dryRun) {
  const previous = JSON.parse(wrangler(['d1', 'execute', 'cagemetrix', target, '--command', "SELECT value FROM bootstrap_state WHERE key='data:latest'", '--json'], true))[0]?.results?.[0];
  const prior = previous ? JSON.parse(previous.value) : null;
  if (prior && (data.sourceMaxDate < prior.source_max_date || data.pairs.length < prior.bouts)) throw new Error('Source regressed; retaining existing dataset');
  const existing = JSON.parse(wrangler(['d1', 'execute', 'cagemetrix', target, '--command', `SELECT id FROM rating_runs WHERE source_key=${q(data.snapshotKey)} AND completed_at IS NOT NULL LIMIT 1`, '--json'], true))[0]?.results?.length;
  if (existing) {
    // Update freshness and activity labels without changing any rating snapshot.
    const activitySql = data.fighters.map(f => `UPDATE fighters SET active=${f.roster.active},roster_status=${q(f.roster.status)},status_source=${q(f.roster.source)} WHERE slug=${q(f.slug)};`).join('\n');
    writeFileSync(sqlPath, activitySql + '\n' + statusSql(data));
    wrangler(['d1', 'execute', 'cagemetrix', target, '--file', sqlPath]);
    console.log(`Source unchanged; coverage through ${data.sourceMaxDate}.`);
    process.exit(0);
  }
  if (remote) wrangler(['d1', 'export', 'cagemetrix', '--remote', '--output', `${directory}/before-refresh.sql`]);
}
writeFileSync(sqlPath, datasetSql(data));
if (!dryRun) wrangler(['d1', 'execute', 'cagemetrix', target, '--file', sqlPath]);
console.log(`${dryRun ? 'Prepared' : 'Refreshed'} ${data.ratings.length} ratings / ${data.fighters.length} fighters / ${data.pairs.length} bouts, through ${data.sourceMaxDate}; warehouse prior applied to ${warehousePriorRatings} ratings.`);
