import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('MMA Scouts is the public brand and canonical origin',()=>{
  const brand=read('src/brand.ts');
  assert.match(brand,/BRAND_NAME='MMA Scouts'/);
  assert.match(brand,/SITE_ORIGIN='https:\/\/mmascouts\.com'/);
  assert.match(brand,/CANONICAL_HOST='mmascouts\.com'/);
  assert.match(brand,/LEGACY_HOSTS=new Set\(\['cagemetrix\.com','www\.cagemetrix\.com'\]\)/);
});

test('public SEO surfaces use the shared MMA Scouts origin',()=>{
  for(const path of ['src/seo.ts','src/static-seo.ts','src/event-page.ts','src/public-sitemap.ts','src/forum-seo.ts']){
    const source=read(path);
    assert.match(source,/SITE_ORIGIN/,`${path} must use the shared site origin`);
  }
  const robots=read('public/robots.txt');
  const validation=read('public/validation.html');
  assert.match(robots,/https:\/\/mmascouts\.com\/sitemap\.xml/);
  assert.match(validation,/rel="canonical" href="https:\/\/mmascouts\.com\/validation\.html"/);
});

test('migration preserves existing internal model and database identifiers',()=>{
  const config=read('wrangler.jsonc');
  const core=read('src/index.ts');
  const seo=read('src/seo.ts');
  const staticSeo=read('src/static-seo.ts');
  assert.match(config,/"name": "cagemetrix"/);
  assert.match(config,/"database_name": "cagemetrix"/);
  assert.match(core,/CageMetrix Opponent-Adjusted Rating/);
  assert.match(seo,/CageMetrix Opponent-Adjusted Rating/);
  assert.match(staticSeo,/CageMetrix Win Probability/);
});

test('legacy hosts remain attached so every old URL can redirect one-to-one',()=>{
  const config=read('wrangler.jsonc');
  const canonical=read('src/canonical.ts');
  for(const host of ['mmascouts.com','www.mmascouts.com','cagemetrix.com','www.cagemetrix.com'])assert.ok(config.includes(`"pattern": "${host}"`),`missing ${host}`);
  assert.match(canonical,/url\.hostname=CANONICAL_HOST/);
  assert.match(canonical,/status:308/);
  assert.match(canonical,/if\(url\.pathname==='\/index\.html'\)url\.pathname='\/'/);
  assert.doesNotMatch(canonical,/pathname='\/'[^\n]*LEGACY_HOSTS/);
});

test('indexable fighter, fight and event pages emit MMA Scouts canonical metadata',()=>{
  const seo=read('src/seo.ts');
  const events=read('src/event-page.ts');
  assert.match(seo,/link rel=\"canonical\" href=\"\$\{canonical\}\"/);
  assert.match(seo,/out\.headers\.set\('Link',`<\$\{canonical\}>; rel=\"canonical\"`\)/);
  assert.match(events,/Link':`<\$\{canonical\}>; rel=\"canonical\"/);
  assert.match(seo,/MMA SCOUTS FIGHTER PROFILE/);
  assert.match(events,/BRAND_NAME/);
});

test('production deployment includes domain-route changes and verifies the cutover',()=>{
  const deploy=read('.github/workflows/deploy.yml');
  const smoke=read('.github/workflows/post-deploy-smoke.yml');
  assert.match(deploy,/name: Deploy MMA Scouts/);
  assert.doesNotMatch(deploy,/paths-ignore:[\s\S]*- 'wrangler\.jsonc'/);
  assert.match(smoke,/https:\/\/mmascouts\.com/);
  assert.match(smoke,/https:\/\/cagemetrix\.com\/api\/health\?from=legacy/);
  assert.match(smoke,/test "\$code" = "308"/);
  assert.match(smoke,/https:\/\/mmascouts\.com\/\?from=legacy/);
});
