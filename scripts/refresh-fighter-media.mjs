import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTO_PATH = path.join(ROOT, 'public', 'headshots-auto.json');
const STATE_PATH = path.join(ROOT, 'scripts', 'data', 'fighter-media-state.json');
const CURATED_PATHS = [
  path.join(ROOT, 'public', 'headshots.json'),
  path.join(ROOT, 'public', 'headshots-batch2.json')
];

const USER_AGENT = 'CageMetrix/0.3 fighter-media-resolver (https://cagemetrix.com; contact via site)';
const RETRY_DAYS = 30;
const DEFAULT_MAX = 250;
const CONCURRENCY = 4;
const FIGHTER_DESCRIPTION = /(mixed martial|\bmma\b|martial artist|martial arts fighter|ultimate fighting|combat sport|professional fighter)/i;
const REUSABLE_LICENSE = /^(cc0|cc by(?:-|\s)|public domain|pd(?:-|\s|$))/i;

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInt(value, fallback) {
  if (value === 'all') return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.startsWith('//')) return `https:${text}`;
  return text;
}

async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  const ordered = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(filePath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(url, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000)
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
        await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 600 * attempt);
        continue;
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
      await delay(60 + Math.floor(Math.random() * 60));
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(400 * attempt);
    }
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

function wrangler(params) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...params], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024
  });
}

function d1Fighters() {
  const sql = `SELECT id, slug, name, current_weight_class, nationality, active, roster_status, status_source, last_fight_date, ufc_bouts FROM fighters ORDER BY name COLLATE NOCASE`;
  const parsed = JSON.parse(wrangler(['d1', 'execute', 'cagemetrix', '--remote', '--command', sql, '--json']));
  const parts = Array.isArray(parsed) ? parsed : [parsed];
  return parts.flatMap(part => part.results || []);
}

async function fetchFighters(baseUrl) {
  const fighters = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const url = new URL('/api/fighters', baseUrl);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    const payload = await getJson(url);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    fighters.push(...rows);
    if (rows.length < limit) break;
  }
  return fighters;
}

function candidateScore(fighterName, candidate) {
  const wanted = normalizeName(fighterName);
  const label = normalizeName(candidate?.label);
  const description = String(candidate?.description || '');
  let score = 0;
  if (label === wanted) score += 10;
  else if (label.includes(wanted) || wanted.includes(label)) score += 4;
  if (FIGHTER_DESCRIPTION.test(description)) score += 8;
  if (/boxer|kickboxer|wrestler|judoka|grappler/i.test(description)) score += 1;
  return score;
}

async function findWikidataEntity(fighter) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', fighter.name);
  url.searchParams.set('language', 'en');
  url.searchParams.set('uselang', 'en');
  url.searchParams.set('type', 'item');
  url.searchParams.set('limit', '6');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const payload = await getJson(url);
  const ranked = (payload?.search || [])
    .map(candidate => ({ candidate, score: candidateScore(fighter.name, candidate) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 14 ? ranked[0].candidate : null;
}

async function wikidataImageFilename(entityId) {
  const payload = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`);
  return payload?.entities?.[entityId]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value || null;
}

async function commonsImage(fileName, fighter, entityId) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('titles', `File:${fileName}`);
  url.searchParams.set('iiprop', 'url|extmetadata');
  url.searchParams.set('iiurlwidth', '720');
  const payload = await getJson(url);
  const page = Object.values(payload?.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const license = stripHtml(meta.LicenseShortName?.value);
  if (!info || !license || !REUSABLE_LICENSE.test(license)) return null;

  const author = stripHtml(meta.Artist?.value || meta.Credit?.value || 'Wikimedia Commons contributor');
  const description = stripHtml(meta.ImageDescription?.value || meta.ObjectName?.value || `${fighter.name} portrait`);
  const sourceFile = fileName.replace(/ /g, '_');
  return {
    url: info.thumburl || info.url,
    source_url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(sourceFile)}`,
    author,
    license,
    license_url: normalizeUrl(meta.LicenseUrl?.value),
    source: 'Wikimedia Commons',
    alt: description || `${fighter.name} portrait`,
    wikidata_id: entityId,
    resolved_at: new Date().toISOString()
  };
}

async function resolveFighter(fighter) {
  const entity = await findWikidataEntity(fighter);
  if (!entity) return null;
  const fileName = await wikidataImageFilename(entity.id);
  if (!fileName) return null;
  return commonsImage(fileName, fighter, entity.id);
}

function nextRetryIso() {
  return new Date(Date.now() + RETRY_DAYS * 86400000).toISOString();
}

async function main() {
  const baseUrl = argValue('base-url') || process.env.CAGEMETRIX_BASE_URL || 'https://cagemetrix.com';
  const max = positiveInt(argValue('max'), DEFAULT_MAX);
  const refresh = hasFlag('refresh');
  const activeOnly = hasFlag('active-only');
  const remote = hasFlag('remote');

  const [auto, state, ...curatedGroups] = await Promise.all([
    readJson(AUTO_PATH, {}),
    readJson(STATE_PATH, {}),
    ...CURATED_PATHS.map(filePath => readJson(filePath, {}))
  ]);
  const curated = Object.assign({}, ...curatedGroups);
  const fighters = remote ? d1Fighters() : await fetchFighters(baseUrl);
  const now = Date.now();

  const targets = fighters
    .filter(fighter => fighter?.slug && fighter?.name)
    .filter(fighter => !activeOnly || Number(fighter.active) === 1)
    .filter(fighter => !curated[fighter.slug])
    .filter(fighter => refresh || !auto[fighter.slug])
    .filter(fighter => {
      if (refresh) return true;
      const retryAt = Date.parse(state[fighter.slug]?.retry_after || '');
      return !Number.isFinite(retryAt) || retryAt <= now;
    })
    .sort((a, b) => Number(b.active || 0) - Number(a.active || 0) || String(a.name).localeCompare(String(b.name)))
    .slice(0, Number.isFinite(max) ? max : undefined);

  console.log(`CageMetrix fighter media: ${fighters.length} fighters, ${Object.keys(curated).length} curated, ${Object.keys(auto).length} auto, ${targets.length} to check.`);

  let resolved = 0;
  let unresolved = 0;
  let errors = 0;

  for (let index = 0; index < targets.length; index += CONCURRENCY) {
    const chunk = targets.slice(index, index + CONCURRENCY);
    const results = await Promise.all(chunk.map(async fighter => {
      try {
        const media = await resolveFighter(fighter);
        return { fighter, media };
      } catch (error) {
        return { fighter, error };
      }
    }));

    for (const result of results) {
      const { fighter } = result;
      if (result.error) {
        errors += 1;
        console.warn(`ERROR ${fighter.name}: ${result.error.message || result.error}`);
        continue;
      }
      if (result.media) {
        auto[fighter.slug] = result.media;
        state[fighter.slug] = {
          status: 'resolved',
          source: 'wikimedia',
          checked_at: new Date().toISOString(),
          wikidata_id: result.media.wikidata_id
        };
        resolved += 1;
        console.log(`FOUND ${fighter.name} -> ${result.media.source_url}`);
      } else {
        state[fighter.slug] = {
          status: 'not_found',
          source: 'wikimedia',
          checked_at: new Date().toISOString(),
          retry_after: nextRetryIso()
        };
        unresolved += 1;
      }
    }

    if ((index + chunk.length) % 40 === 0 || index + chunk.length >= targets.length) {
      await Promise.all([writeJson(AUTO_PATH, auto), writeJson(STATE_PATH, state)]);
      console.log(`Progress ${Math.min(index + chunk.length, targets.length)}/${targets.length}: ${resolved} found, ${unresolved} no licensed image, ${errors} errors.`);
    }
  }

  if (!targets.length) await Promise.all([writeJson(AUTO_PATH, auto), writeJson(STATE_PATH, state)]);
  console.log(`Done: ${resolved} new licensed photos, ${unresolved} unresolved, ${errors} transient errors.`);
  if (errors > Math.max(10, Math.ceil(targets.length * 0.2))) process.exitCode = 2;
}

await main();
