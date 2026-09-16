import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('coach schema separates history, evidence and discovery candidates, and allows a verified_profile bypass unlike anti-doping',()=>{
  const migration=read('migrations/0048_coach_intelligence.sql');
  for(const table of ['fighter_coach_history','fighter_coach_evidence','coach_intel_candidates'])assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration,/CREATE VIEW scout_current_coach/);
  assert.match(migration,/review_status IN \('pending','accepted','rejected','duplicate','needs_identity'\)/);
  assert.match(migration,/CHECK \(source_url IS NOT NULL OR source_type='verified_profile'\)/);
  assert.match(migration,/detected_event_type IN \('hired','parted_ways'\)/);
});

test('coach admin API requires auth, same-origin, a coach name, and either a source URL or verified_profile',()=>{
  const source=read('src/coach-admin.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/sameOrigin\(request\)/);
  assert.match(source,/sourceType!=='verified_profile'/);
  assert.match(source,/coach_name_required/);
});

test('coach candidates queue requires auth and never lets a candidate touch fighter_coach_history directly',()=>{
  const source=read('src/coach-candidates.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/sameOrigin\(request\)/);
  assert.doesNotMatch(source,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_coach_history/i);
});

test('coach review page requires auth and never auto-publishes a candidate',()=>{
  const source=read('src/coach-review.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/Nothing is auto-published/);
  assert.match(source,/Detection is a private lead, not a fact/);
});

test('coach admin/review/candidates routes are wired into entry.ts',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/from '\.\/coach-admin\.ts'/);
  assert.match(entry,/from '\.\/coach-candidates\.ts'/);
  assert.match(entry,/from '\.\/coach-review\.ts'/);
  assert.match(entry,/path==='\/api\/admin\/talent\/coaches'/);
  assert.match(entry,/path==='\/api\/admin\/talent\/coaches\/candidates'/);
  assert.match(entry,/path==='\/recruiting\/coaches'\|\|path==='\/recruiting\/coaches\/'/);
  assert.match(entry,/coachReviewPage\(request,env\)/);
});

test('coach context always renders (with a neutral empty state), unlike anti-doping\'s omit-if-none rule, and anchors on the always-present camp section',()=>{
  const source=read('src/coach-intel-context.ts');
  assert.match(source,/export async function enhanceFighterCoachContext/);
  assert.doesNotMatch(source,/if\(!data\|\|!data\.coaches\.length\)return response;/);
  assert.match(source,/No publicly verified head coach/);
  assert.match(source,/on\('\.camp-intelligence',\{element\(el\)\{el\.after\(section,\{html:true\}\);\}\}\)/);
  assert.match(source,/class="contract-intelligence coach-intelligence"/);
});

test('coach context is wired into the fighter dossier chain after camp, injury, amateur record and anti-doping',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/enhanceFighterCoachContext\(dossier,env,fighterPageMatch\[1\]\)/);
  const campIdx=entry.indexOf('enhanceFighterCampContext(dossier');
  const coachIdx=entry.indexOf('enhanceFighterCoachContext(dossier');
  assert.ok(campIdx>-1&&coachIdx>-1&&campIdx<coachIdx,'coach context must be wired after camp context');
  // Coach is called last among the .camp-intelligence-anchored sections so it renders immediately
  // after camp, ahead of injury/amateur-record/antidoping (same-anchor stacking: last called ends
  // up closest to the anchor).
  const injuryIdx=entry.indexOf('enhanceFighterInjuryContext(dossier');
  assert.ok(injuryIdx>-1&&injuryIdx<coachIdx,'coach context must be called after injury context to render closer to camp');
});

test('coach events are folded into the unified market-activity feed (admin and public /wire) with their own filter kind',()=>{
  const activity=read('src/recruiting-activity.ts');
  assert.match(activity,/KIND=new Set\(\['all','availability','contract','representation','camp','coach','antidoping','injury'\]\)/);
  assert.match(activity,/FROM fighter_coach_history h/);
  assert.match(activity,/row\.kind==='coach'/);
  const wire=read('src/public-activity.ts');
  assert.match(wire,/coach:'Coach changes'/);
});

test('coach intelligence never feeds Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  for(const forbidden of ['fighter_coach_history','fighter_coach_evidence','coach_intel_candidates'])assert.doesNotMatch(rating,new RegExp(forbidden));
});
