import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('amateur record schema is manual/evidence-backed only, with no discovery-candidate table',()=>{
  const migration=read('migrations/0046_amateur_record_intelligence.sql');
  for(const table of ['fighter_amateur_record','fighter_amateur_record_evidence'])assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.doesNotMatch(migration,/candidates/i);
  assert.match(migration,/CHECK \(source_url IS NOT NULL OR source_type='verified_profile'\)/);
  assert.match(migration,/CHECK \(wins \+ losses \+ draws \+ no_contests > 0\)/);
  assert.match(migration,/UNIQUE INDEX IF NOT EXISTS idx_fighter_amateur_record_one\s+ON fighter_amateur_record\(source_key,source_fighter_id\)/);
  assert.match(migration,/no real (?:feed|news feed) of "amateur record"/i);
});

test('amateur record admin API requires auth, same-origin, a non-empty record and a real source or verified_profile',()=>{
  const source=read('src/amateur-record-admin.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/sameOrigin\(request\)/);
  assert.match(source,/wins\+losses\+draws\+noContests<=0/);
  assert.match(source,/sourceType!=='verified_profile'/);
  assert.match(source,/ON CONFLICT\(source_key,source_fighter_id\) DO UPDATE/);
});

test('amateur record admin route is wired and admin-gated',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/from '\.\/amateur-record-admin\.ts'/);
  assert.match(entry,/path==='\/api\/admin\/talent\/amateur-record'/);
  assert.match(entry,/setAmateurRecordApi\(request,env\)/);
});

test('amateur record is omitted entirely (not an empty state) when no record is on file, same precedent as anti-doping',()=>{
  const source=read('src/amateur-record-context.ts');
  assert.match(source,/export async function enhanceFighterAmateurRecordContext/);
  assert.match(source,/if\(!data\|\|!data\.record\)return response;/);
  assert.match(source,/on\('\.camp-intelligence',\{element\(el\)\{el\.after\(section,\{html:true\}\);\}\}\)/);
  assert.match(source,/class="contract-intelligence amateur-record-intelligence"/);
});

test('amateur record context is wired into the fighter dossier chain',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/enhanceFighterAmateurRecordContext\(dossier,env,fighterPageMatch\[1\]\)/);
  const campIdx=entry.indexOf('enhanceFighterCampContext(dossier');
  const recordIdx=entry.indexOf('enhanceFighterAmateurRecordContext(dossier');
  assert.ok(campIdx>-1&&recordIdx>-1&&campIdx<recordIdx,'amateur record must be wired after camp context');
});

test('amateur record never feeds Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  for(const forbidden of ['fighter_amateur_record','fighter_amateur_record_evidence'])assert.doesNotMatch(rating,new RegExp(forbidden));
});
