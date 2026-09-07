import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

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
const isPair = value => /^(\d+)\s+(?:of|\/)\s+(\d+)$/i.test(tidy(value));
const isInteger = value => /^\d+$/.test(tidy(value));
const isClock = value => /^\d+:\d{2}$/.test(tidy(value));

async function openUfcStats(page, url, readySelector) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const status = response?.status() ?? 0;
      if (status === 404) return { status, url: page.url(), ready: false, challenge: false };
      if (status >= 400) throw new Error(`HTTP ${status}: ${url}`);
      try {
        await page.waitForFunction(selector => {
          const body = document.body?.innerText || '';
          const challenged = /checking your browser|verify you are human|just a moment/i.test(body);
          return !challenged && Boolean(document.querySelector(selector));
        }, readySelector, { timeout: 20000 });
      } catch {
        // Capture the state below. This lets the report distinguish selector drift
        // from the JavaScript interstitial that plain HTTP clients receive.
      }
      const state = await page.evaluate(selector => {
        const body = document.body?.innerText || '';
        return {
          ready: Boolean(document.querySelector(selector)),
          challenge: /checking your browser|verify you are human|just a moment/i.test(body),
          title: document.title,
          bodyPrefix: body.replace(/\s+/g, ' ').trim().slice(0, 180)
        };
      }, readySelector);
      return { status, url: page.url(), ...state };
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function liveFightTechnical(page) {
  const tables = await page.evaluate(() => [...document.querySelectorAll('table.b-fight-details__table, table')].map(table => ({
    headers: [...table.querySelectorAll('th')].map(th => (th.textContent || '').replace(/\s+/g, ' ').trim()),
    rows: [...table.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('td')].map(cell => {
      const paragraphs = [...cell.querySelectorAll('p')].map(p => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      return paragraphs.length ? paragraphs : [(cell.textContent || '').replace(/\s+/g, ' ').trim()].filter(Boolean);
    })).filter(cells => cells.length)
  })));

  const table = tables.find(candidate => {
    const header = candidate.headers.join(' ').toUpperCase();
    return header.includes('SIG. STR') && header.includes('TOTAL STR') && header.includes('TD') && header.includes('CTRL');
  });
  if (!table) return { rows: [], coreTechnical: false, fullCmr: false, sample: null };

  const rows = [];
  for (const cells of table.rows) {
    if (cells.length < 10 || (cells[0] || []).length < 2) continue;
    rows.push({
      fighters: cells[0].slice(0, 2).map(tidy),
      kd: (cells[1] || []).slice(0, 2).map(tidy),
      sig: (cells[2] || []).slice(0, 2).map(tidy),
      total: (cells[4] || []).slice(0, 2).map(tidy),
      td: (cells[5] || []).slice(0, 2).map(tidy),
      sub: (cells[7] || []).slice(0, 2).map(tidy),
      rev: (cells[8] || []).slice(0, 2).map(tidy),
      ctrl: (cells[9] || []).slice(0, 2).map(tidy)
    });
  }
  const coreComplete = row => row.fighters.length === 2 && row.sig.length === 2 && row.sig.every(isPair)
    && row.total.length === 2 && row.total.every(isPair)
    && row.td.length === 2 && row.td.every(isPair)
    && row.kd.length === 2 && row.kd.every(isInteger)
    && row.sub.length === 2 && row.sub.every(isInteger);
  const fullComplete = row => coreComplete(row) && row.ctrl.length === 2 && row.ctrl.every(isClock);
  const coreRows = rows.filter(coreComplete);
  const fullRows = rows.filter(fullComplete);
  return {
    rows,
    coreTechnical: coreRows.length > 0,
    fullCmr: fullRows.length > 0,
    sample: fullRows[0] || coreRows[0] || rows[0] || null
  };
}

async function liveEventIndex(page) {
  const raw = await page.evaluate(() => [...document.querySelectorAll('a[href*="event-details"]')].map(a => {
    const row = a.closest('tr');
    return {
      href: a.href || a.getAttribute('href'),
      title: (a.textContent || '').replace(/\s+/g, ' ').trim(),
      dateText: (row?.querySelector('.b-statistics__date')?.textContent || row?.querySelector('span')?.textContent || '').replace(/\s+/g, ' ').trim()
    };
  }));
  const out = [];
  for (const item of raw) {
    const date = isoDate(item.dateText);
    if (item.href && item.title && date && !out.some(existing => existing.href === item.href)) out.push({ href: item.href, title: item.title, date });
  }
  return out;
}

async function liveEventFights(page) {
  return page.evaluate(() => [...document.querySelectorAll('tr')].flatMap(row => {
    const fighterLinks = [...row.querySelectorAll('a[href*="fighter-details"]')];
    if (fighterLinks.length < 2) return [];
    const fighters = fighterLinks.slice(0, 2).map(a => (a.textContent || '').replace(/\s+/g, ' ').trim());
    const fightUrl = row.getAttribute('data-link') || row.querySelector('a[href*="fight-details"]')?.href || null;
    return fightUrl && fighters.every(Boolean) ? [{ fighters, fightUrl }] : [];
  }));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  viewport: { width: 1280, height: 900 }
});
const page = await context.newPage();

try {
  const controls = [
    ['Strikeforce', `${BASE}/fight-details/827c4504313e79bc`],
    ['WEC', `${BASE}/fight-details/0091e56e746971f4`],
    ['PRIDE', `${BASE}/fight-details/0fc0e33891539d9c`]
  ];
  const controlResults = [];
  for (const [promotion, url] of controls) {
    const state = await openUfcStats(page, url, 'table.b-fight-details__table, .b-fight-details__section');
    const parsed = state.ready ? await liveFightTechnical(page) : null;
    controlResults.push({
      promotion,
      status: state.status,
      url: state.url,
      challenge: state.challenge,
      page_title: state.title,
      ready: state.ready,
      core_technical: Boolean(parsed?.coreTechnical),
      full_cmr: Boolean(parsed?.fullCmr),
      sample: parsed?.sample ?? null,
      body_prefix: state.ready ? undefined : state.bodyPrefix
    });
    console.log(`${promotion} control: status=${state.status} ready=${state.ready} challenge=${state.challenge} core=${Boolean(parsed?.coreTechnical)} full=${Boolean(parsed?.fullCmr)}`);
  }
  if (controlResults.filter(item => item.core_technical).length < 3) {
    writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify({ generated_at: new Date().toISOString(), controls: controlResults }, null, 2) + '\n');
    throw new Error('Legacy UFCStats browser controls do not expose core technical data for all three promotions.');
  }

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

  const indexState = await openUfcStats(page, `${BASE}/statistics/events/completed?page=all`, 'a[href*="event-details"]');
  if (!indexState.ready) throw new Error(`UFCStats completed-event index unavailable after browser challenge: ${indexState.bodyPrefix}`);
  const events = await liveEventIndex(page);
  if (events.length < 100) throw new Error(`UFCStats event index unexpectedly small: ${events.length}`);

  const relevantEvents = events.filter(event => targetsByDate.has(event.date) && /^(strikeforce|wec|pride)\b/i.test(event.title));
  const matched = [];
  const targetCounts = new Map(['strikeforce','wec','pride'].map(p => [p, targets.filter(t => String(t.organization).toLowerCase() === p).length]));
  const promotionCounts = new Map([...targetCounts].map(([p, count]) => [p, { targets: count, identity_matches: 0, core_technical: 0, full_cmr: 0 }]));

  for (const [eventIndex, event] of relevantEvents.entries()) {
    const eventState = await openUfcStats(page, event.href, 'tr[data-link], a[href*="fighter-details"]');
    if (!eventState.ready) continue;
    const fights = await liveEventFights(page);
    const dateTargets = targetsByDate.get(event.date) || [];
    for (const fight of fights) {
      const key = boutKey(fight.fighters[0], fight.fighters[1]);
      const target = dateTargets.find(item => item.bout_key === key);
      if (!target) continue;
      const detailState = await openUfcStats(page, fight.fightUrl, 'table.b-fight-details__table, .b-fight-details__section');
      const technical = detailState.ready ? await liveFightTechnical(page) : null;
      matched.push({
        promotion: target.organization,
        source_fight_id: target.source_fight_id,
        event_date: target.event_date,
        target_event: target.event_name,
        ufcstats_event: event.title,
        fighter: target.fighter_name,
        opponent: target.opponent_name,
        fight_url: fight.fightUrl,
        core_technical: Boolean(technical?.coreTechnical),
        full_cmr: Boolean(technical?.fullCmr),
        sample: technical?.sample ?? null
      });
      const p = String(target.organization).toLowerCase();
      const c = promotionCounts.get(p);
      c.identity_matches += 1;
      if (technical?.coreTechnical) c.core_technical += 1;
      if (technical?.fullCmr) c.full_cmr += 1;
    }
    console.log(`legacy event ${eventIndex + 1}/${relevantEvents.length}: ${event.title} ${event.date}`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    transport: 'playwright_chromium',
    controls: controlResults,
    ufcstats_events: events.length,
    relevant_legacy_events: relevantEvents.length,
    production_targets: targets.length,
    production_identity_matches: matched.length,
    production_core_technical_matches: matched.filter(item => item.core_technical).length,
    production_full_cmr_matches: matched.filter(item => item.full_cmr).length,
    by_promotion: Object.fromEntries([...promotionCounts.entries()].sort()),
    samples: matched.filter(item => item.core_technical).slice(0, 30)
  };
  report.identity_match_rate = matched.length / Math.max(1, targets.length);
  report.core_technical_match_rate = report.production_core_technical_matches / Math.max(1, targets.length);
  report.full_cmr_match_rate = report.production_full_cmr_matches / Math.max(1, targets.length);
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));

  if (report.production_core_technical_matches === 0) throw new Error('UFCStats legacy source matched zero production pre-UFC fights with core technical data.');
} finally {
  await context.close();
  await browser.close();
}
