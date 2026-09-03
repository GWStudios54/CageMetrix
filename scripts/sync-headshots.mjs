import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Public UFC directory photos are matched by exact normalized name or slug.
// Ambiguous and missing matches remain explicit; never guess a fighter's face.
const cacheDir = resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || '.cache/headshots');
const refresh = process.argv.includes('--refresh');
mkdirSync(cacheDir, { recursive: true });
const decode = text => text.replace(/&amp;/g, '&').replace(/&#039;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const overrides = JSON.parse(readFileSync(new URL('./headshot-overrides.json', import.meta.url), 'utf8'));
const validPhoto = src => /^https:\/\/(?:www\.)?ufc\.com\/images\//.test(src) && !/silhouette|no-profile|placeholder|ufc-logo/i.test(src);
async function get(url, cacheName) {
  const path = resolve(cacheDir, cacheName);
  if (!refresh && existsSync(path)) return readFileSync(path, 'utf8');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const body = await response.text();
  writeFileSync(path, body);
  return body;
}
const records = [];
let url = 'https://www.ufc.com/athletes/all';
const visited = new Set();
while (url) {
  if (visited.has(url)) throw new Error('UFC pagination repeated a URL');
  visited.add(url);
  const html = await get(url, `ufc-${visited.size}.html`);
  const cards = html.split(/<div class="c-listing-athlete-flipcard white">/).slice(1);
  for (const card of cards) {
    const name = decode(card.match(/class="c-listing-athlete__name">\s*([^<]+)/)?.[1]?.trim() || '');
    const profile = card.match(/href="(\/athlete\/[^"?#]+)"/)?.[1];
    const src = decode(card.match(/<img[^>]+src="([^"]+)"/)?.[1] || '');
    if (name && profile) {
      records.push({ name, slug: profile.split('/').at(-1), url: validPhoto(src) ? src : null, source_url: `https://www.ufc.com${profile}`, source: 'UFC' });
    }
  }
  const next = html.match(/href="([^"]+)"[^>]*title="Load more items"[^>]*rel="next"/)?.[1];
  url = next ? new URL(decode(next), url).href : null;
  if (url && new URL(url).origin !== 'https://www.ufc.com') throw new Error('Unexpected pagination origin');
  if (visited.size % 25 === 0 || !url) console.log(`UFC page ${visited.size}: ${records.length} athlete records`);
}
writeFileSync(resolve(cacheDir, 'ufc-photos.json'), JSON.stringify(records, null, 2));
const fighters = [];
for (let offset = 0; ; offset += 200) {
  const payload = JSON.parse(await get(`https://cagemetrix.com/api/fighters?limit=200&offset=${offset}`, `fighters-${offset}.json`));
  fighters.push(...payload.data);
  if (payload.data.length < 200) break;
}
const byName = new Map();
for (const photo of records) {
  for (const key of new Set([normalize(photo.name), normalize(photo.slug)])) {
    if (!byName.has(key)) byName.set(key, new Map());
    byName.get(key).set(photo.source_url, photo);
  }
}
const output = {};
const missing = [];
for (const fighter of fighters) {
  const override = overrides[fighter.slug];
  const candidates = override?.source_slug
    ? new Map(records.filter(p => p.slug === override.source_slug).map(p => [p.source_url, p]))
    : new Map([...(byName.get(normalize(fighter.name)) || []), ...(byName.get(normalize(fighter.slug)) || [])]);
  let photo = candidates.size === 1 ? [...candidates.values()][0] : null;
  const profileUrl = override?.profile_url || (photo && !photo.url ? photo.source_url : null);
  if (profileUrl) {
    try {
      const html = await get(profileUrl, `profile-${fighter.slug}.html`);
      const name = decode(html.match(/<h1 class="hero-profile__name">([^<]+)/)?.[1]?.trim() || '');
      const src = decode(html.match(/property="og:image" content="([^"]+)"/)?.[1] || '');
      if (normalize(name) === normalize(fighter.name) && validPhoto(src)) photo = { name, slug: profileUrl.split('/').at(-1), url: src, source_url: profileUrl, source: 'UFC' };
    } catch (error) { console.log(`Photo unavailable for ${fighter.name}: ${error.message}`); }
  }
  if (photo?.url) output[fighter.slug] = photo;
  else missing.push({ slug: fighter.slug, name: fighter.name, active: fighter.active, reason: candidates.size > 1 ? 'ambiguous' : 'no source photo' });
}
const report = { checked_at: new Date().toISOString(), fighters: fighters.length, matched: Object.keys(output).length, active_fighters: fighters.filter(f => f.active).length, active_missing: missing.filter(f => f.active).length, missing };
writeFileSync('public/headshots.json', JSON.stringify(output, null, 2) + '\n');
mkdirSync('docs', { recursive: true });
writeFileSync('docs/headshot-coverage.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, missing: undefined }));
