import { createHash } from 'node:crypto';

export const ESPN_MMA_CORE = 'https://sports.core.api.espn.com/v2/sports/mma';

const PROMOTION_ALIASES = Object.freeze([
  [/(^|\b)bellator(\b|$)/i, 'bellator'],
  [/(^|\b)(professional fighters league|pfl)(\b|$)/i, 'pfl'],
  [/(^|\b)(one championship|one fc)(\b|$)/i, 'one-championship'],
  [/(^|\b)(invicta fighting championships?|invicta fc)(\b|$)/i, 'ifc'],
  [/(^|\b)(legacy fighting alliance|lfa)(\b|$)/i, 'lfa'],
  [/(^|\b)(konfrontacja sztuk walki|ksw)(\b|$)/i, 'ksw'],
  [/(^|\b)cage warriors(\b|$)/i, 'cage-warriors'],
  [/(^|\b)strikeforce(\b|$)/i, 'strikeforce'],
  [/(^|\b)(world extreme cagefighting|wec)(\b|$)/i, 'wec'],
  [/(^|\b)(pride fighting championships?|pride fc|pride)(\b|$)/i, 'pride'],
  [/(^|\b)dream(\b|$)/i, 'dream'],
  [/(^|\b)(m-?1 global|m-?1 challenge|m-?1)(\b|$)/i, 'm1'],
  [/(^|\b)(road fighting championship|road fc)(\b|$)/i, 'road-fc'],
  [/(^|\b)(shooto japan|shooto)(\b|$)/i, 'shooto-japan'],
  [/(^|\b)(resurrection fighting alliance|rfa)(\b|$)/i, 'resurrection'],
  [/(^|\b)(legacy fighting championship|legacy fc)(\b|$)/i, 'lfc'],
  [/(^|\b)(international fight league|ifl)(\b|$)/i, 'ifl'],
  [/(^|\b)(maximum fighting championship|mfc)(\b|$)/i, 'mfc'],
  [/(^|\b)(titan fighting championship|titan fc)(\b|$)/i, 'tfc'],
  [/(^|\b)(victory fighting championship|victory fc)(\b|$)/i, 'vfc'],
  [/(^|\b)(extreme fighting championship|xfc)(\b|$)/i, 'xfc']
]);

export function normalizeEspnName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\b(jr|sr|ii|iii|iv)\b$/i, '')
    .trim();
}

export function sameEspnName(a, b) {
  return Boolean(normalizeEspnName(a)) && normalizeEspnName(a) === normalizeEspnName(b);
}

export function espnBoutNameKey(a, b) {
  return [normalizeEspnName(a), normalizeEspnName(b)].sort().join('|');
}

export function promotionSlugForOrganization(organization, availableSlugs = null) {
  const raw = String(organization || '').trim();
  if (!raw || /(^|\b)(ufc|ultimate fighting championship|dana white'?s contender|road to ufc)(\b|$)/i.test(raw)) return null;
  const available = availableSlugs ? new Set(availableSlugs) : null;
  for (const [pattern, slug] of PROMOTION_ALIASES) {
    if (pattern.test(raw) && (!available || available.has(slug))) return slug;
  }
  const normalized = normalizeEspnName(raw);
  if (available) {
    for (const slug of available) {
      if (slug.length < 4) continue;
      const words = slug.replaceAll('-', ' ');
      if (normalized.includes(words)) return slug;
    }
  }
  return null;
}

export function publicEspnRef(value) {
  const raw = typeof value === 'string' ? value : value?.$ref;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname === 'sports.core.api.espn.pvt') url.hostname = 'sports.core.api.espn.com';
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

export function idFromRef(value, segment = null) {
  const raw = publicEspnRef(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    if (segment) {
      const index = parts.lastIndexOf(segment);
      return index >= 0 && parts[index + 1] ? decodeURIComponent(parts[index + 1]) : null;
    }
    return parts.at(-1) || null;
  } catch {
    return null;
  }
}

export function parseEspnLeagueSlugs(payload) {
  const out = [];
  for (const item of payload?.items || []) {
    const slug = item?.slug || idFromRef(item, 'leagues');
    if (slug && !out.includes(String(slug))) out.push(String(slug));
  }
  return out;
}

export function parseEspnEventItems(payload) {
  return Array.isArray(payload?.items) ? payload.items : [];
}

export function espnEventId(event) {
  return String(event?.id || idFromRef(event, 'events') || '');
}

export function espnCompetitionId(competition) {
  return String(competition?.id || idFromRef(competition, 'competitions') || '');
}

/** Competition participant id, not necessarily the athlete-profile id. */
export function espnCompetitorId(competitor) {
  const direct = competitor?.id;
  if (direct !== undefined && direct !== null && String(direct)) return String(direct);
  return String(idFromRef(competitor, 'competitors') || '');
}

/** ESPN MMA athlete ids must be resolved from the athlete ref when present. */
export function espnAthleteIdFromCompetitor(competitor) {
  return String(idFromRef(competitor?.athlete, 'athletes') || idFromRef(competitor, 'athletes') || competitor?.id || '');
}

export function espnCompetitorStatisticsRef(competitor) {
  return publicEspnRef(competitor?.statistics);
}

export function espnCompetitorLinescoresRef(competitor) {
  return publicEspnRef(competitor?.linescores);
}

export function espnEventDate(event) {
  const raw = String(event?.date || event?.startDate || '');
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

export function espnAthleteName(payload) {
  const direct = payload?.displayName || payload?.fullName || payload?.name;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return `${payload?.firstName || ''} ${payload?.lastName || ''}`.replace(/\s+/g, ' ').trim() || null;
}

function statKey(value) {
  return String(value || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function seconds(value) {
  const n = numeric(value);
  if (n !== null) return Math.max(0, Math.round(n));
  const match = String(value || '').trim().match(/^(\d+):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const FIELD_BY_STAT = Object.freeze({
  sigstrikeslanded: 'sigStrLanded', significantstrikeslanded: 'sigStrLanded',
  sigstrikesattempted: 'sigStrAttempted', significantstrikesattempted: 'sigStrAttempted',
  totalstrikeslanded: 'totalStrLanded', totalstrikesattempted: 'totalStrAttempted',
  takedownslanded: 'tdLanded', takedownsattempted: 'tdAttempted',
  submissionattempts: 'subAttempts', submissionsattempted: 'subAttempts', submissions: 'subAttempts',
  controltimeseconds: 'ctrlSeconds', controltime: 'ctrlSeconds', timeincontrol: 'ctrlSeconds',
  knockdowns: 'knockdowns'
});

export function parseEspnTechnicalStats(payload) {
  const result = {
    knockdowns: null,
    sigStrLanded: null,
    sigStrAttempted: null,
    totalStrLanded: null,
    totalStrAttempted: null,
    tdLanded: null,
    tdAttempted: null,
    subAttempts: null,
    ctrlSeconds: null,
    complete: false
  };
  const categories = payload?.splits?.categories || payload?.categories || [];
  for (const category of categories) {
    for (const stat of category?.stats || []) {
      const field = FIELD_BY_STAT[statKey(stat?.name || stat?.abbreviation || stat?.displayName)];
      if (!field) continue;
      const source = stat?.value ?? stat?.displayValue;
      const value = field === 'ctrlSeconds' ? seconds(source) : numeric(source);
      if (value !== null && value >= 0) result[field] = Math.round(value);
    }
  }
  result.complete = [result.sigStrLanded, result.sigStrAttempted, result.tdLanded, result.tdAttempted, result.ctrlSeconds]
    .every(value => Number.isFinite(value));
  if (result.sigStrLanded > result.sigStrAttempted || result.tdLanded > result.tdAttempted) result.complete = false;
  return result;
}

export function fightDurationSeconds(roundNum, finishSeconds) {
  const round = Number(roundNum);
  const clock = Number(finishSeconds);
  if (!Number.isInteger(round) || round < 1 || round > 10 || !Number.isFinite(clock) || clock < 0 || clock > 600) return null;
  return Math.max(30, (round - 1) * 300 + clock);
}

export function withinDays(a, b, tolerance = 1) {
  const ad = Date.parse(`${a}T00:00:00Z`), bd = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ad) || !Number.isFinite(bd)) return false;
  return Math.abs(ad - bd) <= tolerance * 86400000;
}

export function targetFingerprint(rows) {
  const stable = [...rows]
    .map(row => [row.fighter_id, row.source_fight_id, row.event_date, normalizeEspnName(row.fighter_name), normalizeEspnName(row.opponent_name)])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
