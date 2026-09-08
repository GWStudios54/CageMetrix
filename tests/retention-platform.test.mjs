import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('fighter watchlist implementation remains preserved for future scouting utility',()=>{
  const migration=read('migrations/0022_fighter_watchlists.sql');
  const worker=read('src/worker.ts');
  const watch=read('src/watchlist.ts');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS community_fighter_follows/);
  assert.match(migration,/PRIMARY KEY\(account_id,fighter_id\)/);
  assert.match(worker,/url\.pathname==='\/watchlist'/);
  assert.match(worker,/followMatch/);
  assert.match(watch,/Watchlists are limited to 100 fighters/);
  assert.match(watch,/private, no-store/);
});

test('archived admin moderation implementation remains available in code',()=>{
  const worker=read('src/worker.ts');
  const admin=read('src/admin.ts');
  assert.match(worker,/adminDashboardPage/);
  assert.match(worker,/adminForumPostMatch/);
  assert.match(worker,/adminForumReportMatch/);
  assert.match(admin,/forum_reports/);
});

test('public sitemap exposes scouting destinations and excludes retired product surfaces',()=>{
  const runtime=read('src/public-sitemap.ts');
  const generated=read('scripts/lib/sitemap.mjs');
  for(const path of ['/scout','/events','/promotions'])assert.ok(runtime.includes(`\${SITE}${path}`)||runtime.includes(`\${SITE}/${path.slice(1)}`),`runtime sitemap missing ${path}`);
  assert.match(generated,/entry\(`\$\{base\}\/scout`\)/);
  assert.match(generated,/entry\(`\$\{base\}\/events`\)/);
  assert.match(generated,/entry\(`\$\{base\}\/promotions`\)/);
  for(const retired of ['predictions','validation','community','forum','/fights/']){
    assert.doesNotMatch(runtime,new RegExp(retired.replaceAll('/','\\/'),'i'));
    assert.doesNotMatch(generated,new RegExp(retired.replaceAll('/','\\/'),'i'));
  }
  assert.doesNotMatch(runtime,/\/watchlist/);
  assert.doesNotMatch(generated,/\/watchlist/);
  assert.doesNotMatch(generated,/\/admin/);
});

test('forum code remains preserved but entry routing retires the public hub',()=>{
  const worker=read('src/worker.ts');
  const seo=read('src/forum-seo.ts');
  const entry=read('src/entry.ts');
  assert.match(worker,/normalizeForumSeo\(await forumHomePage\(request,env\),'\/forum',true\)/);
  assert.match(seo,/noindex,follow/);
  assert.match(entry,/path==='\/forum'/);
  assert.match(entry,/new URL\('\/scout'/);
});
