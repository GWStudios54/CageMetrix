import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('recruiting workspace schema is private, durable and opening-scoped',()=>{
  const migration=read('migrations/0038_recruiting_workspace.sql');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS recruiting_openings/);
  assert.match(migration,/owner_account_id INTEGER NOT NULL/);
  assert.match(migration,/FOREIGN KEY\(owner_account_id\) REFERENCES community_accounts\(id\) ON DELETE CASCADE/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS recruiting_opening_candidates/);
  assert.match(migration,/UNIQUE\(opening_id,source_key,source_fighter_id\)/);
  assert.match(migration,/status IN \('suggested','shortlisted','contacted','passed','declined','booked'\)/);
});

test('recruiting APIs are admin-gated, same-origin and use exact fighter identities',()=>{
  const source=read('src/recruiting.ts'),entry=read('src/entry.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/sameOrigin\(request\)/);
  assert.match(source,/source_key=c\.source_key AND p\.source_fighter_id=c\.source_fighter_id/);
  assert.doesNotMatch(source,/fuzzy|levenshtein|similarity/i);
  assert.match(entry,/api\/admin\/recruiting\/openings/);
  assert.match(entry,/recruitingCandidateMatch/);
  assert.match(entry,/recruitingOpeningPage/);
});

test('candidate generation preserves publication controls and evidence standards',()=>{
  const source=read('src/recruiting.ts');
  assert.match(source,/COALESCE\(controls\.public_status,'public'\)='public'/);
  assert.match(source,/r\.model_version=\?/);
  assert.match(source,/COALESCE\(o\.contract_status,'unknown'\)/);
  assert.match(source,/CASE WHEN cm\.source_fighter_id IS NOT NULL THEN 'represented' ELSE COALESCE\(o\.management_status,'unknown'\) END/);
  assert.match(source,/function availabilityExpr\(\)/);
  assert.match(source,/COALESCE\(o\.open_to_fights,'unknown'\)<>'unknown' THEN o\.open_to_fights ELSE COALESCE\(ca\.open_to_fights,'unknown'\)/);
  assert.match(source,/LEFT JOIN scout_current_availability ca/);
  assert.match(source,/availabilityExpr\(\)\+"='yes'"/);
  assert.match(source,/INSERT OR IGNORE INTO recruiting_opening_candidates/);
});

test('recruiting board tracks workflow and exposes intelligence gaps without inventing a signability score',()=>{
  const source=read('src/recruiting.ts');
  for(const gap of ["gaps.push('management')","gaps.push('contract')","gaps.push('base')","gaps.push('contact')","gaps.push('availability')"])assert.ok(source.includes(gap),gap);
  assert.match(source,/Intel gaps/);
  assert.match(source,/These are recruiting-data gaps, not rating penalties/);
  assert.match(source,/suggested','shortlisted','contacted','passed','declined','booked/);
  assert.doesNotMatch(source,/signability|recruitability_score|recruiting_score/i);
});

test('recruiting data never enters Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  assert.doesNotMatch(rating,/recruiting_openings|recruiting_opening_candidates|management_filter|contract_filter|opportunity_filter/);
});

test('production deploy applies all pending migrations and private smoke verifies recruiting access control',()=>{
  const deploy=read('.github/workflows/deploy.yml'),smoke=read('.github/workflows/post-deploy-smoke.yml'),config=read('wrangler.jsonc'),nav=read('src/navigation.ts');
  assert.match(deploy,/npm run db:migrate:remote/);
  assert.match(deploy,/Currently processing a long-running import/);
  assert.match(deploy,/run: npm run deploy:worker/);
  assert.match(config,/"\/recruiting"/);
  assert.match(config,/"\/recruiting\/\*"/);
  assert.match(smoke,/recruiting_code/);
  assert.match(smoke,/Recruiting access required\./);
  assert.match(nav,/admin\?'<a href="\/recruiting" class="admin-link">Recruiting<\/a>/);
});


test('private intelligence queue prioritizes unresolved recruiting facts without inventing a composite score',()=>{
  const source=read('src/recruiting.ts'),entry=read('src/entry.ts');
  assert.match(source,/export async function recruitingIntelQueuePage/);
  assert.match(source,/JOIN scout_public_global_profiles p/);
  assert.match(source,/c\.management_status='unknown'/);
  assert.match(source,/c\.contract_status='unknown'/);
  assert.match(source,/c\.open_to_fights='unknown'/);
  assert.match(source,/c\.public_contact_url IS NULL/);
  assert.match(source,/cm\.agency_contact_value IS NULL/);
  assert.doesNotMatch(source,/cm\.agency_website IS NULL/);
  assert.match(source,/resolved_contact_evidence_url/);
  assert.match(source,/Agency website/);
  assert.match(source,/active\/recent fighters first|date\('now','-18 months'\)/);
  assert.match(source,/no composite recruitability score/i);
  assert.doesNotMatch(source,/intel_priority_score|recruitability_score|signability/i);
  assert.match(entry,/recruitingIntelQueuePage/);
  assert.match(entry,/path==='\/recruiting\/intel'/);
});


test('recruiting candidates and the intel queue surface finish rate, title experience and recent form',()=>{
  const source=read('src/recruiting.ts');
  assert.match(source,/function fightProfileFacts\(row:Row\)/);
  assert.match(source,/finish rate \(\$\{ko\} KO\/TKO · \$\{sub\} SUB\)/);
  assert.match(source,/Title fights: \$\{Number\(row\.title_fight_wins\|\|0\)\}/);
  assert.match(source,/p\.ko_tko_wins,p\.submission_wins,p\.title_fight_bouts,p\.title_fight_wins,p\.last_five_wins,p\.last_five_losses/);
  assert.match(source,/\$\{fightProfileFacts\(row\)\}<\/div>/);
});

test('recruiting candidates and the intel queue surface finish speed and durability alongside finish rate',()=>{
  const source=read('src/recruiting.ts');
  assert.match(source,/p\.finish_round_sum,p\.first_round_finishes,p\.times_finished,/g);
  assert.match(source,/Avg finish round \$\{\(Number\(row\.finish_round_sum\|\|0\)\/finishes\)\.toFixed\(1\)\}/);
  assert.match(source,/if\(timesFinished>0\)facts\.push\(`Finished \$\{timesFinished\}x`\);/);
  assert.match(source,/else if\(bouts>=3\)facts\.push\('Never finished'\);/);
});

test('private recruiting workspace links the contract review desk without exposing it publicly',()=>{
  const recruiting=read('src/recruiting.ts'),review=read('src/contract-review.ts'),smoke=read('.github/workflows/post-deploy-smoke.yml');
  assert.match(recruiting,/href="\/recruiting\/contracts">Review contract leads/);
  assert.match(review,/noindex,nofollow/);
  assert.match(review,/adminAccount\(request,env\.DB\)/);
  assert.match(smoke,/contract_review_code/);
  assert.match(smoke,/Contract review access required\./);
});
