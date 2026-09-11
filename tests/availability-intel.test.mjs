import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AVAILABILITY_SOURCES,normalizeAvailabilityName,parseAkFightAvailability} from '../scripts/lib/availability-sources.mjs';

const read=path=>fs.readFileSync(path,'utf8');

test('availability evidence has independent provenance and current view',()=>{
  const sql=read('migrations/0040_availability_intelligence.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_availability_evidence/);
  assert.match(sql,/CREATE VIEW scout_current_availability/);
  assert.match(sql,/availability_kind IN \('fight_booking','management','team','short_notice'\)/);
  assert.match(sql,/availability_status IN \('yes','no'\)/);
  assert.match(sql,/agency-availability/);
  assert.doesNotMatch(sql,/UPDATE fighter_opportunity_status/);
});

test('AK parser returns only the official Looking for Opportunities section',()=>{
  const html=`<main>
    <h3>Signed Fighters</h3><h3>Mick Parkin</h3><p>UFC</p>
    <h3>Looking for Opportunities</h3>
    <h3>Andrew Fisher</h3><p>Available</p>
    <h3>Charles Joyner</h3><p>Available</p>
    <h3>Katrina Fisher</h3><p>Pro Debut</p>
    <h3>Paul Kane</h3><p>Available</p>
    <h2>Apply to Be Talent</h2><h3>Application Received</h3>
  </main>`;
  assert.deepEqual(parseAkFightAvailability(html),['Andrew Fisher','Charles Joyner','Katrina Fisher','Paul Kane']);
});

test('availability sync uses exact normalized identity and retires stale yes evidence to unknown, never no',()=>{
  const source=read('scripts/sync-availability.mjs');
  assert.match(source,/normalized_name IN/);
  assert.match(source,/hits\.length===1/);
  assert.match(source,/hits\.length>1/);
  assert.doesNotMatch(source,/fuzzy|levenshtein|similarity/i);
  assert.match(source,/SET is_current=0/);
  assert.match(source,/availability_status.*q\('yes'\)/s);
  assert.doesNotMatch(source,/availability_status.*q\('no'\)/s);
  assert.match(source,/Official management roster explicitly groups this athlete under Looking for Opportunities/);
});

test('availability coverage prefers explicit verified-profile opportunity then agency evidence',()=>{
  const sql=read('migrations/0040_availability_intelligence.sql');
  assert.match(sql,/CASE WHEN COALESCE\(o\.open_to_fights,'unknown'\)<>'unknown' THEN o\.open_to_fights ELSE COALESCE\(ca\.open_to_fights,'unknown'\) END open_to_fights/);
  assert.match(sql,/availability_source_url/);
  assert.match(sql,/LEFT JOIN scout_current_availability ca/);
});

test('professional contact distinguishes direct public routes from management-agency routes',()=>{
  const sql=read('migrations/0040_availability_intelligence.sql');
  assert.match(sql,/COALESCE\(o\.public_contact_url,cm\.agency_website\) professional_contact_url/);
  assert.match(sql,/direct_public/);
  assert.match(sql,/management_agency/);
  assert.match(sql,/professional_contact_kind/);
});

test('availability source is manager-direct Grade A evidence',()=>{
  const source=AVAILABILITY_SOURCES.find(row=>row.slug==='ak-fighter-management-opportunities');
  assert.ok(source);
  assert.equal(source.sourceType,'manager_or_agency_direct');
  assert.equal(source.confidence,'A');
  assert.equal(source.availabilityKind,'fight_booking');
  assert.match(source.url,/^https:\/\/akfightermanagement\.com/);
});

test('availability and contact intelligence never enter Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  assert.doesNotMatch(rating,/fighter_availability_evidence|scout_current_availability|professional_contact_kind|agency-availability/);
});

test('availability workflow is independent and refreshes fighter intelligence after source sync',()=>{
  const workflow=read('.github/workflows/availability-sync.yml'),fighter=read('.github/workflows/fighter-intel.yml');
  assert.match(workflow,/group: mmascouts-availability-sync/);
  assert.match(workflow,/sync-availability\.mjs --dry-run/);
  assert.match(workflow,/npm run availability:sync/);
  assert.match(fighter,/Sync fighter availability intelligence/);
});

test('availability name normalization stays exact-compatible',()=>{
  assert.equal(normalizeAvailabilityName('Cédric Doumbé'),'cedric doumbe');
  assert.equal(normalizeAvailabilityName('Andrew Fisher'),'andrew fisher');
});
