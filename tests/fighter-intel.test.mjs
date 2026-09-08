import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {INTEL_FIELD_CATALOG,INTEL_SOURCE_POLICY,safeProfessionalUrl} from '../scripts/lib/fighter-intel-policy.mjs';

const read=path=>fs.readFileSync(path,'utf8');

test('fighter intel schema separates facts, events and source provenance',()=>{
  const sql=read('migrations/0030_fighter_intelligence.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_intel_sources/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_intel_facts/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_intel_events/);
  assert.match(sql,/CREATE VIEW scout_fighter_intel_coverage/);
  assert.match(sql,/source_url TEXT/);
  assert.match(sql,/confidence TEXT NOT NULL DEFAULT 'C'/);
  assert.match(sql,/professional scouting intelligence/);
  assert.match(sql,/private phone numbers, home addresses/);
});

test('coverage spans core professional scouting fields for every active profile',()=>{
  const sql=read('migrations/0030_fighter_intelligence.sql');
  assert.equal(INTEL_FIELD_CATALOG.length,18);
  assert.match(sql,/FROM scout_active_global_profiles p/);
  for(const field of ['p.dob','p.height_cm','p.reach_cm','p.stance','p.nationality','p.gym','p.current_organization','p.current_weight_class','p.career_start_date','p.last_fight_date','management_status','contract_status','open_to_fights','open_to_management','open_to_team','base_country','public_contact_url'])assert.ok(sql.includes(field),`missing coverage field ${field}`);
});

test('intel source policy prioritizes primary professional sources',()=>{
  const bySlug=new Map(INTEL_SOURCE_POLICY.map(row=>[row.slug,row]));
  assert.equal(bySlug.get('verified-profile').priority,100);
  assert.equal(bySlug.get('management-rosters').priority,100);
  assert.equal(bySlug.get('promotion-sites').official,true);
  assert.ok(bySlug.get('credible-media').priority<bySlug.get('fighter-public').priority);
  assert.equal(safeProfessionalUrl('https://example.com/contact'),'https://example.com/contact');
  assert.equal(safeProfessionalUrl('javascript:alert(1)'),null);
});

test('warehouse sync does not invent management, contract or availability claims',()=>{
  const source=read('scripts/sync-fighter-intel.mjs');
  assert.match(source,/UPDATE fighter_intel_facts SET is_current=0/);
  assert.match(source,/FROM scout_active_global_profiles p/);
  assert.match(source,/FROM fighter_management_history h/);
  assert.match(source,/FROM fighter_opportunity_status o WHERE o\.contract_status<>'unknown'/);
  assert.match(source,/WHERE o\.\$\{field\}<>'unknown'/);
  assert.doesNotMatch(source,/management_status='unmanaged'/);
  assert.doesNotMatch(source,/contract_status='free_agent'/);
});

test('career movement timeline is derived from recorded organization and weight changes',()=>{
  const source=read('scripts/sync-fighter-intel.mjs');
  assert.match(source,/LAG\(f\.organization\)/);
  assert.match(source,/event_type,title,summary/);
  assert.match(source,/'promotion_change'/);
  assert.match(source,/LAG\(f\.weight_class\)/);
  assert.match(source,/'weight_change'/);
  assert.match(source,/'management_change'/);
});

test('fighter dossier exposes intel endpoint and appends intelligence context',()=>{
  const entry=read('src/entry.ts');
  const intel=read('src/fighter-intel.ts');
  assert.match(entry,/fighterIntelApi/);
  assert.match(entry,/\/intel\\\/\?\$/);
  assert.match(entry,/enhanceFighterIntel/);
  assert.match(intel,/INTELLIGENCE COVERAGE/);
  assert.match(intel,/CAREER INTELLIGENCE/);
  assert.match(intel,/Missing evidence stays unknown/);
  assert.match(intel,/no_private_contact_collection:true/);
});
