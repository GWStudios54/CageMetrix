import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('model promotion is explicit manual release work, never a workflow-file side effect',()=>{
  const workflow=read('.github/workflows/model-promotion.yml');
  assert.match(workflow,/^on:\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow,/^\s+push:/m);
  assert.match(workflow,/group: cagemetrix-production/);
  assert.match(workflow,/run: npm run data:refresh/);
  assert.match(workflow,/run: npm run forecasts:sync/);
  assert.match(workflow,/run: npm run deploy:worker/);
});

test('generic package metadata changes do not fan out expensive specialized source workflows',()=>{
  for(const path of [
    '.github/workflows/fighter-intel.yml',
    '.github/workflows/global-events.yml',
    '.github/workflows/management-sync.yml',
    '.github/workflows/promotion-location-sync.yml'
  ]){
    const workflow=read(path);
    assert.doesNotMatch(workflow,/['"]package\.json['"]/,path);
  }
});

test('specialized source workflows still trigger from their own evidence code',()=>{
  assert.match(read('.github/workflows/fighter-intel.yml'),/scripts\/sync-fighter-intel\.mjs/);
  assert.match(read('.github/workflows/global-events.yml'),/scripts\/sync-global-events\.mjs/);
  assert.match(read('.github/workflows/management-sync.yml'),/scripts\/sync-management\.mjs/);
  assert.match(read('.github/workflows/promotion-location-sync.yml'),/scripts\/sync-promotion-location\.mjs/);
});

test('contract lane is scoped to contract evidence while full product CI owns shared UI',()=>{
  const workflow=read('.github/workflows/contract-intel-validation.yml');
  for(const path of [
    'src/recruiting.ts','public/recruiting.css','src/management-about.ts',
    'src/talent-admin.ts','public/talent.css','scripts/sync-management.mjs'
  ]) assert.ok(!workflow.includes(path),path);
  for(const path of [
    'src/contract-intel.ts','src/contract-candidates.ts','src/contract-review.ts',
    'scripts/discover-contract-intel.mjs','scripts/lib/contract-intel-discovery.mjs',
    'tests/contract-source-wave2.test.mjs','tests/contract-source-wave3.test.mjs',
    'tests/contract-source-wave4.test.mjs'
  ]) assert.ok(workflow.includes(path),path);
});
