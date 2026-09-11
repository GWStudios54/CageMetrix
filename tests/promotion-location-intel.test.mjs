import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PFL_LOCATION_SOURCE,normalizeFighterName,parsePflProfile,parsePflRoster,parseProfessionalLocation} from '../scripts/lib/promotion-location-sources.mjs';

const read=path=>fs.readFileSync(path,'utf8');

test('location intelligence keeps professional base evidence separate from opportunity provenance',()=>{
  const sql=read('migrations/0039_location_intelligence.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_location_evidence/);
  assert.match(sql,/CREATE VIEW scout_current_location/);
  assert.match(sql,/location_kind TEXT NOT NULL CHECK \(location_kind IN \([\s\S]*?'fighting_out_of','training_base','camp_location','hometown','other_professional'[\s\S]*?\)\)/);
  assert.match(sql,/CASE WHEN COALESCE\(o\.base_city,o\.base_region,o\.base_country\) IS NOT NULL THEN o\.base_city ELSE cl\.base_city END base_city/);
  assert.match(sql,/base_source_url/);
  assert.doesNotMatch(sql,/UPDATE fighter_opportunity_status/);
});

test('PFL roster parser only accepts same-host official fighter profile links',()=>{
  const html='<main><a href="/all-fighter/johnny-eblen">Johnny Eblen</a><a href="/regular-fighter/paul-hughes">Paul Hughes</a><a href="https://evil.example/all-fighter/fake">Fake</a><a href="/news/fighter-signing">News</a></main>';
  const rows=parsePflRoster(html,PFL_LOCATION_SOURCE);
  assert.deepEqual(rows.map(row=>row.url),['https://pflmma.com/all-fighter/johnny-eblen','https://pflmma.com/regular-fighter/paul-hughes']);
});

test('PFL profile parser separates hometown from fighting base and camp',()=>{
  const html='<!doctype html><html><head><title>Johnny Eblen | Middleweight (185)</title></head><body><main><div>FROM Des Moines, IA</div><div>FIGHTING OUT OF Coconut Creek, FL</div><div>FIGHT CAMP American Top Team</div><div>SOCIAL</div></main></body></html>';
  const row=parsePflProfile(html,'https://pflmma.com/all-fighter/johnny-eblen');
  assert.equal(row.fighter_name,'Johnny Eblen');
  assert.equal(row.fighting_out_of,'Coconut Creek, FL');
  assert.equal(row.fight_camp,'American Top Team');
  assert.deepEqual(row.location,{raw_value:'Coconut Creek, FL',city:'Coconut Creek',region:'FL',country:'United States'});
  assert.doesNotMatch(JSON.stringify(row),/Des Moines/);
});

test('professional location parser only decomposes explicit location text',()=>{
  assert.deepEqual(parseProfessionalLocation('Mesa, AZ'),{raw_value:'Mesa, AZ',city:'Mesa',region:'AZ',country:'United States'});
  assert.deepEqual(parseProfessionalLocation('Paris, France'),{raw_value:'Paris, France',city:'Paris',region:null,country:'France'});
  assert.deepEqual(parseProfessionalLocation('Spain'),{raw_value:'Spain',city:null,region:null,country:'Spain'});
  assert.deepEqual(parseProfessionalLocation('Mystery Gym City'),{raw_value:'Mystery Gym City',city:null,region:null,country:null});
});

test('promotion location sync uses exact normalized identity only and skips ambiguity',()=>{
  const source=read('scripts/sync-promotion-location.mjs');
  assert.match(source,/normalized_name IN/);
  assert.match(source,/hits\.length===1/);
  assert.match(source,/hits\.length>1/);
  assert.match(source,/ambiguous/);
  assert.doesNotMatch(source,/fuzzy|levenshtein|similarity/i);
  assert.match(source,/fighter_location_evidence/);
  assert.match(source,/FIGHTING OUT OF/);
  assert.match(source,/FIGHT CAMP/);
  assert.doesNotMatch(source,/fighter_opportunity_status/);
});

test('PFL location and camp evidence is first-party grade A and cannot affect Global Rating',()=>{
  const source=read('scripts/sync-promotion-location.mjs'),rating=read('scripts/build-global-scout-rating-v2.py');
  assert.match(source,/promotion_direct/);
  assert.match(source,/q\('A'\)/);
  assert.match(source,/team\.primary/);
  assert.doesNotMatch(rating,/fighter_location_evidence|scout_current_location|promotion-location|base_source_url/);
});

test('package and workflow provide independent idempotent promotion-location sync',()=>{
  const pkg=JSON.parse(read('package.json')),workflow=read('.github/workflows/promotion-location-sync.yml');
  assert.equal(pkg.scripts['locations:sync'],'node scripts/sync-promotion-location.mjs --remote');
  assert.match(workflow,/group: mmascouts-promotion-location/);
  assert.match(workflow,/d1 migrations apply cagemetrix --remote/);
  assert.match(workflow,/sync-promotion-location\.mjs --dry-run/);
  assert.match(workflow,/npm run locations:sync/);
});

test('name normalization remains exact-compatible without fuzzy identity repair',()=>{
  assert.equal(normalizeFighterName('Salah Eddine Hamli'),'salah eddine hamli');
  assert.equal(normalizeFighterName('Cédric Doumbé'),'cedric doumbe');
});
