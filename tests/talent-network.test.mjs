import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('talent schema stores agencies, historical representation and explicit opportunity status',()=>{
  const migration=read('migrations/0028_talent_network.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS management_agencies/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS fighter_management_history/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS fighter_opportunity_status/);
  assert.match(migration,/management_status IN \('unknown','represented','unmanaged'\)/);
  assert.match(migration,/contract_status IN \('unknown','under_contract','free_agent','non_exclusive'\)/);
  assert.match(migration,/idx_fighter_management_one_current/);
  assert.match(migration,/WHERE is_current=1/);
  assert.match(migration,/scout_current_management/);
});

test('talent search never infers unmanaged or free-agent status from missing data',()=>{
  const source=read('src/talent-network.ts');
  assert.match(source,/Missing public evidence remains unknown/);
  assert.match(source,/CASE WHEN cm\.source_fighter_id IS NOT NULL THEN 'represented' ELSE COALESCE\(o\.management_status,'unknown'\) END/);
  assert.match(source,/COALESCE\(o\.contract_status,'unknown'\)/);
  assert.match(source,/Verified unmanaged/);
  assert.match(source,/Publicly verified free agent/);
  assert.match(source,/unmanaged_requires_source/);
  assert.match(source,/free_agent_requires_source/);
});

test('talent discovery supports performance, representation and opportunity filters',()=>{
  const source=read('src/talent-network.ts');
  for(const needle of ['weight_class','promotion','region','country','management','contract','opportunity','age_max','age_min','min_rating','min_evidence','min_wins'])assert.ok(source.includes(needle),`missing ${needle} filter`);
  assert.match(source,/o\.open_to_fights='yes'/);
  assert.match(source,/o\.open_to_management='yes'/);
  assert.match(source,/o\.open_to_team='yes'/);
  assert.match(source,/r\.scout_rating>=\?/);
});

test('talent and management pages are first-class public routes and fighter dossiers get verified context',()=>{
  const entry=read('src/entry.ts'),nav=read('src/navigation.ts');
  assert.match(entry,/path==='\/api\/talent'/);
  assert.match(entry,/path==='\/api\/management'/);
  assert.match(entry,/path==='\/talent'/);
  assert.match(entry,/path==='\/management'/);
  assert.match(entry,/enhanceFighterTalentContext/);
  assert.match(nav,/href="\/talent">Talent/);
});

test('representation context never feeds the fighter performance rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  assert.doesNotMatch(rating,/management_agencies|fighter_management_history|fighter_opportunity_status|agency_id/);
  const talent=read('src/talent-network.ts');
  assert.match(talent,/Agency affiliation is context only and never increases a fighter's rating/);
});

test('admin curation is authenticated and source-ranked',()=>{
  const source=read('src/talent-network.ts'),entry=read('src/entry.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/CONFIDENCE=new Set\(\['A','B','C'\]\)/);
  assert.match(entry,/\/api\\\/admin\\\/talent/);
});
