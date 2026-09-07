import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sitemapXml } from '../scripts/lib/sitemap.mjs';

test('sitemap publishes canonical static, event, fighter and predicted-fight URLs', () => {
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

  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/predictions\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/validation\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/community<\/loc>/);
  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/forum<\/loc>/);
  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/events\/ufc-example-event<\/loc>/);
  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/fighters\/alpha-fighter<\/loc>/);
  assert.match(xml, /<lastmod>2026-08-29<\/lastmod>/);
  assert.match(xml, /fighters\/a%26b/);
  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/fights\/42<\/loc>/);
  assert.match(xml, /<loc>https:\/\/cagemetrix\.com\/fights\/77<\/loc>/);
  assert.doesNotMatch(xml, /\/api\//);
  assert.doesNotMatch(xml, /\/admin|\/watchlist/);
});

test('robots.txt points crawlers at the sitemap and keeps API/template routes out of search', () => {
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/cagemetrix\.com\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/fighter\.html/);
  assert.match(robots, /Disallow: \/fight\.html/);
});
