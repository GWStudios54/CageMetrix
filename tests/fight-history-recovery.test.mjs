import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('scripts/recover-global-fight-history.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/fight-history-recovery.yml','utf8');

test('history recovery materializes trustworthy one-sided results without changing the rating graph',()=>{
  assert.match(source,/p\.source_fighter_id IS NOT NULL/);
  assert.match(source,/p\.result IN \('W','L','D','NC'\)/);
  assert.match(source,/o\.source_fighter_id IS NULL OR o\.source_fighter_id<>p\.source_fighter_id/);
  assert.match(source,/INSERT OR IGNORE INTO scout_global_fights/);
  assert.match(source,/opponent_source_fighter_id/);
  assert.match(source,/opponent_pre_elo/);
  assert.match(source,/NULL,f\.is_title_fight/);
  assert.doesNotMatch(source,/UPDATE scout_global_ratings|INSERT .*scout_global_ratings|DELETE FROM scout_global_ratings/);
  assert.match(source,/rating graph stays untouched/i);
});

test('profile aggregates are recomputed from the richer materialized fight history',()=>{
  for(const field of ['career_start_date','last_fight_date','career_bouts','career_wins','career_losses','career_draws','career_no_contests','organization_count','recent_bouts_730d','last_five_wins','last_five_losses'])assert.ok(source.includes(field),`missing aggregate ${field}`);
  assert.match(source,/UPDATE scout_global_profiles AS p SET/);
  assert.match(source,/FROM scout_global_fights g/);
  assert.match(source,/data_completeness=MIN\(100,55\+7\.5/);
});

test('recovery audits the pair-or-nothing hole while quarantining source rows that resolve both corners to one fighter',()=>{
  assert.match(source,/one_sided_completed_fights/);
  assert.match(source,/zero_sided_completed_fights/);
  assert.match(source,/unsafe_self_identity_sides/);
  assert.match(source,/safe_resolved_history_rows_missing/);
  assert.match(source,/remaining_safe_resolved_history_rows_missing/);
  assert.match(source,/if\(remaining!==0\)throw new Error/);
  assert.match(source,/top_recovered_fighters/);
  assert.match(source,/coverage_bands/);
});

test('history recovery automatically follows every completed master-database refresh and can be run manually',()=>{
  assert.match(workflow,/workflow_run:/);
  assert.match(workflow,/Sync MMA master database/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/recover-global-fight-history\.mjs --remote/);
  assert.match(workflow,/fight-history-recovery\.test\.mjs/);
});
