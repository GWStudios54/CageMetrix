import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  ESPN_MMA_CORE,
  espnAthleteName,
  espnBoutNameKey,
  espnCompetitionId,
  espnCompetitorId,
  espnEventDate,
  espnEventId,
  fightDurationSeconds,
  normalizeEspnName,
  parseEspnEventItems,
  parseEspnLeagueSlugs,
  parseEspnTechnicalStats,
  promotionSlugForOrganization,
  sameEspnName,
  targetFingerprint,
  withinDays
} from './lib/espn-mma.mjs';

const argv = process.argv.slice(2);
const has = flag => argv.includes(flag);
const option = (name, fallback = null) => has(name) ? argv[argv.indexOf(name) + 1] : fallback;
const remote = has('--remote');
const local = has('--local');
if (!remote && !local) throw new Error('Choose --remote or --local explicitly.');
const target = remote ? '--remote' : '--local';
const fromYear = Number(option('--from-year', '2010'));
const onlyLeague = option('--league');
const recheck = has('--recheck');
const maxLeagueYears = Number(option('--max-league-years', '0')) || Infinity;
const outputDir = option('--output', '.cache/espn-mma');
mkdirSync(outputDir, { recursive: true });

const DB = 'cagemetrix';
const MAX_SQL_BYTES = 750_000;
const athleteCache = new Map();
const statsCache = new Map();
const eventCache = new Map();

function wrangler(params, capture = false) {
  const out = execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...params], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    maxBuffer: 32 * 1024 * 1024
  });
  return capture ? out : '';
}

function d1Rows(sql) {
  const parsed = JSON.parse(wrangler(['d1', 'execute', DB, target, '--command', sql, '--json'], true));
  const parts = Array.isArray(parsed) ? parsed : [parsed];
  return parts.flatMap(part => part.results || []);
}

function q(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'CageMetrix ESPN MMA technical sync/1.0' },
        signal: AbortSignal.timeout(20000)
      });
      if (response.ok) return response.json();
      if (response.status === 404) return null;
      if (response.status !== 429 && response.status < 500) throw new Error(`HTTP ${response.status}: ${url}`);
      lastError = new Error(`HTTP ${response.status}: ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(250 * 2 ** (attempt - 1));
  }
  throw lastError;
}

async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return result;
}

async function allLeagueSlugs() {
  const payload = await fetchJson(`${ESPN_MMA_CORE}/leagues?limit=100`);
  const slugs = parseEspnLeagueSlugs(payload);
  if (slugs.length < 20) throw new Error(`ESPN MMA league coverage unexpectedly small: ${slugs.length}`);
  return new Set(slugs);
}

async function eventItemsForYear(slug, year) {
  const items = [];
  let page = 1;
  while (page <= 20) {
    const url = `${ESPN_MMA_CORE}/leagues/${encodeURIComponent(slug)}/events?dates=${year}&limit=100&page=${page}`;
    const payload = await fetchJson(url);
    if (!payload) return items;
    const batch = parseEspnEventItems(payload);
    items.push(...batch);
    const pageCount = Number(payload.pageCount || 0);
    if ((pageCount && page >= pageCount) || batch.length < 100) break;
    page += 1;
  }
  return items;
}

async function eventDetail(item) {
  if (item?.competitions && espnEventId(item)) return item;
  const ref = item?.$ref;
  const id = espnEventId(item);
  const key = ref || id;
  if (!key) return null;
  if (!eventCache.has(key)) {
    eventCache.set(key, fetchJson(ref || `${ESPN_MMA_CORE}/events/${encodeURIComponent(id)}`));
  }
  return eventCache.get(key);
}

async function athleteName(id) {
  if (!id) return null;
  if (!athleteCache.has(id)) {
    athleteCache.set(id, (async () => {
      const payload = await fetchJson(`${ESPN_MMA_CORE}/athletes/${encodeURIComponent(id)}`);
      return espnAthleteName(payload);
    })());
  }
  return athleteCache.get(id);
}

async function competitorStats(slug, eventId, competitionId, athleteId) {
  const key = `${slug}|${eventId}|${competitionId}|${athleteId}`;
  if (!statsCache.has(key)) {
    statsCache.set(key, (async () => {
      const url = `${ESPN_MMA_CORE}/leagues/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/competitions/${encodeURIComponent(competitionId)}/competitors/${encodeURIComponent(athleteId)}/statistics`;
      const payload = await fetchJson(url);
      return { stats: parseEspnTechnicalStats(payload), url };
    })());
  }
  return statsCache.get(key);
}

function statementForRow(row) {
  const columns = [
    'fighter_id','source_fight_id','league_slug','event_id','competition_id','event_date','event_name','weight_class','result',
    'fighter_espn_id','fighter_name','fighter_normalized_name','opponent_espn_id','opponent_name','opponent_normalized_name','duration_seconds',
    'knockdowns','sig_str_landed','sig_str_attempted','total_str_landed','total_str_attempted','td_landed','td_attempted','sub_attempts','ctrl_seconds',
    'opponent_knockdowns','opponent_sig_str_landed','opponent_sig_str_attempted','opponent_total_str_landed','opponent_total_str_attempted',
    'opponent_td_landed','opponent_td_attempted','opponent_sub_attempts','opponent_ctrl_seconds','source_url','observed_at'
  ];
  return `INSERT OR REPLACE INTO espn_mma_technical_bouts (${columns.join(',')}) VALUES (${columns.map(key => q(row[key])).join(',')});\n`;
}

function writeAndApply(statements, prefix) {
  if (!statements.length) return [];
  const files = [];
  let parts = [], size = 0, index = 1;
  const flush = () => {
    if (!parts.length) return;
    const path = `${outputDir}/${prefix}-${String(index++).padStart(3, '0')}.sql`;
    writeFileSync(path, parts.join(''));
    files.push(path);
    parts = []; size = 0;
  };
  for (const statement of statements) {
    const bytes = Buffer.byteLength(statement);
    if (parts.length && size + bytes > MAX_SQL_BYTES) flush();
    parts.push(statement); size += bytes;
  }
  flush();
  for (const path of files) wrangler(['d1', 'execute', DB, target, '--file', path]);
  return files;
}

function targetPairMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = espnBoutNameKey(row.fighter_name, row.opponent_name);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function processGroup(slug, year, targets) {
  const fingerprint = targetFingerprint(targets);
  const state = d1Rows(`SELECT target_fingerprint,status FROM espn_mma_sync_state WHERE league_slug=${q(slug)} AND season_year=${year} LIMIT 1`)[0];
  if (!recheck && state?.status === 'complete' && state.target_fingerprint === fingerprint) {
    return { slug, year, targets: targets.length, matched: null, skipped: true, fingerprint };
  }

  const pairs = targetPairMap(targets);
  const targetDates = [...new Set(targets.map(row => String(row.event_date).slice(0, 10)))];
  const eventItems = await eventItemsForYear(slug, year);
  const details = (await mapLimit(eventItems, 8, eventDetail)).filter(Boolean);
  const candidateEvents = details.filter(event => {
    const date = espnEventDate(event);
    return date && targetDates.some(targetDate => withinDays(date, targetDate, 1));
  });

  const matchedTargetIds = new Set();
  const rowsByKey = new Map();
  for (const event of candidateEvents) {
    const eventId = espnEventId(event);
    const eventDate = espnEventDate(event);
    if (!eventId || !eventDate) continue;
    for (const competition of event.competitions || []) {
      const competitionId = espnCompetitionId(competition);
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      if (!competitionId || competitors.length !== 2) continue;
      const ids = competitors.map(espnCompetitorId);
      if (ids.some(id => !id)) continue;
      const names = await Promise.all(ids.map(athleteName));
      if (names.some(name => !name)) continue;
      const candidates = pairs.get(espnBoutNameKey(names[0], names[1])) || [];
      const matchingTargets = candidates.filter(row => withinDays(eventDate, String(row.event_date).slice(0, 10), 1));
      if (!matchingTargets.length) continue;

      const statLines = await Promise.all(ids.map(id => competitorStats(slug, eventId, competitionId, id)));
      if (statLines.some(line => !line.stats.complete)) continue;
      for (const targetRow of matchingTargets) {
        const fighterIndex = sameEspnName(targetRow.fighter_name, names[0]) ? 0 : sameEspnName(targetRow.fighter_name, names[1]) ? 1 : -1;
        if (fighterIndex < 0) continue;
        const opponentIndex = 1 - fighterIndex;
        const own = statLines[fighterIndex].stats;
        const opp = statLines[opponentIndex].stats;
        const duration = fightDurationSeconds(targetRow.round_num, targetRow.time_finish_seconds);
        const row = {
          fighter_id: Number(targetRow.fighter_id),
          source_fight_id: String(targetRow.source_fight_id),
          league_slug: slug,
          event_id: eventId,
          competition_id: competitionId,
          event_date: String(targetRow.event_date).slice(0, 10),
          event_name: event.name || targetRow.event_name || null,
          weight_class: targetRow.weight_class || null,
          result: targetRow.result || null,
          fighter_espn_id: ids[fighterIndex],
          fighter_name: names[fighterIndex],
          fighter_normalized_name: normalizeEspnName(names[fighterIndex]),
          opponent_espn_id: ids[opponentIndex],
          opponent_name: names[opponentIndex],
          opponent_normalized_name: normalizeEspnName(names[opponentIndex]),
          duration_seconds: duration,
          knockdowns: own.knockdowns,
          sig_str_landed: own.sigStrLanded,
          sig_str_attempted: own.sigStrAttempted,
          total_str_landed: own.totalStrLanded,
          total_str_attempted: own.totalStrAttempted,
          td_landed: own.tdLanded,
          td_attempted: own.tdAttempted,
          sub_attempts: own.subAttempts,
          ctrl_seconds: own.ctrlSeconds,
          opponent_knockdowns: opp.knockdowns,
          opponent_sig_str_landed: opp.sigStrLanded,
          opponent_sig_str_attempted: opp.sigStrAttempted,
          opponent_total_str_landed: opp.totalStrLanded,
          opponent_total_str_attempted: opp.totalStrAttempted,
          opponent_td_landed: opp.tdLanded,
          opponent_td_attempted: opp.tdAttempted,
          opponent_sub_attempts: opp.subAttempts,
          opponent_ctrl_seconds: opp.ctrlSeconds,
          source_url: statLines[fighterIndex].url,
          observed_at: new Date().toISOString()
        };
        rowsByKey.set(`${row.fighter_id}|${slug}|${competitionId}`, row);
        matchedTargetIds.add(`${targetRow.fighter_id}|${targetRow.source_fight_id}`);
      }
    }
  }

  const deleteStatement = `DELETE FROM espn_mma_technical_bouts WHERE league_slug=${q(slug)} AND substr(event_date,1,4)=${q(String(year))};\n`;
  const rowStatements = [...rowsByKey.values()].map(statementForRow);
  const matched = matchedTargetIds.size;
  const unmatched = Math.max(0, targets.length - matched);
  const stateStatement = `INSERT OR REPLACE INTO espn_mma_sync_state (league_slug,season_year,target_fingerprint,target_count,matched_count,unmatched_count,status,completed_at,error_text) VALUES (${q(slug)},${year},${q(fingerprint)},${targets.length},${matched},${unmatched},'complete',${q(new Date().toISOString())},NULL);\n`;
  writeAndApply([deleteStatement, ...rowStatements, stateStatement], `sync-${slug}-${year}`);
  return { slug, year, targets: targets.length, matched, unmatched, rows: rowsByKey.size, events_examined: details.length, candidate_events: candidateEvents.length, skipped: false, fingerprint };
}

const availableSlugs = await allLeagueSlugs();
const allTargets = d1Rows(`
  SELECT fighter_id,source_fight_id,event_date,organization,event_name,weight_class,result,
         fighter_name,normalized_name,opponent_name,opponent_normalized_name,round_num,time_finish_seconds
  FROM ufc_warehouse_pre_ufc_rows
  WHERE CAST(substr(event_date,1,4) AS INTEGER) >= ${Math.max(1990, Math.floor(fromYear))}
  ORDER BY event_date,fighter_id,source_fight_id
`);

const groups = new Map();
let unmappedTargets = 0;
for (const row of allTargets) {
  const slug = promotionSlugForOrganization(row.organization, availableSlugs);
  if (!slug || (onlyLeague && slug !== onlyLeague)) { if (!onlyLeague) unmappedTargets += 1; continue; }
  const year = Number(String(row.event_date || '').slice(0, 4));
  if (!Number.isInteger(year)) continue;
  const key = `${slug}|${year}`;
  if (!groups.has(key)) groups.set(key, { slug, year, rows: [] });
  groups.get(key).rows.push(row);
}

const orderedGroups = [...groups.values()].sort((a, b) => a.year - b.year || a.slug.localeCompare(b.slug)).slice(0, maxLeagueYears);
const results = [];
for (const group of orderedGroups) {
  console.log(`ESPN MMA ${group.slug} ${group.year}: ${group.rows.length} pre-UFC targets.`);
  try {
    const result = await processGroup(group.slug, group.year, group.rows);
    results.push(result);
    console.log(result.skipped ? `  unchanged; skipped.` : `  matched ${result.matched}/${result.targets} targets into ${result.rows} technical rows.`);
  } catch (error) {
    const fingerprint = targetFingerprint(group.rows);
    const state = `INSERT OR REPLACE INTO espn_mma_sync_state (league_slug,season_year,target_fingerprint,target_count,matched_count,unmatched_count,status,completed_at,error_text) VALUES (${q(group.slug)},${group.year},${q(fingerprint)},${group.rows.length},0,${group.rows.length},'failed',${q(new Date().toISOString())},${q(String(error?.message || error).slice(0, 1000))});\n`;
    writeAndApply([state], `failed-${group.slug}-${group.year}`);
    throw error;
  }
}

const summary = {
  generated_at: new Date().toISOString(),
  from_year: fromYear,
  available_espn_mma_leagues: [...availableSlugs].sort(),
  candidate_pre_ufc_rows: allTargets.length,
  mapped_target_rows: orderedGroups.reduce((sum, group) => sum + group.rows.length, 0),
  unmapped_target_rows: unmappedTargets,
  league_year_groups: orderedGroups.length,
  processed_groups: results.filter(row => !row.skipped).length,
  skipped_groups: results.filter(row => row.skipped).length,
  matched_targets: results.reduce((sum, row) => sum + (row.matched || 0), 0),
  results
};
writeFileSync(`${outputDir}/summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
