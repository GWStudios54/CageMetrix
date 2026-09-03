import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { prepareDataset, datasetSql, statusSql, q, STATS_URL, DETAILS_URL } from './lib/dataset.mjs';
import { parseDelimited, parseDate } from './lib/csv.mjs';

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
const data = prepareDataset(stats, details);
data.eventArchive = supplement.events;
// A partial source fetch must never replace the full database.
if (data.pairs.length < 8500 || data.fighters.length < 2600) throw new Error('Source is incomplete; retaining existing dataset');
const sqlPath = `${directory}/refresh.sql`;
writeFileSync(`${directory}/summary.json`, JSON.stringify({ snapshot_key: data.snapshotKey, source_max_date: data.sourceMaxDate, fighters: data.fighters.length, ratings: data.ratings.length, bouts: data.pairs.length }, null, 2));
function wrangler(params, capture = false) {
  // Invoke the installed JavaScript entrypoint directly; portable on Windows.
  const output = execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...params], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer:50*1024*1024 });
  if (!capture) writeFileSync(`${directory}/wrangler-output.log`,output);
  return output;
}
if (!dryRun) {
  const target = remote ? '--remote' : '--local';
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
if (!dryRun) wrangler(['d1', 'execute', 'cagemetrix', remote ? '--remote' : '--local', '--file', sqlPath]);
console.log(`${dryRun ? 'Prepared' : 'Refreshed'} ${data.ratings.length} ratings / ${data.fighters.length} fighters / ${data.pairs.length} bouts, through ${data.sourceMaxDate}.`);
