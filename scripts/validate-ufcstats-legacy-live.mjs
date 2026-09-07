import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const DB = 'cagemetrix';
const OUT_DIR = '.cache/ufcstats-legacy-validation';
const BASE = 'http://ufcstats.com';
const PROFILE_CONCURRENCY = 6;
const DETAIL_SAMPLE_PROMOTIONS = 30;
const DETAIL_SAMPLES_PER_PROMOTION = 3;
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
  const cleaned = raw.replace(/\bSept\./gi, 'Sep').replace(/\b([A-Za-z]{3})\./g, '$1');
  const parsed = Date.parse(`${cleaned} 12:00:00 UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}
const isPair = value => /^(\d+)\s+(?:of|\/)\s+(\d+)$/i.test(tidy(value));
const isInteger = value => /^\d+$/.test(tidy(value));
const isClock = value => /^\d+:\d{2}$/.test(tidy(value));

async function mapLimit(items, concurrency, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

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
        // Record the state below so challenge failures and selector drift stay distinct.
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

async function fighterDirectory(page) {
  const found = [];
  for (const char of 'abcdefghijklmnopqrstuvwxyz') {
    const url = `${BASE}/statistics/fighters?char=${char}&page=all`;
    const state = await openUfcStats(page, url, 'a[href*="fighter-details"]');
    if (!state.ready) {
      console.log(`fighter directory ${char}: unavailable status=${state.status} challenge=${state.challenge}`);
      continue;
    }
    const rows = await page.evaluate(() => [...document.querySelectorAll('tr.b-statistics__table-row, tr')].flatMap(row => {
      const anchors = [...row.querySelectorAll('a[href*="fighter-details"]')];
      if (!anchors.length) return [];
      const href = anchors[0].href || anchors[0].getAttribute('href');
      const parts = [...new Set(anchors.filter(a => (a.href || a.getAttribute('href')) === href)
        .map(a => (a.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
      return href && parts.length ? [{ href, name: parts.join(' ') }] : [];
    }));
    found.push(...rows);
    console.log(`fighter directory ${char}: ${rows.length}`);
  }
  const byHref = new Map();
  for (const item of found) if (!byHref.has(item.href)) byHref.set(item.href, item);
  return [...byHref.values()];
}

async function fighterHistory(page) {
  const raw = await page.evaluate(() => [...document.querySelectorAll('tr.b-fight-details__table-row, tr[data-link]')].flatMap(row => {
    const fighterLinks = [...row.querySelectorAll('a[href*="fighter-details"]')];
    if (fighterLinks.length < 2) return [];
    const fighters = fighterLinks.slice(0, 2).map(a => (a.textContent || '').replace(/\s+/g, ' ').trim());
    const eventAnchor = row.querySelector('a[href*="event-details"]');
    const fightUrl = row.getAttribute('data-link') || row.querySelector('a[href*="fight-details"]')?.href || null;
    const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
    const dateMatch = text.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+\d{4}\b/i);
    return fightUrl && fighters.every(Boolean) && dateMatch ? [{
      fighters,
      fightUrl,
      event: (eventAnchor?.textContent || '').replace(/\s+/g, ' ').trim(),
      dateText: dateMatch[0]
    }] : [];
  }));
  return raw.map(item => ({ ...item, date: isoDate(item.dateText), bout_key: boutKey(item.fighters[0], item.fighters[1]) })).filter(item => item.date);
}

function spreadSamples(items, count) {
  if (items.length <= count) return items;
  if (count <= 1) return [items[Math.floor(items.length / 2)]];
  const indexes = new Set(Array.from({ length: count }, (_, i) => Math.round(i * (items.length - 1) / (count - 1))));
  return [...indexes].map(index => items[index]);
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
    ORDER BY event_date DESC
  `);
  const targets = [];
  const seenTargets = new Set();
  for (const row of rawTargets) {
    const date = String(row.event_date || '').slice(0, 10);
    const key = `${row.source_fight_id}|${date}|${boutKey(row.fighter_name, row.opponent_name)}`;
    if (!date || seenTargets.has(key)) continue;
    seenTargets.add(key);
    targets.push({ ...row, event_date: date, bout_key: boutKey(row.fighter_name, row.opponent_name), fighter_key: nameKey(row.fighter_name) });
  }
  const targetsByFighter = new Map();
  for (const target of targets) {
    if (!targetsByFighter.has(target.fighter_key)) targetsByFighter.set(target.fighter_key, []);
    targetsByFighter.get(target.fighter_key).push(target);
  }

  const directory = await fighterDirectory(page);
  const directoryByName = new Map();
  const ambiguousNames = new Set();
  for (const profile of directory) {
    const key = nameKey(profile.name);
    if (!key) continue;
    if (directoryByName.has(key) && directoryByName.get(key).href !== profile.href) ambiguousNames.add(key);
    else directoryByName.set(key, profile);
  }
  for (const key of ambiguousNames) directoryByName.delete(key);

  const profileTargets = [...targetsByFighter.entries()].flatMap(([key, fighterTargets]) => {
    const profile = directoryByName.get(key);
    return profile ? [{ key, profile, targets: fighterTargets }] : [];
  });
  console.log(`production targets=${targets.length} unique target fighters=${targetsByFighter.size} exact UFCStats profiles=${profileTargets.length} ambiguous directory names=${ambiguousNames.size}`);

  const profileMatchesNested = await mapLimit(profileTargets, PROFILE_CONCURRENCY, async (item, index) => {
    const workerPage = await context.newPage();
    try {
      const state = await openUfcStats(workerPage, item.profile.href, 'tr.b-fight-details__table-row, tr[data-link]');
      if (!state.ready) return [];
      const history = await fighterHistory(workerPage);
      const targetLookup = new Map(item.targets.map(target => [`${target.event_date}|${target.bout_key}`, target]));
      const matches = [];
      for (const row of history) {
        const target = targetLookup.get(`${row.date}|${row.bout_key}`);
        if (!target) continue;
        matches.push({
          promotion: String(target.organization || '').toLowerCase(),
          source_fight_id: target.source_fight_id,
          event_date: target.event_date,
          target_event: target.event_name,
          fighter: target.fighter_name,
          opponent: target.opponent_name,
          ufcstats_profile: item.profile.href,
          ufcstats_event: row.event,
          fight_url: row.fightUrl
        });
      }
      if ((index + 1) % 50 === 0 || matches.length) console.log(`profile ${index + 1}/${profileTargets.length}: ${item.profile.name} history=${history.length} matches=${matches.length}`);
      return matches;
    } finally {
      await workerPage.close();
    }
  });

  const matchedBySource = new Map();
  for (const match of profileMatchesNested.flat()) {
    const key = `${match.source_fight_id}|${match.event_date}|${boutKey(match.fighter, match.opponent)}`;
    if (!matchedBySource.has(key)) matchedBySource.set(key, match);
  }
  const matched = [...matchedBySource.values()];

  const targetPromotionCounts = new Map();
  for (const target of targets) {
    const promotion = String(target.organization || '').toLowerCase();
    targetPromotionCounts.set(promotion, (targetPromotionCounts.get(promotion) || 0) + 1);
  }
  const matchedByPromotion = new Map();
  for (const match of matched) {
    if (!matchedByPromotion.has(match.promotion)) matchedByPromotion.set(match.promotion, []);
    matchedByPromotion.get(match.promotion).push(match);
  }

  const samplePromotions = [...matchedByPromotion.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, DETAIL_SAMPLE_PROMOTIONS);
  const detailSamples = [];
  for (const [promotion, promotionMatches] of samplePromotions) {
    const ordered = [...promotionMatches].sort((a, b) => a.event_date.localeCompare(b.event_date));
    for (const match of spreadSamples(ordered, DETAIL_SAMPLES_PER_PROMOTION)) detailSamples.push({ ...match, promotion });
  }

  const detailResults = await mapLimit(detailSamples, 4, async (match, index) => {
    const workerPage = await context.newPage();
    try {
      const state = await openUfcStats(workerPage, match.fight_url, 'table.b-fight-details__table, .b-fight-details__section');
      const technical = state.ready ? await liveFightTechnical(workerPage) : null;
      const result = {
        ...match,
        status: state.status,
        challenge: state.challenge,
        core_technical: Boolean(technical?.coreTechnical),
        full_cmr: Boolean(technical?.fullCmr),
        sample: technical?.sample ?? null
      };
      console.log(`detail ${index + 1}/${detailSamples.length}: ${match.promotion} ${match.fighter} vs ${match.opponent} core=${result.core_technical} full=${result.full_cmr}`);
      return result;
    } finally {
      await workerPage.close();
    }
  });

  const detailByPromotion = new Map();
  for (const result of detailResults) {
    if (!detailByPromotion.has(result.promotion)) detailByPromotion.set(result.promotion, []);
    detailByPromotion.get(result.promotion).push(result);
  }

  const promotions = [...new Set([...targetPromotionCounts.keys(), ...matchedByPromotion.keys()])];
  const byPromotion = {};
  for (const promotion of promotions.sort()) {
    const promotionMatches = matchedByPromotion.get(promotion) || [];
    const samples = detailByPromotion.get(promotion) || [];
    const dates = promotionMatches.map(item => item.event_date).filter(Boolean).sort();
    byPromotion[promotion] = {
      targets: targetPromotionCounts.get(promotion) || 0,
      profile_identity_matches: promotionMatches.length,
      identity_match_pct: Number((100 * promotionMatches.length / Math.max(1, targetPromotionCounts.get(promotion) || 0)).toFixed(1)),
      first_match_date: dates[0] || null,
      last_match_date: dates.at(-1) || null,
      detail_samples: samples.length,
      core_technical_samples: samples.filter(item => item.core_technical).length,
      full_cmr_samples: samples.filter(item => item.full_cmr).length
    };
  }

  const rankedCoverage = Object.entries(byPromotion)
    .filter(([, value]) => value.profile_identity_matches > 0)
    .sort((a, b) => b[1].profile_identity_matches - a[1].profile_identity_matches || a[0].localeCompare(b[0]));
  const report = {
    generated_at: new Date().toISOString(),
    transport: 'playwright_chromium_fighter_histories',
    controls: controlResults,
    production_targets: targets.length,
    unique_target_fighters: targetsByFighter.size,
    ufcstats_directory_profiles: directory.length,
    exact_target_profiles: profileTargets.length,
    ambiguous_directory_names_skipped: ambiguousNames.size,
    production_profile_identity_matches: matched.length,
    production_profile_identity_match_rate: matched.length / Math.max(1, targets.length),
    sampled_detail_pages: detailResults.length,
    sampled_core_technical_pages: detailResults.filter(item => item.core_technical).length,
    sampled_full_cmr_pages: detailResults.filter(item => item.full_cmr).length,
    promotions_with_profile_matches: rankedCoverage.map(([promotion]) => promotion),
    top_coverage: rankedCoverage.slice(0, 50).map(([promotion, value]) => ({ promotion, ...value })),
    by_promotion: byPromotion,
    detail_samples: detailResults
  };
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    production_targets: report.production_targets,
    unique_target_fighters: report.unique_target_fighters,
    exact_target_profiles: report.exact_target_profiles,
    production_profile_identity_matches: report.production_profile_identity_matches,
    production_profile_identity_match_rate: report.production_profile_identity_match_rate,
    sampled_detail_pages: report.sampled_detail_pages,
    sampled_core_technical_pages: report.sampled_core_technical_pages,
    sampled_full_cmr_pages: report.sampled_full_cmr_pages,
    top_coverage: report.top_coverage
  }, null, 2));

  if (matched.length === 0) throw new Error('UFCStats fighter histories matched zero production pre-UFC fights.');
  if (detailResults.filter(item => item.core_technical).length === 0) throw new Error('Matched UFCStats fighter-history samples exposed zero core technical detail pages.');
} finally {
  await context.close();
  await browser.close();
}
