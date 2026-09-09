import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('global scouting routes are isolated ahead of the legacy Worker',()=>{
  const entry=read('src/entry.ts'),config=read('wrangler.jsonc');
  assert.match(config,/"main": "src\/entry\.ts"/);
  assert.match(config,/"\/promotions\/\*"/);
  assert.match(config,/"\/scout\/\*"/);
  assert.match(entry,/canonicalRedirect\(request\)/);
  assert.match(entry,/\/api\/promotions/);
  assert.match(entry,/\/api\/scout\/fighters/);
  assert.match(entry,/\/promotions/);
  assert.match(entry,/\/scout\/fighters/);
  assert.match(entry,/stripRetiredPersonalUi\(await worker\.fetch\(request,env,context\)\)/);
});

test('promotion rosters and global dossiers use the publication-safe materialized global model',()=>{
  const source=read('src/global-scout.ts');
  assert.match(source,/GLOBAL_MODEL='global-1\.0\.0'/);
  assert.match(source,/scout_public_global_profiles/);
  assert.match(source,/scout_active_global_ratings/);
  assert.match(source,/scout_active_global_fights/);
  assert.match(source,/opponent_pre_elo/);
  assert.match(source,/Résumé anchors/);
  assert.match(source,/A logo does not add points/);
  assert.doesNotMatch(source,/career_finishes/);
  assert.doesNotMatch(source,/mma_active_participants/);
});

test('regional directory stays first-class while the crawl surface exposes the broader useful global fighter set',()=>{
  const nav=read('src/navigation.ts'),sitemap=read('src/public-sitemap.ts');
  assert.match(nav,/href="\/promotions">Promotions/);
  assert.match(sitemap,/\$\{SITE\}\/promotions/);
  assert.match(sitemap,/scout\/fighters/);
  assert.match(sitemap,/FROM scout_public_global_profiles p/);
  assert.match(sitemap,/p\.career_bouts>=1/);
  assert.match(sitemap,/p\.data_completeness>=35/);
  assert.doesNotMatch(sitemap,/p\.current_promotion_slug IS NOT NULL/);
  assert.doesNotMatch(sitemap,/r\.evidence_strength>=40/);
});

test('regional roster presentation does not invent zeroes or mislabel roster activity',()=>{
  const source=read('src/global-scout.ts');
  assert.match(source,/value===null\|\|value===undefined\|\|value===''/);
  assert.match(source,/searchParams\.set\('limit','250'\)/);
  assert.match(source,/indexed fighters/);
  assert.doesNotMatch(source,/active\/recent/);
  assert.doesNotMatch(source,/recently active indexed fighters/);
  assert.match(source,/const factRows:\[string,unknown\]\[\]/);
});

test('regional directory has dedicated responsive presentation',()=>{
  const css=read('public/scout-directory.css');
  assert.match(css,/directory-promo-grid/);
  assert.match(css,/directory-fighter-row/);
  assert.match(css,/dossier-component-grid/);
  assert.match(css,/@media\(max-width:760px\)/);
});
