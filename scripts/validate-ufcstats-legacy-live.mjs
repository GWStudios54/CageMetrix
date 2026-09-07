import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const DB = 'cagemetrix';
const OUT_DIR = '.cache/ufcstats-legacy-validation';
const BASE = 'http://ufcstats.com';
mkdirSync(OUT_DIR, { recursive: true });

function wrangler(params) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...params], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    maxBuffer: 64 * 1024 * 1024
  });
}
function d1Rows(sql) {
  const raw = wrangler(['d1', 'execute', DB, '--remote', '--command', sql, '--json']);
  const parsed = JSON.parse(raw);
  const parts = Array.isArray(parsed) ? parsed : [parsed];
  return parts.flatMap(part => part.results || []);
}
async function fetchText(url) {
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'CageMetrix legacy-stat validation/1.0' },
        redirect: 'follow', signal: AbortSignal.timeout(20000)
      });
      if (response.ok) return { status: response.status, url: response.url, text: await response.text() };
      if (response.status === 404) return null;
      last = new Error(`HTTP ${response.status}: ${url}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw last;
}
const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
function nameKey(value) {
  return tidy(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\b(jr|sr|ii|iii|iv)\b$/i, '').trim();
}
const boutKey = (a, b) => [nameKey(a), nameKey(b)].sort().join('|');
function isoDate(value) {
  const raw = tidy(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(`${raw} 12:00:00 UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}
function pair(value) { return /^(\d+)\s+(?:of|\/)\s+(\d+)$/i.exec(tidy(value)); }
function integer(value) { return /^\d+$/.test(tidy(value)); }
function clock(value) { return /^(?:\d+:\d{2}|--)$/.test(tidy(value)); }

function parseFightTotals(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const tables = [...doc.querySelectorAll('table')];
  const table = tables.find(candidate => {
    const header = tidy(candidate.querySelector('thead')?.textContent).toUpperCase();
    return header.includes('SIG. STR.') && header.includes('TOTAL STR.') && header.includes('TD') && header.includes('CTRL');
  });
  if (!table) { dom.window.close(); return null; }
  const rows = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const cells = [...tr.querySelectorAll('td')];
    if (cells.length < 10) continue;
    const values = cells.map(cell => [...cell.querySelectorAll('p')].map(p => tidy(p.textContent)).filter(Boolean));
    if (values[0]?.length < 2) continue;
    rows.push({
      fighters: values[0].slice(0, 2),
      kd: values[1].slice(0, 2),
      sig: values[2].slice(0, 2),
      total: values[4].slice(0, 2),
      td: values[5].slice(0, 2),
      sub: values[7].slice(0, 2),
      rev: values[8].slice(0, 2),
      ctrl: values[9].slice(0, 2)
    });
  }
  dom.window.close();
  if (!rows.length) return null;
  const rowComplete = row => row.fighters.length === 2 && row.sig.every(v => pair(v)) && row.total.every(v => pair(v)) && row.td.every(v => pair(v)) && row.kd.every(integer) && row.sub.every(integer) && row.ctrl.every(clock);
  return { rows, complete: rows.every(rowComplete), sample: rows[0] };
}

function parseEventIndex(html) {
  const dom = new JSDOM(html);
  const out = [];
  for (const a of dom.window.document.querySelectorAll('a[href*="event-details"]')) {
    const row = a.closest('tr');
    const href = a.href || a.getAttribute('href');
    const title = tidy(a.textContent);
    const dateText = tidy(row?.querySelector('.b-statistics__date')?.textContent || row?.querySelector('span')?.textContent);
    const date = isoDate(dateText);
    if (href && title && date && !out.some(item => item.href === href)) out.push({ href, title, date });
  }
  dom.window.close();
  return out;
}
function parseEventFights(html) {
  const dom = new JSDOM(html);
  const out = [];
  for (const row of dom.window.document.querySelectorAll('tr')) {
    const fighterLinks = [...row.querySelectorAll('a[href*="fighter-details"]')];
    if (fighterLinks.length < 2) continue;
    const fighters = fighterLinks.slice(0, 2).map(a => tidy(a.textContent));
    const fightUrl = row.getAttribute('data-link') || row.querySelector('a[href*="fight-details"]')?.href || null;
    if (fightUrl && fighters.every(Boolean)) out.push({ fighters, fightUrl });
  }
  dom.window.close();
  return out;
}

const controls = [
  ['Strikeforce', `${BASE}/fight-details/827c4504313e79bc`],
  ['WEC', `${BASE}/fight-details/0091e56e746971f4`],
  ['PRIDE', `${BASE}/fight-details/0fc0e33891539d9c`]
];
const controlResults = [];
for (const [promotion, url] of controls) {
  const fetched = await fetchText(url);
  const parsed = fetched ? parseFightTotals(fetched.text) : null;
  controlResults.push({ promotion, status: fetched?.status ?? 404, url: fetched?.url ?? url, complete: Boolean(parsed?.complete), sample: parsed?.sample ?? null });
  console.log(`${promotion} control: status=${fetched?.status ?? 404} complete=${Boolean(parsed?.complete)}`);
}
if (controlResults.filter(item => item.complete).length < 3) throw new Error('Legacy UFCStats control pages no longer expose the expected technical totals.');

const rawTargets = d1Rows(`
  SELECT source_fight_id,event_date,organization,event_name,fighter_name,opponent_name
  FROM ufc_warehouse_pre_ufc_rows
  WHERE event_date <= '2014-12-31'
    AND LOWER(organization) IN ('strikeforce','wec','pride')
  ORDER BY event_date DESC
`);
const targets = [];
const seenTargets = new Set();
for (const row of rawTargets) {
  const key = `${row.source_fight_id}|${boutKey(row.fighter_name, row.opponent_name)}`;
  if (seenTargets.has(key)) continue;
  seenTargets.add(key);
  targets.push({ ...row, bout_key: boutKey(row.fighter_name, row.opponent_name) });
}
const targetsByDate = new Map();
for (const target of targets) {
  const date = String(target.event_date).slice(0, 10);
  if (!targetsByDate.has(date)) targetsByDate.set(date, []);
  targetsByDate.get(date).push(target);
}

const indexFetch = await fetchText(`${BASE}/statistics/events/completed?page=all`);
if (!indexFetch) throw new Error('UFCStats completed-event index unavailable.');
const events = parseEventIndex(indexFetch.text);
if (events.length < 100) throw new Error(`UFCStats event index unexpectedly small: ${events.length}`);

const relevantEvents = events.filter(event => targetsByDate.has(event.date) && /^(strikeforce|wec|pride)\b/i.test(event.title));
const matched = [];
const promotionCounts = new Map();
for (const event of relevantEvents) {
  const fetched = await fetchText(event.href);
  if (!fetched) continue;
  const fights = parseEventFights(fetched.text);
  const dateTargets = targetsByDate.get(event.date) || [];
  for (const fight of fights) {
    const key = boutKey(fight.fighters[0], fight.fighters[1]);
    const target = dateTargets.find(item => item.bout_key === key);
    if (!target) continue;
    const detail = await fetchText(fight.fightUrl);
    const totals = detail ? parseFightTotals(detail.text) : null;
    matched.push({
      promotion: target.organization,
      event_date: target.event_date,
      target_event: target.event_name,
      ufcstats_event: event.title,
      fighter: target.fighter_name,
      opponent: target.opponent_name,
      fight_url: fight.fightUrl,
      technical_complete: Boolean(totals?.complete),
      sample: totals?.sample ?? null
    });
    const p = String(target.organization).toLowerCase();
    if (!promotionCounts.has(p)) promotionCounts.set(p, { targets: targets.filter(t => String(t.organization).toLowerCase() === p).length, matched: 0, technical: 0 });
    const c = promotionCounts.get(p); c.matched += 1; if (totals?.complete) c.technical += 1;
  }
}
for (const promotion of ['strikeforce','wec','pride']) {
  if (!promotionCounts.has(promotion)) promotionCounts.set(promotion, { targets: targets.filter(t => String(t.organization).toLowerCase() === promotion).length, matched: 0, technical: 0 });
}

const report = {
  generated_at: new Date().toISOString(),
  controls: controlResults,
  ufcstats_events: events.length,
  relevant_legacy_events: relevantEvents.length,
  production_targets: targets.length,
  production_identity_matches: matched.length,
  production_complete_technical_matches: matched.filter(item => item.technical_complete).length,
  by_promotion: Object.fromEntries([...promotionCounts.entries()].sort()),
  samples: matched.filter(item => item.technical_complete).slice(0, 20)
};
report.identity_match_rate = matched.length / Math.max(1, targets.length);
report.technical_match_rate = report.production_complete_technical_matches / Math.max(1, targets.length);
writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

if (report.production_complete_technical_matches === 0) throw new Error('UFCStats legacy source matched zero production pre-UFC technical fights.');
