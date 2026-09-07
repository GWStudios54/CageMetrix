import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('fighter watchlists are persistent, personalized, and wired into fighter pages',()=>{
  const migration=read('migrations/0022_fighter_watchlists.sql');
  const worker=read('src/worker.ts');
  const watch=read('src/watchlist.ts');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS community_fighter_follows/);
  assert.match(migration,/PRIMARY KEY\(account_id,fighter_id\)/);
  assert.match(worker,/url\.pathname==='\/watchlist'/);
  assert.match(worker,/\/api\/community\\\/fighters/);
  assert.match(worker,/enhanceFighterFollow/);
  assert.match(worker,/enhanceHomeWatchlist/);
  assert.match(watch,/model_probability/);
  assert.match(watch,/Watchlists are limited to 100 fighters/);
  assert.match(watch,/private, no-store/);
});

test('admin panel covers both fight-night and standalone forum reports',()=>{
  const worker=read('src/worker.ts');
  const admin=read('src/admin-v2.ts');
  assert.match(worker,/adminDashboardPage/);
  assert.match(worker,/\/api\/admin\\\/forum\\\/posts/);
  assert.match(worker,/\/api\/admin\\\/forum\\\/reports/);
  assert.match(admin,/forum_reports/);
  assert.match(admin,/Fight & event reports/);
  assert.match(admin,/Forum reports/);
  assert.match(admin,/a\.role='admin'/);
});

test('public sitemap exposes community destinations without leaking personalized pages',()=>{
  const runtime=read('src/public-sitemap.ts');
  const generated=read('scripts/lib/sitemap.mjs');
  assert.match(runtime,/\$\{SITE\}\/community/);
  assert.match(runtime,/\$\{SITE\}\/forum/);
  assert.match(generated,/entry\(`\$\{base\}\/community`\)/);
  assert.match(generated,/entry\(`\$\{base\}\/forum`\)/);
  assert.doesNotMatch(runtime,/\/watchlist/);
  assert.doesNotMatch(generated,/\/watchlist/);
  assert.doesNotMatch(generated,/\/admin/);
});

test('forum hub is indexable while user-generated thread URLs stay out of crawl bloat',()=>{
  const worker=read('src/worker.ts');
  const seo=read('src/forum-seo.ts');
  assert.match(worker,/normalizeForumSeo\(await forumHomePage\(request,env\),'\/forum',true\)/);
  assert.match(worker,/forumScopedThreadPage[\s\S]*false/);
  assert.match(worker,/forumThreadPage[\s\S]*false/);
  assert.match(seo,/noindex,follow/);
});
