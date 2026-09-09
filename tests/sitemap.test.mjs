import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sitemapXml } from '../scripts/lib/sitemap.mjs';

test('sitemap publishes canonical MMA Scouts scouting, legal policy, talent, promotion, event and fighter URLs', () => {
  const xml = sitemapXml({
    fighters: [
      { slug: 'alpha-fighter', last_fight_date: '2026-08-29' },
      { slug: 'a&b', updated_at: '2026-09-03 12:34:56' }
    ],
    scoutFighters: [
      { profile_slug: 'global-prospect', last_fight_date: '2026-09-01' },
      { profile_slug: 'regional-a&b', updated_at: '2026-09-04 12:34:56' }
    ],
    promotions: [
      { slug: 'one', verified_at: '2026-09-08' },
      { slug: 'cage-warriors', verified_at: '2026-09-08' }
    ],
    agencies: [
      { slug: 'example-management', verified_at: '2026-09-08' }
    ],
    events: [
      { slug: 'ufc-example-event', event_date: '2026-09-10' },
      { slug: 'one-friday-fights-170-2026-09-11', event_date: '2026-09-11' }
    ]
  });

  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/scout<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/prospects<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/events<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/promotions<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/talent<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/management<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/data-policy<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/privacy<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/management\/example-management<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/promotions\/one<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/promotions\/cage-warriors<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/scout\/fighters\/global-prospect<\/loc>/);
  assert.match(xml, /scout\/fighters\/regional-a%26b/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/events\/ufc-example-event<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/events\/one-friday-fights-170-2026-09-11<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/fighters\/alpha-fighter<\/loc>/);
  assert.match(xml, /<lastmod>2026-08-29<\/lastmod>/);
  assert.match(xml, /<lastmod>2026-09-01<\/lastmod>/);
  assert.match(xml, /<lastmod>2026-09-08<\/lastmod>/);
  assert.match(xml, /fighters\/a%26b/);
  assert.doesNotMatch(xml, /\/profile-removal/);
  assert.doesNotMatch(xml, /\/predictions|\/validation|\/community|\/forum|\/fights\//);
  assert.doesNotMatch(xml, /cagemetrix\.com/);
  assert.doesNotMatch(xml, /\/api\//);
  assert.doesNotMatch(xml, /\/admin|\/watchlist/);
});

test('sitemap generator indexes public global scouting dossiers and public event shells while filtering removed canonical fighters', () => {
  const source = readFileSync(new URL('../scripts/generate-sitemap.mjs', import.meta.url), 'utf8');
  assert.match(source, /FROM scout_public_global_profiles p/);
  assert.match(source, /p\.career_bouts >= 1/);
  assert.match(source, /p\.data_completeness >= 35/);
  assert.match(source, /e\.promotion_slug IS NOT NULL/);
  assert.match(source, /e\.promotion = 'UFC'/);
  assert.match(source, /EXISTS \(SELECT 1 FROM bouts b WHERE b\.event_id = e\.id\)/);
  assert.doesNotMatch(source, /JOIN predictions p/);
  assert.match(source, /FROM scout_promotions/);
  assert.match(source, /FROM management_agencies/);
  assert.match(source, /fighter_publication_controls c/);
  assert.match(source, /c\.public_status='removed'/);
  assert.match(source, /l\.confidence>=0\.90/);
  assert.match(source, /WHERE active = 1/);
  assert.match(source, /const total = 9 \+ fighters\.length \+ scoutFighters\.length/);
  assert.match(source, /sitemapXml\(\{ fighters, scoutFighters, events, promotions, agencies \}\)/);
});

test('runtime sitemap exposes the broad useful public global fighter set rather than only current regional prospects', () => {
  const source = readFileSync(new URL('../src/public-sitemap.ts', import.meta.url), 'utf8');
  assert.match(source, /FROM scout_public_global_profiles p/);
  assert.match(source, /p\.career_bouts>=1/);
  assert.match(source, /p\.data_completeness>=35/);
  assert.doesNotMatch(source, /p\.current_promotion_slug IS NOT NULL/);
  assert.doesNotMatch(source, /p\.last_fight_date>=date\('now','-730 day'\)/);
  assert.match(source, /\/scout\/fighters\//);
});

test('robots.txt points crawlers at the MMA Scouts sitemap and keeps API/template routes out of search', () => {
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/mmascouts\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /cagemetrix\.com/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/fighter\.html/);
  assert.match(robots, /Disallow: \/fight\.html/);
});
