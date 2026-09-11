import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('worker-only deploy command does not perform D1 refresh work',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['deploy:worker'],'wrangler deploy');
  assert.equal(pkg.scripts.deploy,'node scripts/build.mjs && wrangler deploy');
});

test('generic production deploy no longer duplicates full data refresh or PR-closed deploys',()=>{
  const workflow=read('.github/workflows/deploy.yml');
  assert.doesNotMatch(workflow,/\bpull_request:/);
  assert.match(workflow,/run: npm run deploy:worker/);
  assert.doesNotMatch(workflow,/run: npm run deploy(?:\s|$)/m);
  assert.doesNotMatch(workflow,/refresh-data\.mjs|sync-forecasts\.mjs|scripts\/build\.mjs/);
  assert.match(workflow,/npm run db:migrate:remote/);
  assert.match(workflow,/Currently processing a long-running import/);
  assert.match(workflow,/retrying migration apply in 15 seconds/);
  assert.match(workflow,/attempt \$attempt\/8/);
});

test('media refresh deploys only changed Worker assets without refreshing D1 ratings',()=>{
  const workflow=read('.github/workflows/fighter-media.yml');
  assert.match(workflow,/run: npm run deploy:worker/);
  assert.doesNotMatch(workflow,/run: npm run deploy(?:\s|$)/m);
});

test('model promotion retains ordered data writes then performs lightweight Worker cutover',()=>{
  const workflow=read('.github/workflows/model-promotion.yml');
  const refresh=workflow.indexOf('run: npm run data:refresh');
  const forecasts=workflow.indexOf('run: npm run forecasts:sync');
  const deploy=workflow.indexOf('run: npm run deploy:worker');
  assert.ok(refresh>=0&&forecasts>refresh&&deploy>forecasts);
  assert.doesNotMatch(workflow,/run: npm run deploy(?:\s|$)/m);
});

test('generic deploy still keeps production concurrency guard',()=>{
  const workflow=read('.github/workflows/deploy.yml');
  assert.match(workflow,/group: cagemetrix-production/);
  assert.match(workflow,/cancel-in-progress: false/);
});
