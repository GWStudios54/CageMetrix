import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('amateur-record discovery schema adds a candidates queue and a per-fighter lookup-tracking table alongside the existing manual-entry tables',()=>{
  const migration=read('migrations/0049_amateur_record_wikipedia_discovery.sql');
  for(const table of ['amateur_record_intel_candidates','amateur_record_wikipedia_lookups'])assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration,/review_status IN \('pending','accepted','rejected','duplicate','needs_identity'\)/);
  assert.match(migration,/identity_basis IN \(\s*'birth_date_exact_match','no_independent_fact_on_file','unverified'\s*\)/);
  const existing=read('migrations/0046_amateur_record_intelligence.sql');
  assert.match(existing,/CREATE TABLE IF NOT EXISTS fighter_amateur_record\b/);
});

test('amateur-record candidates queue requires auth and never lets a candidate touch fighter_amateur_record directly',()=>{
  const source=read('src/amateur-record-candidates.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/sameOrigin\(request\)/);
  assert.doesNotMatch(source,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_amateur_record\b/i);
});

test('amateur-record review page requires auth, never auto-publishes, and republishes through the existing setAmateurRecordApi endpoint rather than a new write path',()=>{
  const source=read('src/amateur-record-review.ts');
  assert.match(source,/adminAccount\(request,env\.DB\)/);
  assert.match(source,/Nothing is auto-published/);
  assert.match(source,/Detection is a private lead, not a fact/);
  assert.match(source,/api\('\/api\/admin\/talent\/amateur-record',/);
});

test('amateur-record candidates/review routes are wired into entry.ts',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/from '\.\/amateur-record-candidates\.ts'/);
  assert.match(entry,/from '\.\/amateur-record-review\.ts'/);
  assert.match(entry,/path==='\/api\/admin\/talent\/amateur-record\/candidates'/);
  assert.match(entry,/path==='\/recruiting\/amateur-records'\|\|path==='\/recruiting\/amateur-records\/'/);
  assert.match(entry,/amateurRecordReviewPage\(request,env\)/);
});

test('a name match on Wikipedia is never accepted as pending without independent corroboration',()=>{
  const source=read('scripts/lib/amateur-record-intel-discovery.mjs');
  assert.match(source,/reviewStatus:basis==='birth_date_exact_match'\?'pending':'needs_identity'/);
  assert.match(source,/if\(basis==='mismatch'\)return null;/);
});

test('discovery batches a bounded number of fighters per run and tracks lookups so the batch rotates through the roster instead of re-checking the same names forever',()=>{
  const discovery=read('scripts/discover-amateur-record-intel.mjs');
  assert.match(discovery,/LIMIT \$\{batchSize\}/);
  assert.match(discovery,/INSERT INTO amateur_record_wikipedia_lookups/);
  assert.match(discovery,/ORDER BY COALESCE\(l\.checked_at,'0000-00-00'\) ASC/);
  assert.match(discovery,/INSERT OR IGNORE INTO amateur_record_intel_candidates/);
  assert.doesNotMatch(discovery,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_amateur_record\b/i);
});

test('amateur-record discovery runs weekly against production, not daily, and only ever queues candidates',()=>{
  const workflow=read('.github/workflows/amateur-record-intel-discovery.yml');
  assert.match(workflow,/schedule:\n(\s*#.*\n)+\s*- cron: '0 13 \* \* 1'/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/npx wrangler d1 migrations apply cagemetrix --remote/);
  assert.match(workflow,/node scripts\/discover-amateur-record-intel\.mjs --remote/);
  assert.match(workflow,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
});

test('the amateur-record review page is cross-linked with the other four review queues',()=>{
  for(const path of ['src/camp-review.ts','src/injury-review.ts','src/antidoping-review.ts','src/coach-review.ts']){
    assert.match(read(path),/href=\\"\/recruiting\/amateur-records\\"/,`${path} should link to the amateur-record review queue`);
  }
  const hub=read('src/recruiting.ts');
  assert.match(hub,/href="\/recruiting\/amateur-records"/);
});

test('amateur-record intelligence never feeds Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  for(const forbidden of ['fighter_amateur_record','amateur_record_intel_candidates','amateur_record_wikipedia_lookups'])assert.doesNotMatch(rating,new RegExp(forbidden));
});
