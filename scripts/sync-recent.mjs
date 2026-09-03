import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { parseDelimited } from './lib/csv.mjs';
import { STATS_URL, hash } from './lib/dataset.mjs';
import { officialBouts, mirroredStats, sourceRow, nameKey } from './lib/recent-source.mjs';

const cache = '.cache/recent';
mkdirSync(cache, { recursive: true });
mkdirSync('scripts/data', { recursive: true });
async function page(url) {
  const file = `${cache}/${hash(url)}.html`;
  if (existsSync(file) && !process.argv.includes('--fresh')) return readFileSync(file, 'utf8');
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Failed source ${response.status}: ${url}`);
  const html = await response.text();
  writeFileSync(file, html);
  return html;
}
const stats = await page(STATS_URL);
const rows = parseDelimited(stats, ';');
const dateOf = r => { const [d,m,y] = r.event_date.split('/'); return y ? `${y}-${m}-${d}` : r.event_date; };
const cutoff = rows.map(dateOf).sort().at(-1);
const names = new Map(rows.flatMap(r => [r.red_fighter_name, r.blue_fighter_name]).map(n => [nameKey(n), n]));
const officialList = new JSDOM(await page('https://www.ufc.com/events')).window.document;
const officialLinks = [...new Set([...officialList.querySelectorAll('a[href]')].map(a => new URL(a.href, 'https://www.ufc.com').href.split('#')[0]).filter(h => h.includes('/event/')))];
const resultDoc = new JSDOM(await page('https://www.ufcalendar.com/results')).window.document;
const list = [...resultDoc.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent)).find(x => x['@type'] === 'ItemList');
if (!list) throw new Error('No recent result archive');
const events = list.itemListElement.filter(e => /^UFC (?:\d|Fight Night)/.test(e.name)).filter(e => e.url.match(/\d{4}-\d{2}-\d{2}/)?.[0] > cutoff).reverse();
const archivePath = 'scripts/data/recent-bouts.json';
const archive = existsSync(archivePath) ? JSON.parse(readFileSync(archivePath,'utf8')) : { events: [] };
if (process.argv.includes('--remote')) {
  const result = execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cagemetrix','--remote','--command','SELECT payload_json FROM event_source_archive','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20*1024*1024});
  for (const row of JSON.parse(result)[0]?.results || []) {
    const event=JSON.parse(row.payload_json);
    if (!archive.events.some(e=>e.official_url===event.official_url)) archive.events.push(event);
  }
}
for (const event of events) {
  const indexedDate = event.url.match(/\d{4}-\d{2}-\d{2}/)[0];
  // The two July US cards are indexed under their UTC Sunday; UFC uses local Saturday.
  const date = ({'2026-07-12':'2026-07-11','2026-07-19':'2026-07-18'})[indexedDate] || indexedDate;
  if (archive.events.some(e => e.date === date) && !process.argv.includes('--fresh')) continue;
  const month = new Date(`${date}T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone:'UTC' }).toLowerCase();
  const numbered = event.name.match(/^UFC (\d+)/)?.[1];
  const officialUrl = numbered ? `https://www.ufc.com/event/ufc-${numbered}` : archive.events.find(e => e.date === date)?.official_url || officialLinks.find(h => h.endsWith(`${month}-${date.slice(8)}-${date.slice(0,4)}`));
  if (!officialUrl) throw new Error(`Official UFC event link missing for ${event.name}`);
  const official = officialBouts(await page(officialUrl));
  const doc = new JSDOM(await page(event.url)).window.document;
  const eventPath = new URL(event.url).pathname;
  const links = [...new Set([...doc.querySelectorAll('a[href]')].map(a => new URL(a.href,event.url).href).filter(h => new URL(h).pathname.startsWith(eventPath + '/') && h.includes('-vs-')))];
  const imported = [];
  for (const url of links) {
    const html = await page(url);
    const statistics = mirroredStats(html);
    if (!statistics) continue; // Cancelled/replaced matchups have no completed box score.
    const bout = official.find(b => [b.red,b.blue].every(n => statistics.names.some(m => nameKey(m) === nameKey(n))));
    if (!bout) continue;
    if (imported.some(r => r.official_bout_id === bout.officialId)) continue;
    imported.push(sourceRow(bout, statistics, { name: event.name, date, officialUrl, boutUrl:url }, names));
  }
  if (imported.length !== official.length) throw new Error(`${event.name}: ${imported.length}/${official.length} bouts verified; refusing incomplete card. Missing: ${official.filter(b => !imported.some(r => r.official_bout_id === b.officialId)).map(b => `${b.red} vs ${b.blue}`).join(', ')}`);
  archive.events = archive.events.filter(e => e.date !== date);
  archive.events.push({ date, name: event.name, official_url: officialUrl, statistics_source: event.url, rows: imported });
  archive.events.sort((a,b) => a.date.localeCompare(b.date));
  writeFileSync(archivePath, JSON.stringify(archive, null, 2) + '\n');
  console.log(`Verified ${event.name}: ${date}, ${imported.length} bouts.`);
}
console.log(`Recent-event coverage through ${archive.events.at(-1)?.date || cutoff}.`);
