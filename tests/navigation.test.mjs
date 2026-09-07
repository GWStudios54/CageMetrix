import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('one canonical top menu is used across rendered pages',()=>{
  const nav=read('src/navigation.ts');
  const session=read('src/admin-session.ts');
  const worker=read('src/worker.ts');
  for(const href of ['/predictions.html','/#rankings','/forum','/watchlist','/community'])assert.ok(nav.includes(`href=\"${href}\"`),`missing ${href}`);
  assert.ok(nav.includes('href=\"/admin\"'),'admin link missing');
  assert.ok(nav.includes('adminAccount(request,env.DB)'),'navigation must ask the shared session layer for admin status');
  assert.ok(session.includes("a.role='admin'"),'shared session lookup must role-gate the admin tab');
  assert.ok(worker.includes("import {normalizeNavigation} from './navigation.ts'"));
  assert.ok(worker.includes('return renderPage(base.fetch(routed,env,context),request,env)'),'static HTML fallback must use global nav');
  for(const route of ['homePage','predictionsPage','adminDashboardPage','watchlistPage','communityHomePage','forumHomePage','communityProfilePage','enhanceFighterFollow','enhanceFightCommunity'])assert.ok(worker.includes(route),`missing routed page ${route}`);
});

test('mobile navigation is a stable three-column grid instead of overflowing',()=>{
  const css=read('public/navigation.css');
  assert.ok(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));
  assert.ok(css.includes('flex-direction:column'));
  assert.ok(css.includes('overflow:hidden'));
  assert.ok(css.includes('.admin-link'));
});
