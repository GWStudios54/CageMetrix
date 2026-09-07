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
  WHERE slug IS NOT NULL AND slug <> ''
  ORDER BY id
`);

const fights = query(`
  SELECT DISTINCT b.id, b.updated_at, e.event_date
  FROM bouts b
  JOIN predictions p ON p.bout_id = b.id
  JOIN events e ON e.id = b.event_id
  ORDER BY b.id
`);

mkdirSync('public', { recursive: true });
writeFileSync('public/sitemap.xml', sitemapXml({ fighters, fights }));
console.log(`Generated sitemap with ${5 + fighters.length + fights.length} URLs (${fighters.length} fighters, ${fights.length} predicted fights).`);
