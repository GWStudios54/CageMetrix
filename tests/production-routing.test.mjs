import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('dynamic and retired product routes run through the Worker before static assets', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const routes = new Set(config.assets?.run_worker_first || []);
  for (const route of [
    '/scout', '/scout/*', '/prospects', '/talent', '/management', '/promotions', '/events',
    '/data-policy', '/privacy', '/profile-removal', '/predictions.html', '/validation', '/validation.html',
    '/community', '/forum', '/watchlist', '/api/*', '/sitemap.xml'
  ]) assert.ok(routes.has(route), `missing Worker-first route: ${route}`);
});

test('post-deploy smoke validates modern scouting APIs and the retired validation redirect at the header level', () => {
  const workflow = readFileSync(new URL('../.github/workflows/post-deploy-smoke.yml', import.meta.url), 'utf8');
  assert.match(workflow, /\/api\/scout\/fighters\?limit=1/);
  assert.match(workflow, /\/api\/prospects\?limit=1/);
  assert.match(workflow, /\/api\/talent\?limit=1/);
  assert.match(workflow, /https:\/\/mmascouts\.com\/prospects/);
  assert.match(workflow, /https:\/\/mmascouts\.com\/talent/);
  assert.match(workflow, /https:\/\/mmascouts\.com\/management/);
  assert.match(workflow, /check_redirect 'https:\/\/mmascouts\.com\/validation\.html' 'https:\/\/mmascouts\.com\/#rankings'/);
  assert.match(workflow, /<loc>https:\/\/mmascouts\.com\/scout\/fighters\//);
});
