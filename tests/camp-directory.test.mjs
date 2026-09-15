import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('camp directory and camp page routes are wired and public (no adminAccount gate)',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/from '\.\/camp-directory\.ts'/);
  assert.match(entry,/path==='\/api\/camps'/);
  assert.match(entry,/campApiMatch=path\.match\(\/\^\\\/api\\\/camps\\\/\(\[a-z0-9-\]\{1,100\}\)\\\/\?\$\//);
  assert.match(entry,/path==='\/camps'\|\|path==='\/camps\/'/);
  assert.match(entry,/campPageMatch=path\.match\(\/\^\\\/camps\\\/\(\[a-z0-9-\]\{1,100\}\)\\\/\?\$\//);
  assert.match(entry,/campsPage\(request,env\)/);
  assert.match(entry,/campPage\(request,env,campPageMatch\[1\]\)/);
});

test('camps directory and detail pages only surface publication-safe profiles',()=>{
  const source=read('src/camp-directory.ts');
  assert.match(source,/scout_public_global_profiles/);
  assert.doesNotMatch(source,/scout_active_global_profiles/);
});

test('camp directory groups every seeded country into a continent without dropping any',()=>{
  const source=read('src/camp-directory.ts');
  const migration=read('migrations/0044_team_camp_intelligence.sql');
  const seedBlock=migration.slice(migration.indexOf('INSERT OR IGNORE INTO training_camps'));
  const field=`('[^']*'|NULL)`;
  const rows=[...seedBlock.matchAll(new RegExp(`\\(${field},${field},${field},${field},${field},${field},CURRENT_TIMESTAMP\\)`,'g'))];
  assert.ok(rows.length>=40,`expected ~43 seeded camps, parsed ${rows.length}`);
  const countries=new Set(rows.map(row=>row[5]).filter(v=>v&&v!=='NULL').map(v=>v.slice(1,-1)));
  assert.ok(countries.size>10,'expected multiple distinct countries in the seed');
  for(const country of countries){
    assert.match(source,new RegExp(`'${country}':`),`missing continent mapping for ${country}`);
  }
});

test('camp roster ranks current fighters by scout rating and links back to their fighter pages',()=>{
  const source=read('src/camp-directory.ts');
  assert.match(source,/FROM scout_current_camp cur/);
  assert.match(source,/JOIN scout_public_global_profiles p ON p\.source_key=cur\.source_key AND p\.source_fighter_id=cur\.source_fighter_id/);
  assert.match(source,/href="\/scout\/fighters\/\$\{escape\(row\.profile_slug\)\}"/);
  assert.match(source,/ORDER BY r\.scout_rating IS NULL,r\.scout_rating DESC,p\.fighter_name/);
});

test('camps never feed Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  for(const forbidden of ['training_camps','fighter_camp_history','scout_current_camp'])assert.doesNotMatch(rating,new RegExp(forbidden));
});

test('fighter dossier only shows "Last: <organization>" for a real promotion name, not a generic bout-type placeholder',()=>{
  const source=read('src/global-scout.ts');
  assert.match(source,/isRealOrganization\(f\.current_organization\)/);
  assert.match(source,/GENERIC_ORGANIZATION_VALUES=new Set\(\['unknown','professional','amateur','pro','mma','n\/a','none'\]\)/);
});
