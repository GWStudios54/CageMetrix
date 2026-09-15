import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('watchlist schema is private, owner-scoped and unique per fighter',()=>{
  const migration=read('migrations/0042_recruiting_watchlist.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS recruiting_watchlist/);
  assert.match(migration,/owner_account_id INTEGER NOT NULL/);
  assert.match(migration,/FOREIGN KEY\(owner_account_id\) REFERENCES community_accounts\(id\) ON DELETE CASCADE/);
  assert.match(migration,/UNIQUE\(owner_account_id,source_key,source_fighter_id\)/);
  assert.match(migration,/status IN \('watching','contacted','passed','signed'\)/);
  assert.match(migration,/snapshot_management_status TEXT/);
  assert.match(migration,/snapshot_contract_status TEXT/);
  assert.match(migration,/snapshot_open_to_fights TEXT/);
});

test('watchlist APIs are admin-gated, same-origin and owner-scoped',()=>{
  const source=read('src/recruiting-watchlist.ts'),entry=read('src/entry.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/sameOrigin\(request\)/);
  assert.match(source,/WHERE id=\? AND owner_account_id=\?/);
  assert.match(entry,/api\/admin\/recruiting\/watchlist/);
  assert.match(entry,/watchlistItemMatch/);
  assert.match(entry,/watchlistPromoteMatch/);
  assert.match(entry,/watchlistPage/);
});

test('adding a fighter snapshots current status instead of comparing against nothing',()=>{
  const source=read('src/recruiting-watchlist.ts');
  assert.match(source,/async function currentStatus\(/);
  assert.match(source,/INSERT INTO recruiting_watchlist\(owner_account_id,source_key,source_fighter_id,profile_slug,snapshot_management_status,snapshot_contract_status,snapshot_open_to_fights\)/);
  assert.match(source,/ON CONFLICT\(owner_account_id,source_key,source_fighter_id\) DO NOTHING/);
});

test('status-change detection compares live computed status against the stored snapshot, not a notification system',()=>{
  const source=read('src/recruiting-watchlist.ts');
  assert.match(source,/status_changed:Boolean\(row\.snapshot_management_status\)&&\(/);
  assert.match(source,/row\.snapshot_management_status!==row\.management_status/);
  assert.match(source,/row\.snapshot_contract_status!==row\.contract_status/);
  assert.match(source,/row\.snapshot_open_to_fights!==row\.open_to_fights/);
  assert.match(source,/if\(input\.reviewed===true\)/);
  assert.match(source,/SET snapshot_management_status=\?,snapshot_contract_status=\?,snapshot_open_to_fights=\?,last_reviewed_at=CURRENT_TIMESTAMP/);
});

test('watchlist entries can be promoted into an owned opening candidate list without duplicating rows',()=>{
  const source=read('src/recruiting-watchlist.ts');
  assert.match(source,/export async function promoteWatchlistItemApi/);
  assert.match(source,/SELECT id FROM recruiting_openings WHERE id=\? AND owner_account_id=\?/);
  assert.match(source,/INSERT OR IGNORE INTO recruiting_opening_candidates\(opening_id,source_key,source_fighter_id,profile_slug\)/);
});

test('the recruiting board and intel queue link to the watchlist, and the intel queue can add to it',()=>{
  const recruiting=read('src/recruiting.ts');
  assert.match(recruiting,/href="\/recruiting\/watchlist">Global watchlist/);
  assert.match(recruiting,/data-watch="\$\{esc\(row\.profile_slug\)\}"/);
  assert.match(recruiting,/fetch\('\/api\/admin\/recruiting\/watchlist'/);
});

test('watchlist cards surface finish speed and durability alongside finish rate',()=>{
  const source=read('src/recruiting-watchlist.ts');
  assert.match(source,/p\.finish_round_sum,p\.first_round_finishes,p\.times_finished,/);
  assert.match(source,/Avg finish round \$\{\(Number\(row\.finish_round_sum\|\|0\)\/finishes\)\.toFixed\(1\)\}/);
  assert.match(source,/if\(timesFinished>0\)facts\.push\(`Finished \$\{timesFinished\}x`\);/);
});

test('post-deploy smoke verifies the watchlist page is private like the rest of the recruiting workspace',()=>{
  const smoke=read('.github/workflows/post-deploy-smoke.yml');
  assert.match(smoke,/watchlist_code/);
  assert.match(smoke,/mmascouts\.com\/recruiting\/watchlist/);
  assert.match(smoke,/test "\$watchlist_code" = "403"/);
});

test('the public talent search only exposes the watch action to authenticated admins and never caches admin state',()=>{
  const source=read('src/talent-network.ts');
  assert.match(source,/const isAdmin=!!await adminAccount\(request,env\.DB\)/);
  assert.match(source,/const watchButton=\(row:Row\)=>isAdmin\?/);
  assert.match(source,/cache-control':isAdmin\?'private, no-store':'public, max-age=30, s-maxage=120'/);
});
