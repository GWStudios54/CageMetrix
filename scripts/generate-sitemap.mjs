import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { sitemapXml } from './lib/sitemap.mjs';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const local = args.includes('--local');
if (!remote && !local) throw new Error('Choose --local or --remote explicitly');
const target = remote ? '--remote' : '--local';

function wrangler(params) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...params], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
    env: process.env
  });
}

function query(sql) {
  const blocks = JSON.parse(wrangler(['d1', 'execute', 'cagemetrix', target, '--command', sql, '--json']));
  return blocks.flatMap(block => block?.results || []);
}

const fighters = query(`
  SELECT slug, last_fight_date, updated_at
  FROM fighters
  WHERE slug IS NOT NULL AND slug <> '' AND (active = 1 OR ufc_bouts > 0)
  ORDER BY id
`);

const events = query(`
  SELECT DISTINCT e.slug, e.event_date, e.updated_at
  FROM events e
  WHERE e.slug IS NOT NULL AND e.slug <> ''
    AND (
      e.promotion_slug IS NOT NULL
      OR e.promotion = 'UFC'
      OR EXISTS (SELECT 1 FROM bouts b WHERE b.event_id = e.id)
    )
  ORDER BY e.event_date DESC, e.slug
`);

const promotions = query(`
  SELECT slug, verified_at
  FROM scout_promotions
  WHERE active = 1 AND slug IS NOT NULL AND slug <> ''
  ORDER BY slug
`);

const agencies = query(`
  SELECT slug, verified_at, updated_at
  FROM management_agencies
  WHERE active = 1 AND slug IS NOT NULL AND slug <> ''
  ORDER BY slug
`);

mkdirSync('public', { recursive: true });
writeFileSync('public/sitemap.xml', sitemapXml({ fighters, events, promotions, agencies }));
const total = 7 + fighters.length + events.length + promotions.length + agencies.length;
console.log(`Generated sitemap with ${total} URLs (${fighters.length} fighters, ${events.length} events, ${promotions.length} promotions, ${agencies.length} management agencies).`);
