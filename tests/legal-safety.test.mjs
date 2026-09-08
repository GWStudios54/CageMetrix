import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('privacy migration creates verified fighter-removal and publication controls',()=>{
  const sql=read('migrations/0031_privacy_publication_controls.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_profile_removal_requests/);
  assert.match(sql,/requester_role IN \('fighter','authorized_representative'\)/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_publication_controls/);
  assert.match(sql,/public_status IN \('public','removed'\)/);
  assert.match(sql,/CREATE VIEW scout_public_global_profiles/);
  assert.match(sql,/COALESCE\(c\.public_status,'public'\)='public'/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS intel_source_access_controls/);
});

test('database guardrails reject direct private contact and residential address intelligence',()=>{
  const sql=read('migrations/0031_privacy_publication_controls.sql');
  assert.match(sql,/private contact data is not allowed in fighter intelligence/);
  assert.match(sql,/NEW\.value_text NOT LIKE 'https:\/\/%'/);
  for(const word of ['phone','email','address','private','personal'])assert.ok(sql.includes(`LIKE '%${word}%'`),`missing contact guard ${word}`);
  assert.match(sql,/street, home, residence, and exact-location data are not allowed/);
  for(const word of ['address','street','home','exact','residence'])assert.ok(sql.includes(`LIKE '%${word}%'`),`missing location guard ${word}`);
  assert.match(sql,/professional contact must be an https URL/);
});

test('public policy promises professional sourcing without publishing private numbers or addresses',()=>{
  const source=read('src/legal-safety.ts');
  assert.match(source,/Phone numbers/);
  assert.match(source,/Street addresses, home addresses or exact residential locations/);
  assert.match(source,/private email addresses/i);
  assert.match(source,/bypassing access controls, logins, CAPTCHAs/);
  assert.match(source,/An agency, manager, promotion or other third party does not automatically control/);
  assert.match(source,/Source-access objections are separate from fighter-profile removal/);
  assert.match(source,/The fighter/);
  assert.match(source,/Authorized representative of the fighter/);
  assert.match(source,/I attest that I am the fighter or am authorized by the fighter/);
  assert.match(source,/noindex,follow/);
});

test('removal requests are verified before publication suppression',()=>{
  const source=read('src/legal-safety.ts');
  assert.match(source,/status='pending'/);
  assert.match(source,/\['approve','reject'\]/);
  assert.match(source,/public_status,basis,removal_request_id/);
  assert.match(source,/VALUES\(\?,\?,\?,'removed'/);
  assert.match(source,/public_status='removed'/);
  assert.match(source,/fighter_request/);
  assert.match(source,/authorized_representative/);
  assert.match(source,/abuse_key_hash/);
  assert.match(source,/sha256Hex\(actor\)/);
  assert.match(source,/COUNT\(\*\) count.*-24 hours/);
});

test('all global discovery surfaces use the public fighter view',()=>{
  const globalScout=read('src/global-scout.ts');
  const talent=read('src/talent-network.ts');
  const score=read('src/scout-score.ts');
  const intel=read('src/fighter-intel.ts');
  const sitemap=read('src/public-sitemap.ts');
  for(const source of [globalScout,talent,score,intel,sitemap])assert.match(source,/scout_public_global_profiles/);
  assert.match(globalScout,/FROM scout_public_global_profiles p/);
  assert.match(talent,/FROM scout_public_global_profiles p/);
  assert.match(score,/JOIN scout_public_global_profiles p/);
  assert.match(intel,/JOIN scout_public_global_profiles p/);
  assert.match(sitemap,/FROM scout_public_global_profiles p/);
});

test('legacy canonical fighter pages and APIs honor global profile removals',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/canonicalFighterRemoved/);
  assert.match(entry,/fighter_publication_controls c/);
  assert.match(entry,/c\.public_status='removed'/);
  assert.match(entry,/\/api\\\/fighters/);
  assert.match(entry,/\/fighters/);
  assert.match(entry,/x-robots-tag':'noindex'/);
});

test('legal pages and removal workflow are reachable while the removal form stays out of search',()=>{
  const entry=read('src/entry.ts');
  const nav=read('src/navigation.ts');
  const sitemap=read('src/public-sitemap.ts');
  const generated=read('scripts/lib/sitemap.mjs');
  assert.match(entry,/dataPolicyPage/);
  assert.match(entry,/privacyPage/);
  assert.match(entry,/profileRemovalPage/);
  assert.match(entry,/profileRemovalApi/);
  assert.match(entry,/profileRemovalAdminApi/);
  assert.match(nav,/Data &amp; Sourcing/);
  assert.match(nav,/Remove my fighter profile/);
  assert.match(sitemap,/\/data-policy/);
  assert.match(sitemap,/\/privacy/);
  assert.doesNotMatch(sitemap,/\$\{SITE\}\/profile-removal/);
  assert.match(generated,/data-policy/);
  assert.match(generated,/privacy/);
  assert.doesNotMatch(generated,/entry\(`\$\{base\}\/profile-removal`\)/);
});

test('generated sitemap excludes identity-linked removed canonical fighters',()=>{
  const generator=read('scripts/generate-sitemap.mjs');
  assert.match(generator,/fighter_publication_controls c/);
  assert.match(generator,/c\.public_status='removed'/);
  assert.match(generator,/l\.confidence>=0\.90/);
  assert.match(generator,/const total = 9 \+/);
});

test('public opportunity contact is an HTTPS link, not a phone or email field',()=>{
  const talent=read('src/talent-network.ts');
  assert.match(talent,/function validPublicContact/);
  assert.match(talent,/url\.protocol==='https:'/);
  assert.match(talent,/public_contact_requires_https_url/);
  assert.doesNotMatch(talent,/public_phone|phone_number|home_address|street_address/);
});
