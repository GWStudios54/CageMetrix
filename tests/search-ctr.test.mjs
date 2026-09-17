import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('legacy CageMetrix and alternate MMA Scouts hosts permanently collapse to https non-www before routing',()=>{
  const brand=read('src/brand.ts');
  const canonical=read('src/canonical.ts');
  const entry=read('src/entry.ts');
  const worker=read('src/worker.ts');
  const config=read('wrangler.jsonc');
  assert.match(brand,/CANONICAL_HOST='mmascouts\.com'/);
  assert.match(brand,/cagemetrix\.com/);
  assert.match(canonical,/LEGACY_HOSTS\.has\(host\)/);
  assert.match(canonical,/host===WWW_CANONICAL_HOST/);
  assert.match(canonical,/url\.protocol==='http:'/);
  assert.match(canonical,/url\.pathname==='\/index\.html'/);
  assert.match(canonical,/status:308/);
  assert.match(canonical,/url\.hostname=CANONICAL_HOST/);
  assert.match(entry,/canonicalRedirect\(request\)/);
  assert.match(entry,/stripRetiredPersonalUi\(await worker\.fetch\(request,env,context\)\)/);
  assert.match(worker,/canonicalRedirect\(request\)/);
  assert.match(config,/"main": "src\/entry\.ts"/);
  for(const host of ['mmascouts.com','www.mmascouts.com'])assert.ok(config.includes(`"pattern": "${host}"`),`missing ${host}`);
});

test('fight pages expose click-oriented MMA Scouts matchup metadata and model probability',()=>{
  const source=read('src/seo.ts');
  assert.match(source,/Prediction: \$\{pickName\} \$\{pickPct\}/);
  assert.match(source,/model win probability/);
  assert.match(source,/Compare opponent-adjusted ratings, stats, model edges and reasoning/);
  assert.match(source,/max-snippet:-1/);
  assert.match(source,/rel=\"canonical\"/);
  assert.match(source,/BRAND_NAME/);
  assert.match(source,/SITE_ORIGIN/);
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
