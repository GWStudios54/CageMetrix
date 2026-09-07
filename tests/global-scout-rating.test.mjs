import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('global Scout schema separates universal rating from optional technical stats',()=>{
  const migration=read('migrations/0025_global_scouting.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS scout_global_profiles/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS scout_global_ratings/);
  assert.match(migration,/global_skill REAL NOT NULL/);
  assert.match(migration,/resume_quality REAL NOT NULL/);
  assert.match(migration,/schedule_strength REAL NOT NULL/);
  assert.match(migration,/recent_form REAL NOT NULL/);
  assert.match(migration,/finishing_quality REAL NOT NULL/);
  assert.match(migration,/evidence_strength REAL NOT NULL/);
  assert.doesNotMatch(migration,/technical_score REAL NOT NULL/);
});

test('promotion registry covers seeded US, European and Asian scouting circuits',()=>{
  const rows=JSON.parse(read('scripts/data/scout-promotions.json'));
  const regions=new Set(rows.map(row=>row.region));
  assert.deepEqual(regions,new Set(['United States','Europe','Asia']));
  assert.ok(rows.length>=20);
  for(const slug of ['lfa','cffc','cage-warriors','oktagon','ksw','ares','rizin','pancrase','shooto','road-fc','black-combat']){
    assert.ok(rows.some(row=>row.slug===slug),`missing ${slug}`);
  }
  for(const row of rows){
    assert.ok(row.name&&row.slug&&row.scope);
    assert.ok(Array.isArray(row.aliases)&&row.aliases.length>0);
  }
});

test('Global Scout Rating derives promotion strength from the fight graph, not prestige bonuses',()=>{
  const source=read('scripts/build-global-scout-rating.py');
  assert.match(source,/Promotion names are metadata, never rating bonuses/);
  assert.match(source,/elo_expected/);
  assert.match(source,/opponent_pre_elo/);
  assert.match(source,/quality_wins/);
  assert.match(source,/schedule/);
  assert.match(source,/fit_positive_logistic/);
  assert.match(source,/VALIDATION_START = "2024-01-01"/);
  assert.match(source,/elo_baseline/);
  assert.match(source,/combined_model/);
  assert.doesNotMatch(source,/promotion_multiplier/i);
  assert.doesNotMatch(source,/promotion_bonus/i);
});

test('master sync builds and verifies global profiles before they are exposed',()=>{
  const workflow=read('.github/workflows/mma-master-sync.yml');
  assert.match(workflow,/build-global-scout-rating\.py/);
  assert.match(workflow,/scout-global-summary\.json/);
  assert.match(workflow,/scout_active_global_profiles/);
  assert.match(workflow,/scout_active_global_ratings/);
  assert.match(workflow,/profiles'\] >= 14000/);
  assert.match(workflow,/ratings'\] >= 14000/);
});
