import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const DB = 'cagemetrix';
const UFC_EVENT_PREFIX = 'https://www.ufc.com/event/';

const US_REGIONS = new Set([
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming','district of columbia',
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc'
]);
const CANADA_REGIONS = new Set([
  'alberta','british columbia','manitoba','new brunswick','newfoundland and labrador','nova scotia','ontario','prince edward island','quebec','québec','saskatchewan','northwest territories','nunavut','yukon',
  'ab','bc','mb','nb','nl','ns','on','pe','qc','sk','nt','nu','yt'
]);
const AUSTRALIA_REGIONS = new Set([
  'australian capital territory','new south wales','northern territory','queensland','south australia','tasmania','victoria','western australia','act','nsw','nt','qld','sa','tas','vic','wa'
]);
const COUNTRY_CODES = new Map([
  ['united states','US'],['united states of america','US'],['usa','US'],['u.s.','US'],['us','US'],
  ['canada','CA'],['france','FR'],['united kingdom','GB'],['uk','GB'],['england','GB'],['scotland','GB'],['wales','GB'],['northern ireland','GB'],
  ['australia','AU'],['brazil','BR'],['mexico','MX'],['united arab emirates','AE'],['uae','AE'],['saudi arabia','SA'],['singapore','SG'],['china','CN'],['japan','JP'],['south korea','KR'],['korea','KR'],['new zealand','NZ'],['ireland','IE'],['germany','DE'],['sweden','SE'],['netherlands','NL'],['poland','PL'],['czech republic','CZ'],['czechia','CZ'],['spain','ES'],['italy','IT'],['russia','RU'],['kazakhstan','KZ']
]);
const COUNTRY_NAMES = [...COUNTRY_CODES.keys()].sort((a,b)=>b.length-a.length);

const q = value => value == null || value === '' ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const clean = value => String(value || '').replace(/\s+/g,' ').trim() || null;
const key = value => clean(value)?.toLowerCase().replace(/[.]/g,'') || '';

function countryCode(value) {
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  return COUNTRY_CODES.get(normalized) || COUNTRY_CODES.get(normalized.replace(/[.]/g,'')) || raw;
}

function countryFromText(value) {
  const text = clean(value)?.toLowerCase();
  if (!text) return null;
  for (const name of COUNTRY_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if (new RegExp(`\\b${escaped}\\b`,'i').test(text)) return COUNTRY_CODES.get(name) || null;
  }
  return null;
}

export function parsePlaceText(value) {
  const parts = String(value || '').split(',').map(clean).filter(Boolean);
  if (!parts.length) return { city:null, region:null, country:null };
  if (parts.length === 1) return { city:parts[0], region:null, country:null };

  const last = parts.at(-1);
  const lastKey = key(last);
  if (US_REGIONS.has(lastKey)) return { city:parts.slice(0,-1).join(', '), region:last, country:'US' };
  if (CANADA_REGIONS.has(lastKey)) return { city:parts.slice(0,-1).join(', '), region:last, country:'CA' };
  if (AUSTRALIA_REGIONS.has(lastKey)) return { city:parts.slice(0,-1).join(', '), region:last, country:'AU' };

  const country = countryCode(last);
  if (parts.length === 2) return { city:parts[0], region:null, country };
  return { city:parts[0], region:parts.slice(1,-1).join(', '), country };
}

function schemaNodes(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) schemaNodes(item,out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  out.push(value);
  if (value['@graph']) schemaNodes(value['@graph'],out);
  return out;
}

function schemaLocation(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = schemaLocation(item);
      if (parsed?.venue) return parsed;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const venue = clean(value.name);
  let city = null, region = null, country = null;
  if (typeof value.address === 'string') {
    ({city,region,country} = parsePlaceText(value.address));
  } else if (value.address && typeof value.address === 'object') {
    city = clean(value.address.addressLocality);
    region = clean(value.address.addressRegion);
    country = countryCode(value.address.addressCountry);
  }
  return venue ? { venue, city, region, country, source:'json-ld' } : null;
}

function descriptionLocation(description) {
  const text = clean(description);
  if (!text) return null;
  const match = text.match(/\bLive\s+From\s+(?:the\s+)?(.+?)\s+In\s+(.+?)\s+On\s+(?:[A-Z][a-z]{2,9}\.?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?)\s+\d{1,2}\b/i);
  if (!match) return null;
  const venue = clean(match[1]);
  const place = parsePlaceText(match[2]);
  return venue ? { venue, ...place, source:'meta-description' } : null;
}

function enrichFromBody(doc, location) {
  if (!location?.venue) return location;
  const body = clean(doc.body?.textContent);
  if (!body) return location;
  const lower = body.toLowerCase(), venueIndex = lower.indexOf(location.venue.toLowerCase());
  const nearby = venueIndex >= 0 ? body.slice(venueIndex,venueIndex + 320) : body;
  const country = location.country || countryFromText(nearby);
  return { ...location, country };
}

export function extractUfcEventLocation(html) {
  const dom = new JSDOM(html), doc = dom.window.document;
  try {
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || 'null');
        for (const node of schemaNodes(parsed)) {
          const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
          if (!types.some(type => /Event$/i.test(String(type || ''))) || !node.location) continue;
          const location = enrichFromBody(doc,schemaLocation(node.location));
          if (location?.venue) return location;
        }
      } catch {
        // Ignore malformed third-party JSON-LD and continue to UFC's metadata.
      }
    }

    const descriptions = [
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content'),
      doc.querySelector('meta[name="description"]')?.getAttribute('content'),
      doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content')
    ];
    for (const description of descriptions) {
      const location = enrichFromBody(doc,descriptionLocation(description));
      if (location?.venue) return location;
    }
    return null;
  } finally {
    dom.window.close();
  }
}

function wrangler(params, capture = false) {
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{
    encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:20*1024*1024,env:process.env
  }) || '';
}
function d1Rows(target, statement) {
  const parsed = JSON.parse(wrangler(['d1','execute',DB,target,'--command',statement,'--json'],true));
  const parts = Array.isArray(parsed) ? parsed : [parsed];
  return parts.flatMap(part => part.results || []);
}

export async function backfillEventLocations({ remote = false, local = false } = {}) {
  if (remote === local) throw new Error('Choose exactly one of remote or local');
  const target = remote ? '--remote' : '--local';
  const rows = d1Rows(target,`SELECT id,slug,name,source_url,venue,city,region,country FROM events WHERE source_url IS NOT NULL AND (venue IS NULL OR TRIM(venue)='' OR city IS NULL OR TRIM(city)='' OR country IS NULL OR TRIM(country)='') ORDER BY event_date DESC`);
  const updates = [], summary = [], failures = [];

  for (const event of rows) {
    if (!String(event.source_url || '').startsWith(UFC_EVENT_PREFIX)) {
      failures.push({slug:event.slug,reason:'unsupported source_url',source_url:event.source_url});
      continue;
    }
    try {
      const response = await fetch(event.source_url,{signal:AbortSignal.timeout(45000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const location = extractUfcEventLocation(await response.text());
      if (!location?.venue) throw new Error('venue not found in official event metadata');
      const venue = location.venue || event.venue || null;
      const city = location.city || event.city || null;
      const region = location.region || event.region || null;
      const country = location.country || event.country || null;
      updates.push(`UPDATE events SET venue=${q(venue)},city=${q(city)},region=${q(region)},country=${q(country)},updated_at=CURRENT_TIMESTAMP WHERE id=${Number(event.id)};`);
      summary.push({slug:event.slug,venue,city,region,country,source:location.source});
    } catch (error) {
      failures.push({slug:event.slug,reason:String(error?.message || error),source_url:event.source_url});
    }
  }

  mkdirSync('.cache/event-locations',{recursive:true});
  writeFileSync('.cache/event-locations/summary.json',JSON.stringify({checked:rows.length,updated:summary.length,failed:failures.length,events:summary,failures},null,2)+'\n');
  if (updates.length) {
    const path = '.cache/event-locations/backfill.sql';
    writeFileSync(path,updates.join('\n')+'\n');
    wrangler(['d1','execute',DB,target,'--file',path]);
  }
  if (failures.length) console.warn(`Event-location backfill skipped ${failures.length} event(s); see .cache/event-locations/summary.json.`);
  console.log(`Event-location backfill checked ${rows.length} event(s), updated ${summary.length}.`);
  return { checked:rows.length, updated:summary.length, failures };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  backfillEventLocations({remote:args.includes('--remote'),local:args.includes('--local')}).catch(error=>{
    console.error(error);
    process.exit(1);
  });
}
