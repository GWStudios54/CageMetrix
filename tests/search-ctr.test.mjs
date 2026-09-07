import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('alternate CageMetrix hosts permanently collapse to https non-www before routing',()=>{
  const source=read('src/search-ctr.ts');
  const entry=read('src/canonical-worker.ts');
  const config=read('wrangler.jsonc');
  assert.match(source,/host==='www\.cagemetrix\.com'/);
  assert.match(source,/host==='cagemetrix\.com'&&url\.protocol==='http:'/);
  assert.match(source,/status:308/);
  assert.match(source,/url\.hostname='cagemetrix\.com'/);
  assert.match(entry,/canonicalRedirect\(request\)/);
  assert.match(config,/"main": "src\/canonical-worker\.ts"/);
});

test('fight pages expose click-oriented matchup metadata without pretending probabilities are odds',()=>{
  const source=read('src/search-ctr.ts');
  assert.match(source,/Prediction: \$\{pickName\} \$\{pickPct\}/);
  assert.match(source,/win probability/);
  assert.match(source,/opponent-adjusted ratings, stats, model edges, crowd picks and reasoning/);
  assert.doesNotMatch(source,/betting odds/);
  assert.match(source,/max-snippet:-1/);
  assert.match(source,/rel=\"canonical\"/);
});

test('fight structured data connects canonical page, matchup, fighters and parent event',()=>{
  const source=read('src/search-ctr.ts');
  assert.match(source,/'@type':'WebSite'/);
  assert.match(source,/'@type':'WebPage'/);
  assert.match(source,/'@type':'SportsEvent'/);
  assert.match(source,/'@type':'BreadcrumbList'/);
  assert.match(source,/superEvent/);
  assert.match(source,/competitor:/);
  assert.match(source,/script\[type=\"application\/ld\+json\"\]/);
});

test('fight SERP enhancement runs after the normal fight SEO layer',()=>{
  const nav=read('src/navigation.ts');
  assert.match(nav,/enhanceFightSearchSnippet/);
  assert.match(nav,/pathname\.match\(\/\^\\\/fights\\\/\(\[1-9\]\\d\*\)/);
});
