import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('injury schema separates events, evidence and discovery candidates, and allows a verified_profile bypass unlike anti-doping',()=>{
  const migration=read('migrations/0047_injury_availability_intelligence.sql');
  for(const table of ['fighter_injury_events','fighter_injury_evidence','injury_intel_candidates'])assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration,/CREATE VIEW scout_current_injury_status/);
  assert.match(migration,/review_status IN \('pending','accepted','rejected','duplicate','needs_identity'\)/);
  assert.match(migration,/CHECK \(source_url IS NOT NULL OR source_type='verified_profile'\)/);
  assert.match(migration,/event_type IN \(\s*'withdrawal','injury_disclosed','cleared_to_compete','replacement_announced'/);
});

test('injury admin API requires auth, same-origin, a public summary, and either a source URL or verified_profile',()=>{
  const source=read('src/injury-admin.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/sameOrigin\(request\)/);
  assert.match(source,/sourceType!=='verified_profile'/);
  assert.match(source,/public_summary_required/);
});

test('injury candidates queue requires auth and never lets a candidate touch fighter_injury_events directly',()=>{
  const source=read('src/injury-candidates.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/sameOrigin\(request\)/);
  assert.doesNotMatch(source,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_injury_events/i);
});

test('injury review page requires auth and never auto-publishes a candidate',()=>{
  const source=read('src/injury-review.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/Nothing is auto-published/);
  assert.match(source,/Detection is a private lead, not a fact/);
});

test('injury admin/review/candidates routes are wired into entry.ts',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/from '\.\/injury-admin\.ts'/);
  assert.match(entry,/from '\.\/injury-candidates\.ts'/);
  assert.match(entry,/from '\.\/injury-review\.ts'/);
  assert.match(entry,/path==='\/api\/admin\/talent\/injuries'/);
  assert.match(entry,/path==='\/api\/admin\/talent\/injuries\/candidates'/);
  assert.match(entry,/path==='\/recruiting\/injuries'\|\|path==='\/recruiting\/injuries\/'/);
  assert.match(entry,/injuryReviewPage\(request,env\)/);
});

test('injury context always renders (with a neutral empty state), unlike anti-doping\'s omit-if-none rule, and anchors on the always-present camp section',()=>{
  const source=read('src/injury-intel-context.ts');
  assert.match(source,/export async function enhanceFighterInjuryContext/);
  assert.doesNotMatch(source,/if\(!data\|\|!data\.events\.length\)return response;/);
  assert.match(source,/No publicly reported injury or withdrawal history/);
  assert.match(source,/on\('\.camp-intelligence',\{element\(el\)\{el\.after\(section,\{html:true\}\);\}\}\)/);
  assert.match(source,/class="contract-intelligence injury-intelligence"/);
});

test('injury context is wired into the fighter dossier chain after camp',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/enhanceFighterInjuryContext\(dossier,env,fighterPageMatch\[1\]\)/);
  const campIdx=entry.indexOf('enhanceFighterCampContext(dossier');
  const injuryIdx=entry.indexOf('enhanceFighterInjuryContext(dossier');
  assert.ok(campIdx>-1&&injuryIdx>-1&&campIdx<injuryIdx,'injury context must be wired after camp context');
});

test('injury events are folded into the unified market-activity feed (admin and public /wire) with their own filter kind',()=>{
  const activity=read('src/recruiting-activity.ts');
  assert.match(activity,/KIND=new Set\(\['all','availability','contract','representation','camp','coach','antidoping','injury'\]\)/);
  assert.match(activity,/FROM fighter_injury_events e/);
  assert.match(activity,/row\.kind==='injury'/);
  const wire=read('src/public-activity.ts');
  assert.match(wire,/injury:'Injury & availability'/);
});

test('injury/availability intelligence never feeds Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  for(const forbidden of ['fighter_injury_events','fighter_injury_evidence','injury_intel_candidates'])assert.doesNotMatch(rating,new RegExp(forbidden));
});
