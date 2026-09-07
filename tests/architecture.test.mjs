import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('runtime responsibilities stay in their owning modules',()=>{
  const worker=read('src/worker.ts');
  const nav=read('src/navigation.ts');
  const seo=read('src/seo.ts');
  const sitemap=read('src/public-sitemap.ts');
  const config=read('wrangler.jsonc');

  assert.match(config,/"main": "src\/worker\.ts"/);
  assert.match(worker,/canonicalRedirect\(request\)/);
  assert.match(worker,/enhanceFightPage/);
  assert.doesNotMatch(nav,/canonicalRedirect|enhanceFightPage|search-ctr/);
  assert.doesNotMatch(sitemap,/from ['"]\.\/seo\.ts['"]/);
  assert.doesNotMatch(seo,/export async function sitemap|export async function eventPage/);
});

test('superseded wrapper and v2 modules stay deleted',()=>{
  assert.equal(fs.existsSync('src/canonical-worker.ts'),false);
  assert.equal(fs.existsSync('src/search-ctr.ts'),false);
  assert.equal(fs.existsSync('src/admin-v2.ts'),false);
});

test('admin session hashing and role lookup have one shared implementation',()=>{
  const admin=read('src/admin.ts');
  const auth=read('src/admin-auth.ts');
  const nav=read('src/navigation.ts');
  const session=read('src/admin-session.ts');
  assert.match(admin,/from '.\/admin-session\.ts'/);
  assert.match(auth,/from '.\/admin-session\.ts'/);
  assert.match(nav,/from '.\/admin-session\.ts'/);
  assert.match(session,/sha256Hex/);
  assert.match(session,/a\.role='admin'/);
  assert.doesNotMatch(admin,/crypto\.subtle\.digest/);
  assert.doesNotMatch(auth,/crypto\.subtle\.digest/);
  assert.doesNotMatch(nav,/crypto\.subtle\.digest/);
});
