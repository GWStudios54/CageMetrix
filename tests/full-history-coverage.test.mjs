import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacyMigration=fs.readFileSync('migrations/0034_source_name_history_coverage.sql','utf8');
const repairMigration=fs.readFileSync('migrations/0035_source_master_name_identities.sql','utf8');
const derive=fs.readFileSync('scripts/derive-source-name-history-identities.mjs','utf8');
const recover=fs.readFileSync('scripts/recover-global-fight-history.mjs','utf8');
const opponents=fs.readFileSync('scripts/backfill-history-opponent-identities.mjs','utf8');
const audit=fs.readFileSync('scripts/audit-fighter-history-coverage.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/fight-history-recovery.yml','utf8');
const masterWorkflow=fs.readFileSync('.github/workflows/mma-master-sync.yml','utf8');

test('source history identities remain auditable overlays and never rewrite raw source ids',()=>{
  assert.match(legacyMigration,/CREATE TABLE IF NOT EXISTS mma_source_identity_contracts/);
  assert.match(repairMigration,/CREATE TABLE IF NOT EXISTS mma_source_master_name_identities/);
  assert.match(repairMigration,/identity_basis = 'source_exact_name_unique_master'/);
  assert.match(repairMigration,/COALESCE\([\s\S]*p\.source_fighter_id[\s\S]*r\.resolved_source_fighter_id[\s\S]*m\.source_fighter_id/);
  assert.doesNotMatch(derive,/UPDATE mma_fight_participants|UPDATE mma_fighters|SET source_fighter_id/);
});

test('exact-name history resolution uses authoritative master ids instead of undocumented hashes',()=>{
  assert.match(derive,/JOIN mma_fighters f/);
  assert.match(derive,/f\.fighter_name=p\.fighter_name/);
  assert.match(derive,/HAVING COUNT\(DISTINCT f\.source_fighter_id\)=1/);
  assert.match(derive,/source_exact_name_unique_master/);
  assert.match(derive,/normalized_name_guessing=false/);
  assert.match(derive,/hash_identity_assumption=false/);
  assert.doesNotMatch(derive,/createHash\(|md5\(|sha1\(|sha256\(/i);
  assert.doesNotMatch(repairMigration,/mma_source_name_identities h|derived_source_fighter_id/);
});

test('ambiguous or absent exact names remain unresolved rather than being normalized-name guesses',()=>{
  assert.match(derive,/ambiguous_exact_names_remaining/);
  assert.match(derive,/names_without_exact_master_row_remaining/);
  assert.match(derive,/remain intentionally unresolved rather than guessed/);
  assert.match(derive,/unresolved_examples/);
  assert.match(repairMigration,/m\.fighter_name=p\.fighter_name/);
});

test('source-grounded history ids cannot enter the rating graph here',()=>{
  assert.doesNotMatch(derive,/scout_global_ratings|pre_fight_elo|global_rating|scout_score|resume_quality|schedule_strength/);
  assert.doesNotMatch(audit,/UPDATE scout_global_ratings|INSERT .*scout_global_ratings|DELETE FROM scout_global_ratings/);
  assert.doesNotMatch(opponents,/scout_global_ratings|scout_score/);
});

test('history recovery excludes source self-identity collisions and materializes every other completed effective side',()=>{
  assert.match(recover,/o\.effective_source_fighter_id<>p\.effective_source_fighter_id/);
  assert.match(recover,/remaining!==0/);
  assert.match(recover,/History recovery left/);
  assert.match(audit,/unsafe_self_identity_fights/);
  assert.match(audit,/remaining_safe_effective_sides_unmaterialized/);
});

test('existing one-sided history rows receive newly available opponent ids without inventing Elo',()=>{
  assert.match(opponents,/opponent_source_fighter_id/);
  assert.match(opponents,/mma_effective_participants/);
  assert.match(opponents,/o\.effective_source_fighter_id<>p\.effective_source_fighter_id/);
  assert.doesNotMatch(opponents,/opponent_pre_elo\s*=/);
  assert.match(opponents,/resolvable_null_opponents_remaining/);
});

test('coverage ledger distinguishes materialization, identity coverage and source freshness',()=>{
  assert.match(legacyMigration,/CREATE TABLE IF NOT EXISTS mma_fighter_history_coverage/);
  assert.match(legacyMigration,/source_reported_completed_bouts/);
  assert.match(legacyMigration,/materialized_completed_bouts/);
  assert.match(legacyMigration,/materialization_status IN \('complete','gap','no_source_bouts'\)/);
  assert.match(legacyMigration,/freshness_status IN \('current','aging','stale','unknown'\)/);
  assert.match(audit,/safely attributable completed fighter-side bout/);
  assert.match(audit,/identity_resolution/);
  assert.match(audit,/unresolved_sides/);
  assert.match(audit,/Freshness and unresolved identities remain independent requirements/);
  assert.match(audit,/if\(gaps!==0\|\|missing!==0\|\|missingPublicCoverage!==0\|\|remainingEffectiveMissing!==0\)throw new Error/);
});

test('production master sync serializes ahead of history recovery and PR validation cannot write through workflow_run',()=>{
  assert.match(masterWorkflow,/0035_source_master_name_identities\.sql/);
  assert.match(masterWorkflow,/scripts\/derive-source-name-history-identities\.mjs/);
  assert.match(masterWorkflow,/\.github\/workflows\/fight-history-recovery\.yml/);
  assert.doesNotMatch(workflow,/\n  push:/);
  assert.match(workflow,/github\.event\.workflow_run\.event != 'pull_request'/);
  assert.match(workflow,/github\.event\.workflow_run\.head_branch == 'main'/);
});

test('production recovery order applies repaired identity schema before recovery and audits after materialization',()=>{
  const migrate=workflow.indexOf('Apply history identity and coverage schema');
  const resolve=workflow.indexOf('Resolve ambiguous participant identities');
  const deriveStep=workflow.indexOf('Derive source-consistent exact-name history identities');
  const recoverStep=workflow.indexOf('Recover every safe completed fighter-side history row');
  const opponentStep=workflow.indexOf('Backfill newly resolved opponent identities');
  const auditStep=workflow.indexOf('Prove source-reported history materialization and freshness');
  const intel=workflow.indexOf('Refresh fighter intelligence after history repair');
  assert.ok(migrate>=0&&resolve>migrate&&deriveStep>resolve&&recoverStep>deriveStep&&opponentStep>recoverStep&&auditStep>opponentStep&&intel>auditStep);
  assert.match(workflow,/source-name-history\/summary\.json/);
  assert.match(workflow,/fighter-history-coverage\/summary\.json/);
});
