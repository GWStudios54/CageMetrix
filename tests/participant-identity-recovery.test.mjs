import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('migrations/0032_participant_identity_resolutions.sql','utf8');
const resolver=fs.readFileSync('scripts/resolve-participant-identities.mjs','utf8');
const recovery=fs.readFileSync('scripts/recover-global-fight-history.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/fight-history-recovery.yml','utf8');

test('identity resolutions are an auditable overlay and never mutate the immutable source participant id',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS mma_participant_identity_resolutions/);
  assert.match(migration,/manual_verified/);
  assert.match(migration,/confidence REAL NOT NULL/);
  assert.match(migration,/evidence_json TEXT NOT NULL/);
  assert.match(migration,/CREATE VIEW mma_effective_participants/);
  assert.match(migration,/COALESCE\(p\.source_fighter_id,r\.resolved_source_fighter_id\)/);
  assert.doesNotMatch(resolver,/UPDATE mma_fight_participants|UPDATE mma_active_participants|SET source_fighter_id/);
});

test('automatic resolution requires exact normalized name plus strong independent biography evidence',()=>{
  assert.match(resolver,/JOIN mma_fighters f/);
  assert.match(resolver,/f\.source_key=u\.source_key AND f\.snapshot_id=u\.snapshot_id AND f\.normalized_name=u\.normalized_name/);
  assert.match(resolver,/dob_match/);
  assert.match(resolver,/gym_match/);
  assert.match(resolver,/nationality_match/);
  assert.match(resolver,/height_match/);
  assert.match(resolver,/reach_match/);
  assert.match(resolver,/stance_match/);
  assert.match(resolver,/score>=7/);
  assert.match(resolver,/dob_match=1 OR evidence_dimensions>=2/);
  assert.match(resolver,/score-second_score>=3/);
  assert.doesNotMatch(resolver,/levenshtein\s*\(|soundex\s*\(|jaro[_a-z]*\s*\(|fuzzy[_a-z]*\s*\(/i);
});

test('resolver bounds expensive identity work to rowid batches for D1',()=>{
  assert.match(resolver,/const BATCH_ROWS=5000/);
  assert.match(resolver,/SELECT MIN\(p\.rowid\) min_rowid,MAX\(p\.rowid\) max_rowid/);
  assert.match(resolver,/for\(let lo=minRow;lo&&lo<=maxRow;lo\+=BATCH_ROWS\)/);
  assert.ok((resolver.match(/p\.rowid BETWEEN \$\{lo\} AND \$\{hi\}/g)||[]).length>=3);
  assert.match(resolver,/batches_processed:batches/);
});

test('accepted identities can propagate only hard same-name biography fingerprints',()=>{
  assert.match(resolver,/const MAX_FINGERPRINT_PASSES=4/);
  assert.match(resolver,/seed_rows AS/);
  assert.match(resolver,/s\.normalized_name=u\.normalized_name/);
  assert.match(resolver,/resolved_history_fingerprint/);
  assert.match(resolver,/dob_conflict=0 AND height_conflict=0 AND reach_conflict=0/);
  assert.match(resolver,/score>=8/);
  assert.match(resolver,/score-second_score>=4/);
  assert.match(resolver,/if\(added===0\)break/);
  assert.match(resolver,/fingerprint_added:fingerprintAdded/);
  assert.doesNotMatch(resolver,/global_rating|scout_score|elo|promotion_prestige/i);
});

test('remaining history holes are classified by fighter-master candidate count',()=>{
  assert.match(resolver,/const backlogByName=new Map/);
  assert.match(resolver,/master_candidates/);
  assert.match(resolver,/no_master_candidate:category/);
  assert.match(resolver,/single_master_candidate_anomaly:category/);
  assert.match(resolver,/ambiguous_master_candidates:category/);
  assert.match(resolver,/top_completed_history_holes/);
  assert.match(resolver,/known_opponent_sides/);
  assert.match(resolver,/sides_with_2plus_bio_dimensions/);
});

test('manual verified resolutions survive auto rebuilds and self-opponent collisions are excluded',()=>{
  assert.match(resolver,/DELETE FROM mma_participant_identity_resolutions/);
  assert.match(resolver,/match_method IN \('global_builder_existing','metadata_auto'\)/);
  assert.doesNotMatch(resolver,/match_method IN \([^\n]*manual_verified/);
  assert.match(resolver,/f\.source_fighter_id<>u\.opponent_id/);
  assert.match(resolver,/s\.resolved_source_fighter_id<>u\.opponent_id/);
  assert.match(recovery,/o\.effective_source_fighter_id<>p\.effective_source_fighter_id/);
});

test('history recovery consumes the effective identity overlay but still leaves ratings untouched',()=>{
  assert.match(recovery,/FROM mma_effective_participants p/);
  assert.match(recovery,/p\.effective_source_fighter_id/);
  assert.match(recovery,/o\.effective_source_fighter_id/);
  assert.doesNotMatch(recovery,/UPDATE scout_global_ratings|INSERT .*scout_global_ratings|DELETE FROM scout_global_ratings/);
});

test('production workflow applies schema, resolves identities, then repairs histories',()=>{
  const migrate=workflow.indexOf('Apply identity-resolution schema');
  const resolve=workflow.indexOf('Resolve ambiguous participant identities');
  const recover=workflow.indexOf('Recover completed fighter-side history rows');
  assert.ok(migrate>=0&&resolve>migrate&&recover>resolve);
  assert.match(workflow,/resolve-participant-identities\.mjs --remote/);
  assert.match(workflow,/participant-identity-recovery\.test\.mjs/);
  assert.match(workflow,/participant-identity\/summary\.json/);
});
