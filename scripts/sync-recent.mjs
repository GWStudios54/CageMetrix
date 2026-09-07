import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseDelimited } from './lib/csv.mjs';
import { STATS_URL, hash } from './lib/dataset.mjs';
import { officialBouts, mirroredStats, sourceRow, nameKey, resultSourcesForEvent, boutSourceUrls } from './lib/recent-source.mjs';

const cache = '.cache/recent';
mkdirSync(cache, { recursive: true });
mkdirSync('scripts/data', { recursive: true });

async function page(url) {
  const file = `${cache}/${hash(url)}.html`;
  if (existsSync(file) && !process.argv.includes('--fresh')) return readFileSync(file, 'utf8');
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), headers:{'user-agent':'CageMetrix data refresh/1.0'} });
  if (!response.ok) throw new Error(`Failed source ${response.status}: ${url}`);
  const html = await response.text();
  writeFileSync(file, html);
  return html;
}
async function optionalPage(url){
  try{return await page(url)}catch(error){
    if(String(error?.message||error).startsWith('Failed source 404:'))return null;
    throw error;
  }
}
function d1Rows(sql){
  if(!process.argv.includes('--remote'))throw new Error('Recent UFC sync requires --remote so completed cards are discovered from CageMetrix D1.');
  const result=execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cagemetrix','--remote','--command',sql,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20*1024*1024});
  return JSON.parse(result).flatMap(block=>block?.results||[]);
}

const stats = await page(STATS_URL);
const rows = parseDelimited(stats, ';');
const dateOf = r => { const [d,m,y] = r.event_date.split('/'); return y ? `${y}-${m}-${d}` : r.event_date; };
const cutoff = rows.map(dateOf).filter(v=>/^20\d{2}-\d{2}-\d{2}$/.test(v)).sort().at(-1);
if(!cutoff)throw new Error('Could not determine the current warehouse coverage date.');
const names = new Map(rows.flatMap(r => [r.red_fighter_name, r.blue_fighter_name]).map(n => [nameKey(n), n]));

const archivePath = 'scripts/data/recent-bouts.json';
const archive = existsSync(archivePath) ? JSON.parse(readFileSync(archivePath,'utf8')) : { events: [] };
for (const row of d1Rows('SELECT payload_json FROM event_source_archive')) {
  const event=JSON.parse(row.payload_json);
  if (!archive.events.some(e=>e.official_url===event.official_url)) archive.events.push(event);
}

const scheduled=d1Rows(`SELECT name,event_date FROM events WHERE promotion='UFC' AND event_date>'${cutoff}' AND event_date<=date('now') AND (name LIKE 'UFC Fight Night%' OR name GLOB 'UFC [0-9]*') ORDER BY event_date`);
const events=scheduled.map(row=>resultSourcesForEvent(row.name,row.event_date)).filter(Boolean);
if(!events.length){
  const covered=archive.events.map(e=>e.date).filter(Boolean).sort().at(-1)||cutoff;
  console.log(`No completed UFC cards newer than warehouse cutoff ${cutoff}. Recent-event coverage through ${covered}.`);
  process.exit(0);
}

for (const event of events) {
  const date=event.date;
  const official = officialBouts(await page(event.officialUrl));
  const imported = [];
  for (const bout of official) {
    let verified=false;
    for(const url of boutSourceUrls(event.statisticsUrl,bout)){
      const html=await optionalPage(url);if(!html)continue;
      const statistics=mirroredStats(html);if(!statistics)continue;
      if(![bout.red,bout.blue].every(n=>statistics.names.some(m=>nameKey(m)===nameKey(n))))continue;
      imported.push(sourceRow(bout,statistics,{name:event.name,date,officialUrl:event.officialUrl,boutUrl:url},names));
      verified=true;break;
    }
    if(!verified)console.warn(`Could not verify statistics page for ${bout.red} vs ${bout.blue}.`);
  }
  if (imported.length !== official.length) throw new Error(`${event.name}: ${imported.length}/${official.length} completed bouts verified; refusing incomplete card. Missing: ${official.filter(b => !imported.some(r => r.official_bout_id === b.officialId)).map(b => `${b.red} vs ${b.blue}`).join(', ')}`);
  archive.events = archive.events.filter(e => e.date !== date);
  archive.events.push({ date, name:event.name, official_url:event.officialUrl, statistics_source:event.statisticsUrl, rows: imported });
  archive.events.sort((a,b) => a.date.localeCompare(b.date));
  writeFileSync(archivePath, JSON.stringify(archive, null, 2) + '\n');
  console.log(`Verified ${event.name}: ${date}, ${imported.length} bouts.`);
}
console.log(`Recent-event coverage through ${archive.events.at(-1)?.date || cutoff}.`);
