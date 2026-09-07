import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sitemapXml } from '../scripts/lib/sitemap.mjs';

test('sitemap publishes canonical MMA Scouts static, event, fighter and predicted-fight URLs', () => {
  const xml = sitemapXml({
    fighters: [
      { slug: 'alpha-fighter', last_fight_date: '2026-08-29' },
      { slug: 'a&b', updated_at: '2026-09-03 12:34:56' }
    ],
    events: [
      { slug: 'ufc-example-event', event_date: '2026-09-10' }
    ],
    fights: [
      { id: 42, updated_at: '2026-09-03 13:00:00' },
      { id: 77, event_date: '2026-09-10' }
    ]
  });

  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/predictions\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/validation\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/community<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/forum<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/events\/ufc-example-event<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/fighters\/alpha-fighter<\/loc>/);
  assert.match(xml, /<lastmod>2026-08-29<\/lastmod>/);
  assert.match(xml, /fighters\/a%26b/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/fights\/42<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mmascouts\.com\/fights\/77<\/loc>/);
  assert.doesNotMatch(xml, /cagemetrix\.com/);
  assert.doesNotMatch(xml, /\/api\//);
  assert.doesNotMatch(xml, /\/admin|\/watchlist/);
});

test('robots.txt points crawlers at the MMA Scouts sitemap and keeps API/template routes out of search', () => {
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/mmascouts\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /cagemetrix\.com/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/fighter\.html/);
  assert.match(robots, /Disallow: \/fight\.html/);
});
