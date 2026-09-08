import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('Scout Score is separate from Global Rating and evidence confidence',()=>{
  const migration=read('migrations/0029_scout_score.sql');
  assert.match(migration,/CREATE VIEW scout_active_prospect_scores/);
  assert.match(migration,/r\.scout_rating AS global_rating/);
  assert.match(migration,/0\.35\*global_component/);
  assert.match(migration,/0\.25\*age_component/);
  assert.match(migration,/0\.20\*trajectory_component/);
  assert.match(migration,/0\.10\*expectation_component/);
  assert.match(migration,/0\.10\*activity_component/);
  assert.match(migration,/PERCENT_RANK\(\) OVER \(ORDER BY raw_scout_signal\)/);
  assert.match(migration,/r\.evidence_strength/);
  const signal=migration.match(/0\.35\*global_component[\s\S]*?AS raw_scout_signal/)?.[0]||'';
  assert.doesNotMatch(signal,/evidence_strength/);
});

test('Scout Score eligibility requires real pro evidence and recent activity',()=>{
  const migration=read('migrations/0029_scout_score.sql');
  assert.match(migration,/p\.career_bouts>=3/);
  assert.match(migration,/p\.last_fight_date>=date\('now','-1095 day'\)/);
  assert.match(migration,/CASE WHEN age IS NULL THEN 0 ELSE 1 END AS age_known/);
});

test('Scout Score is not influenced by management or promotion prestige',()=>{
  const migration=read('migrations/0029_scout_score.sql');
  assert.doesNotMatch(migration,/management_agencies|fighter_management_history|agency_id/);
  assert.doesNotMatch(migration,/promotion_bonus|promotion_multiplier|prestige/i);
});

test('Scout Score board, API and fighter dossier are routed publicly',()=>{
  const entry=read('src/entry.ts'),source=read('src/scout-score.ts'),nav=read('src/navigation.ts');
  assert.match(entry,/path==='\/api\/prospects'/);
  assert.match(entry,/path==='\/prospects'/);
  assert.match(entry,/enhanceFighterScoutScore/);
  assert.match(entry,/enhancePromotionScoutScores/);
  assert.match(nav,/href="\/prospects">Prospects/);
  assert.match(source,/Global Rating ≠ Scout Score/);
  assert.match(source,/Evidence stays separate/);
  assert.match(source,/Management, promotion prestige and evidence confidence add zero points/);
});
