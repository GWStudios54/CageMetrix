import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('global Scout schema separates universal rating from optional technical stats',()=>{
  const migration=read('migrations/0025_global_scouting.sql'),history=read('migrations/0026_global_scout_fight_history.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS scout_global_profiles/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS scout_global_ratings/);
  assert.match(migration,/global_skill REAL NOT NULL/);
  assert.match(migration,/resume_quality REAL NOT NULL/);
  assert.match(migration,/schedule_strength REAL NOT NULL/);
  assert.match(migration,/recent_form REAL NOT NULL/);
  assert.match(migration,/finishing_quality REAL NOT NULL/);
  assert.match(migration,/evidence_strength REAL NOT NULL/);
  assert.doesNotMatch(migration,/technical_score REAL NOT NULL/);
  assert.match(history,/CREATE TABLE IF NOT EXISTS scout_global_fights/);
  assert.match(history,/opponent_pre_elo REAL/);
  assert.match(history,/scout_active_global_fights/);
});

test('promotion registry covers seeded US, European and Asian scouting circuits',()=>{
  const rows=JSON.parse(read('scripts/data/scout-promotions.json'));
  assert.deepEqual(new Set(rows.map(row=>row.region)),new Set(['United States','Europe','Asia']));
  assert.ok(rows.length>=20);
  for(const slug of ['lfa','cffc','cage-warriors','oktagon','ksw','ares','rizin','pancrase','shooto','road-fc','black-combat'])assert.ok(rows.some(row=>row.slug===slug),`missing ${slug}`);
  for(const row of rows){assert.ok(row.name&&row.slug&&row.scope);assert.ok(Array.isArray(row.aliases)&&row.aliases.length>0);}
});

test('Global Scout Rating uses completed chronological evidence and no prestige multiplier',()=>{
  const source=read('scripts/build-global-scout-rating-v2.py');
  assert.match(source,/Promotion prestige never adds points/);
  assert.match(source,/outcome\(row/);
  assert.match(source,/run_day = datetime\.now\(timezone\.utc\)\.date\(\)/);
  assert.match(source,/IdentityResolver/);
  assert.match(source,/f\{side\}_gym/);
  assert.match(source,/opponent_pre_elo/);
  assert.match(source,/quality_wins/);
  assert.match(source,/fit\(validation/);
  assert.match(source,/VALIDATION_START = "2024-01-01"/);
  assert.match(source,/elo_baseline/);
  assert.match(source,/combined_model/);
  assert.match(source,/scout_global_fights/);
  assert.doesNotMatch(source,/promotion_multiplier/i);
  assert.doesNotMatch(source,/promotion_bonus/i);
});

test('fight-pattern signals (finish speed, durability) are computed from existing method/round data, not new sourcing',()=>{
  const migration=read('migrations/0043_fight_pattern_signals.sql');
  assert.match(migration,/ALTER TABLE scout_global_profiles ADD COLUMN finish_round_sum INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration,/ALTER TABLE scout_global_profiles ADD COLUMN first_round_finishes INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration,/ALTER TABLE scout_global_profiles ADD COLUMN times_finished INTEGER NOT NULL DEFAULT 0/);
  const builder=read('scripts/build-global-scout-rating-v2.py');
  assert.match(builder,/finish_round_sum=first_round_finishes=times_finished=0/);
  assert.match(builder,/elif h\["result"\] == "L" and ft in \("KO","SUB"\): times_finished \+= 1/);
  assert.match(builder,/"finish_round_sum","first_round_finishes","times_finished"/);
  const recovery=read('scripts/recover-global-fight-history.mjs');
  assert.match(recovery,/finish_round_sum=\(SELECT COALESCE\(SUM\(g\.round_num\),0\)/);
  assert.match(recovery,/times_finished=\(SELECT COUNT\(\*\) FROM scout_global_fights g WHERE[\s\S]*?g\.result='L'/);
});

test('master sync builds and verifies dossiers, rating and fighter-centric history before exposure',()=>{
  const workflow=read('.github/workflows/mma-master-sync.yml');
  assert.match(workflow,/build-global-scout-rating-v2\.py/);
  assert.match(workflow,/scout-global-summary\.json/);
  assert.match(workflow,/scout_active_global_profiles/);
  assert.match(workflow,/scout_active_global_ratings/);
  assert.match(workflow,/scout_active_global_fights/);
  assert.match(workflow,/profiles'\] >= 15000/);
  assert.match(workflow,/ratings'\] >= 12000/);
  assert.match(workflow,/combined_model'\]\['log_loss'\] < scout\['elo_baseline'\]\['log_loss'\]/);
});
