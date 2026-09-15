import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('market activity feed is admin-gated and routed like the rest of the private recruiting workspace',()=>{
  const source=read('src/recruiting-activity.ts'),entry=read('src/entry.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/Recruiting access required\./);
  assert.match(source,/noindex,nofollow/);
  assert.match(entry,/recruitingActivityPage/);
  assert.match(entry,/path==='\/recruiting\/activity'/);
});

test('activity feed merges contract events, representation history, camp history and anti-doping events from already-verified public evidence, not discovery candidates',()=>{
  const source=read('src/recruiting-activity.ts');
  assert.match(source,/FROM fighter_contract_events e/);
  assert.match(source,/FROM fighter_management_history h/);
  assert.match(source,/FROM fighter_camp_history h/);
  assert.match(source,/FROM fighter_antidoping_events e/);
  assert.doesNotMatch(source,/contract_intel_candidates/);
  assert.doesNotMatch(source,/camp_intel_candidates/);
  assert.doesNotMatch(source,/antidoping_intel_candidates/);
  assert.match(source,/JOIN scout_public_global_profiles p/g);
  assert.match(source,/rows\.sort\(\(a,b\)=>String\(b\.event_date\|\|''\)\.localeCompare\(String\(a\.event_date\|\|''\)\)\)/);
});

test('representation and camp events both date by when the relationship actually changed, not when it originally started',()=>{
  const source=read('src/recruiting-activity.ts');
  const occurrences=source.match(/CASE WHEN h\.is_current=1 THEN COALESCE\(h\.started_at,h\.verified_at\) ELSE COALESCE\(h\.ended_at,h\.verified_at\) END event_date/g)||[];
  assert.equal(occurrences.length,2);
});

test('the camp and antidoping filters are mutually exclusive with contract/representation/each other',()=>{
  const source=read('src/recruiting-activity.ts');
  assert.match(source,/kind==='representation'\|\|kind==='camp'\|\|kind==='antidoping'\?Promise\.resolve/);
  assert.match(source,/kind==='availability'\|\|kind==='contract'\|\|kind==='camp'\|\|kind==='antidoping'\?Promise\.resolve/);
  assert.match(source,/kind==='availability'\|\|kind==='contract'\|\|kind==='representation'\|\|kind==='antidoping'\?Promise\.resolve/);
  assert.match(source,/kind==='availability'\|\|kind==='contract'\|\|kind==='representation'\|\|kind==='camp'\?Promise\.resolve/);
  assert.match(source,/KIND=new Set\(\['all','availability','contract','representation','camp','antidoping'\]\)/);
});

test('camp activity rows show a resolved camp name and join/leave framing',()=>{
  const source=read('src/recruiting-activity.ts');
  assert.match(source,/row\.camp_name_resolved\|\|row\.camp_name\|\|'Training camp'/);
  assert.match(source,/`Joined \$\{campName\}`:`Left \$\{campName\}`/);
});

test('anti-doping activity rows never use the "positive" (good-news) badge styling for flagged/positive-test/suspended events',()=>{
  const source=read('src/recruiting-activity.ts');
  assert.match(source,/const good=row\.event_type==='cleared'\|\|row\.event_type==='reinstated'/);
  assert.match(source,/talent-badge\$\{good\?' positive':''\}/);
});

test('anti-doping candidates are never auto-published: the review queue and publish API both require a source URL and human review',()=>{
  const candidates=read('src/antidoping-candidates.ts'),admin=read('src/antidoping-admin.ts');
  assert.match(candidates,/adminAccount\(request,env\.DB\)/);
  assert.match(admin,/sourceUrl\)return json\(\{error:'source_required'\}/);
  assert.match(admin,/publicSummary\)return json\(\{error:'public_summary_required'\}/);
});

test('availability filter only shows events that actually free up a fighter',()=>{
  const source=read('src/recruiting-activity.ts');
  assert.match(source,/AVAILABILITY_EVENTS=new Set\(\['free_agency','release','expiration'\]\)/);
  assert.match(source,/WHERE e\.event_type IN \('free_agency','release','expiration'\)/);
});

test('activity rows can be watched directly from the feed',()=>{
  const source=read('src/recruiting-activity.ts');
  assert.match(source,/data-watch="\$\{esc\(row\.profile_slug\)\}"/);
  assert.match(source,/fetch\('\/api\/admin\/recruiting\/watchlist'/);
});

test('recruiting board links to the market activity feed',()=>{
  const recruiting=read('src/recruiting.ts');
  assert.match(recruiting,/href="\/recruiting\/activity">Market activity/);
});

test('post-deploy smoke verifies the market activity feed is private like the rest of the recruiting workspace',()=>{
  const smoke=read('.github/workflows/post-deploy-smoke.yml');
  assert.match(smoke,/activity_code/);
  assert.match(smoke,/mmascouts\.com\/recruiting\/activity/);
  assert.match(smoke,/test "\$activity_code" = "403"/);
});
