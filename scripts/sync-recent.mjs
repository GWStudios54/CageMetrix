import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseDelimited } from './lib/csv.mjs';
import { STATS_URL, hash } from './lib/dataset.mjs';
import { liveFeedBouts } from '../src/live-results.ts';
import { boutSourceUrls, eventIdFromOfficialPage, mirroredStats, nameKey, officialFeedEventId, resultSourcesForEvent, sourceRow } from './lib/recent-source.mjs';

const cache = '.cache/recent';
const LIVE_FEED_BASE='https://d29dxerjsp82wz.cloudfront.net/api/v3/event/live';
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
async function jsonSource(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{accept:'application/json','cache-control':'no-cache','user-agent':'CageMetrix data refresh/1.0'}});
  if(!response.ok)throw new Error(`Failed official feed ${response.status}: ${url}`);
  return response.json();
}
function d1Rows(sql){
  if(!process.argv.includes('--remote'))throw new Error('Recent UFC sync requires --remote so completed cards are discovered from CageMetrix D1.');
  const result=execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cagemetrix','--remote','--command',sql,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20*1024*1024});
  return JSON.parse(result).flatMap(block=>block?.results||[]);
}
const one=value=>{const values=[...new Set(value||[])];return values.length===1?String(values[0]):'';};

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

const scheduled=d1Rows(`SELECT id,name,event_date,source_url FROM events WHERE promotion='UFC' AND event_date>'${cutoff}' AND event_date<=date('now') AND (name LIKE 'UFC Fight Night%' OR name GLOB 'UFC [0-9]*') ORDER BY event_date`);
const events=scheduled.map(row=>({...row,sources:resultSourcesForEvent(row.name,row.event_date)})).filter(row=>row.sources);
if(!events.length){
  const covered=archive.events.map(e=>e.date).filter(Boolean).sort().at(-1)||cutoff;
  console.log(`No completed UFC cards newer than warehouse cutoff ${cutoff}. Recent-event coverage through ${covered}.`);
  process.exit(0);
}

for (const event of events) {
  const eventId=Number(event.id);if(!Number.isInteger(eventId)||eventId<1)throw new Error(`Invalid CageMetrix event id for ${event.name}`);
  const observation=d1Rows(`SELECT o.source_url FROM bout_result_observations o JOIN bouts b ON b.id=o.bout_id WHERE b.event_id=${eventId} AND instr(o.source_url,'${LIVE_FEED_BASE}/')=1 AND substr(o.source_url,-5)='.json' ORDER BY o.observed_at DESC LIMIT 1`)[0];
  let feedUrl=String(observation?.source_url||''),feedEventId=officialFeedEventId(feedUrl);
  if(!feedEventId){
    const officialHtml=await page(event.source_url||event.sources.officialUrl);
    feedEventId=eventIdFromOfficialPage(officialHtml);
    if(!feedEventId)throw new Error(`Official UFC LiveStats event id unavailable for ${event.name}`);
    feedUrl=`${LIVE_FEED_BASE}/${feedEventId}.json`;
  }
  const payload=await jsonSource(feedUrl);
  const stored=d1Rows(`SELECT source_key,weight_class FROM bouts WHERE event_id=${eventId} AND source_key IS NOT NULL`);
  const storedByOfficialId=new Map(stored.map(row=>[String(row.source_key).split(':')[1],row]));
  const finalFeed=liveFeedBouts(payload,feedEventId).filter(b=>b.sourceStatus==='Final');
  if(!finalFeed.length)throw new Error(`Official UFC LiveStats has no Final bouts for ${event.name}`);
  const official=finalFeed.map(bout=>{
    const storedBout=storedByOfficialId.get(bout.officialId);
    if(!storedBout)throw new Error(`Official UFC bout ${bout.officialId} is missing from CageMetrix event ${event.name}`);
    const method=one(bout.methods),round=one(bout.rounds),time=one(bout.times);
    const redResult=bout.redOutcome==='win'&&bout.blueOutcome==='loss'?'W':bout.redOutcome==='loss'&&bout.blueOutcome==='win'?'L':'';
    const blueResult=bout.blueOutcome==='win'&&bout.redOutcome==='loss'?'W':bout.blueOutcome==='loss'&&bout.redOutcome==='win'?'L':'';
    if(!method||!/^[1-5]$/.test(round)||!/^\d:[0-5]\d$/.test(time)||!redResult||!blueResult)throw new Error(`Unsupported or incomplete official Final result for ${bout.red} vs ${bout.blue}`);
    return {officialId:bout.officialId,red:bout.red,blue:bout.blue,redSlug:bout.redSlug,blueSlug:bout.blueSlug,redResult,blueResult,method,round,time,division:String(storedBout.weight_class||'')};
  });
  const imported = [];
  for (const bout of official) {
    let verified=false;
    for(const url of boutSourceUrls(event.sources.statisticsUrl,bout)){
      const html=await optionalPage(url);if(!html)continue;
      const statistics=mirroredStats(html);if(!statistics)continue;
      if(![bout.red,bout.blue].every(n=>statistics.names.some(m=>nameKey(m)===nameKey(n))))continue;
      imported.push(sourceRow(bout,statistics,{name:event.sources.name,date:event.sources.date,officialUrl:feedUrl,boutUrl:url},names));
      verified=true;break;
    }
    if(!verified)console.warn(`Could not verify statistics page for ${bout.red} vs ${bout.blue}.`);
  }
  if (imported.length !== official.length) throw new Error(`${event.sources.name}: ${imported.length}/${official.length} completed bouts verified; refusing incomplete card. Missing: ${official.filter(b => !imported.some(r => r.official_bout_id === b.officialId)).map(b => `${b.red} vs ${b.blue}`).join(', ')}`);
  archive.events = archive.events.filter(e => e.date !== event.sources.date);
  archive.events.push({ date:event.sources.date, name:event.sources.name, official_url:feedUrl, statistics_source:event.sources.statisticsUrl, rows: imported });
  archive.events.sort((a,b) => a.date.localeCompare(b.date));
  writeFileSync(archivePath, JSON.stringify(archive, null, 2) + '\n');
  console.log(`Verified ${event.sources.name}: ${event.sources.date}, ${imported.length} bouts against UFC LiveStats.`);
}
console.log(`Recent-event coverage through ${archive.events.at(-1)?.date || cutoff}.`);
