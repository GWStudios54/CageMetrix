import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('alternate CageMetrix hosts permanently collapse to https non-www before routing',()=>{
  const canonical=read('src/canonical.ts');
  const worker=read('src/worker.ts');
  const config=read('wrangler.jsonc');
  assert.match(canonical,/www\.\$\{CANONICAL_HOST\}/);
  assert.match(canonical,/url\.protocol==='http:'/);
  assert.match(canonical,/status:308/);
  assert.match(canonical,/url\.hostname=CANONICAL_HOST/);
  assert.match(worker,/canonicalRedirect\(request\)/);
  assert.match(config,/"main": "src\/worker\.ts"/);
});

test('fight pages expose click-oriented matchup metadata and model probability',()=>{
  const source=read('src/seo.ts');
  assert.match(source,/Prediction: \$\{pickName\} \$\{pickPct\}/);
  assert.match(source,/win probability/);
  assert.match(source,/opponent-adjusted ratings, stats, model edges, crowd picks and reasoning/);
  assert.match(source,/max-snippet:-1/);
  assert.match(source,/rel=\"canonical\"/);
});

test('fight structured data connects canonical page, matchup, fighters and parent event',()=>{
  const source=read('src/seo.ts');
  assert.match(source,/'@type':'WebSite'/);
  assert.match(source,/'@type':'WebPage'/);
  assert.match(source,/'@type':'SportsEvent'/);
  assert.match(source,/'@type':'BreadcrumbList'/);
  assert.match(source,/superEvent/);
  assert.match(source,/competitor:/);
});

test('fight SEO is applied explicitly in the fight route, not hidden in navigation',()=>{
  const worker=read('src/worker.ts');
  const nav=read('src/navigation.ts');
  assert.match(worker,/enhanceFightPage\(response,env,fightPath\[1\]\)/);
  assert.doesNotMatch(nav,/enhanceFightPage|canonicalRedirect|search-ctr/);
});
