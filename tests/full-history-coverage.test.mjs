import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('migrations/0034_source_name_history_coverage.sql','utf8');
const derive=fs.readFileSync('scripts/derive-source-name-history-identities.mjs','utf8');
const recover=fs.readFileSync('scripts/recover-global-fight-history.mjs','utf8');
const opponents=fs.readFileSync('scripts/backfill-history-opponent-identities.mjs','utf8');
const audit=fs.readFileSync('scripts/audit-fighter-history-coverage.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/fight-history-recovery.yml','utf8');

test('source-only history identities are an auditable overlay, never a raw-source rewrite',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS mma_source_identity_contracts/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS mma_source_name_identities/);
  assert.match(migration,/identity_basis IN \('source_exact_name_md5'\)/);
  assert.match(migration,/COALESCE\(p\.source_fighter_id,r\.resolved_source_fighter_id,h\.derived_source_fighter_id\)/);
  assert.doesNotMatch(derive,/UPDATE mma_fight_participants|UPDATE mma_fighters|SET source_fighter_id/);
});

test('upstream exact-name MD5 identity semantics are verified across the whole active master before derivation',()=>{
  assert.match(derive,/createHash\('md5'\)/);
  assert.match(derive,/update\(String\(value\),'utf8'\)/);
  assert.match(derive,/master_rows_checked/);
  assert.match(derive,/if\(mismatches\.length\)throw new Error/);
  assert.match(derive,/md5\(fighterName\)/);
  assert.match(derive,/source_exact_name_md5/);
  assert.match(derive,/human-identity verification/);
});

test('derived history ids are explicitly source bookkeeping and cannot enter the rating graph here',()=>{
  assert.doesNotMatch(derive,/scout_global_ratings|pre_fight_elo|global_rating|scout_score|resume_quality|schedule_strength/);
  assert.doesNotMatch(audit,/UPDATE scout_global_ratings|INSERT .*scout_global_ratings|DELETE FROM scout_global_ratings/);
  assert.doesNotMatch(opponents,/scout_global_ratings|scout_score/);
});

test('history recovery still excludes source self-identity collisions and materializes every other completed effective side',()=>{
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

test('coverage ledger distinguishes source materialization from source freshness',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS mma_fighter_history_coverage/);
  assert.match(migration,/source_reported_completed_bouts/);
  assert.match(migration,/materialized_completed_bouts/);
  assert.match(migration,/materialization_status IN \('complete','gap','no_source_bouts'\)/);
  assert.match(migration,/freshness_status IN \('current','aging','stale','unknown'\)/);
  assert.match(audit,/Complete means every safe completed fighter-side bout reported by the active source snapshot is materialized/);
  assert.match(audit,/Freshness remains an independent requirement/);
  assert.match(audit,/if\(gaps!==0\|\|missing!==0\|\|missingPublicCoverage!==0\|\|remainingEffectiveMissing!==0\)throw new Error/);
});

test('production recovery order proves identity contract before recovery and audits after materialization',()=>{
  const migrate=workflow.indexOf('Apply history identity and coverage schema');
  const resolve=workflow.indexOf('Resolve ambiguous participant identities');
  const deriveStep=workflow.indexOf('Derive source-consistent exact-name history identities');
  const recoverStep=workflow.indexOf('Recover every safe completed fighter-side history row');
  const opponentStep=workflow.indexOf('Backfill newly resolved opponent identities');
  const auditStep=workflow.indexOf('Prove source-reported history materialization and freshness');
  const intel=workflow.indexOf('Refresh fighter intelligence after history repair');
  assert.ok(migrate>=0&&resolve>migrate&&deriveStep>resolve&&recoverStep>deriveStep&&opponentStep>recoverStep&&auditStep>opponentStep&&intel>auditStep);
  assert.match(workflow,/0034_source_name_history_coverage\.sql/);
  assert.match(workflow,/source-name-history\/summary\.json/);
  assert.match(workflow,/fighter-history-coverage\/summary\.json/);
});
