import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('public wire route is wired, public (no adminAccount gate) and indexable',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/from '\.\/public-activity\.ts'/);
  assert.match(entry,/path==='\/wire'\|\|path==='\/wire\/'/);
  assert.match(entry,/publicActivityPage\(request,env\)/);
  const source=read('src/public-activity.ts');
  assert.doesNotMatch(source,/adminAccount/);
  assert.match(source,/content="index,follow"/);
  assert.match(source,/cache-control':'public, max-age=60, s-maxage=300'/);
});

test('public wire feed reuses the admin activity row/query logic instead of duplicating it, with the watch button suppressed',()=>{
  const activity=read('src/recruiting-activity.ts'),wire=read('src/public-activity.ts');
  assert.match(activity,/export const KIND=/);
  assert.match(activity,/export async function activityRows/);
  assert.match(activity,/export function activityRow/);
  assert.match(wire,/activityRow\(row,false\)/);
  assert.doesNotMatch(wire,/data-watch/);
});

test('public wire feed never leaks unverified discovery candidates -- only the same published tables the fighter dossier already surfaces',()=>{
  const activity=read('src/recruiting-activity.ts');
  for(const forbidden of ['contract_intel_candidates','camp_intel_candidates','antidoping_intel_candidates'])assert.doesNotMatch(activity,new RegExp(forbidden));
  for(const table of ['fighter_contract_events','fighter_management_history','fighter_camp_history','fighter_antidoping_events'])assert.match(activity,new RegExp(table));
});

test('fight wire is linked from primary navigation and both sitemap generators',()=>{
  const nav=read('src/navigation.ts');
  assert.match(nav,/href="\/wire">Fight Wire/);
  const runtime=read('src/public-sitemap.ts'),generator=read('scripts/lib/sitemap.mjs');
  assert.match(runtime,/\$\{SITE\}\/wire/);
  assert.match(generator,/\$\{base\}\/wire/);
});
