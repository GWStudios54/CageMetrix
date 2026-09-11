import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ONE_LOCATION_SOURCE,PFL_LOCATION_SOURCE,extractPflCsrfToken,normalizeFighterName,parseOneProfile,parseOneRoster,parsePflAjaxPayload,parsePflProfile,parsePflRoster,parseProfessionalLocation,stripQuotedNickname} from '../scripts/lib/promotion-location-sources.mjs';

const read=path=>fs.readFileSync(path,'utf8');

test('location intelligence keeps professional base evidence separate from opportunity provenance',()=>{
  const sql=read('migrations/0039_location_intelligence.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_location_evidence/);
  assert.match(sql,/CREATE VIEW scout_current_location/);
  assert.match(sql,/location_kind TEXT NOT NULL CHECK \(location_kind IN \([\s\S]*?'fighting_out_of','training_base','camp_location','hometown','other_professional'[\s\S]*?\)\)/);
  assert.match(sql,/CASE WHEN COALESCE\(o\.base_city,o\.base_region,o\.base_country\) IS NOT NULL THEN o\.base_city ELSE cl\.base_city END base_city/);
  assert.match(sql,/base_source_url/);
  assert.doesNotMatch(sql,/UPDATE fighter_opportunity_status/);
});

test('PFL roster parser only accepts same-host official fighter profile links',()=>{
  const html='<main><a href="/all-fighter/johnny-eblen">Johnny Eblen</a><a href="/regular-fighter/paul-hughes">Paul Hughes</a><a href="https://evil.example/all-fighter/fake">Fake</a><a href="/news/fighter-signing">News</a></main>';
  const rows=parsePflRoster(html,PFL_LOCATION_SOURCE);
  assert.deepEqual(rows.map(row=>row.url),['https://pflmma.com/all-fighter/johnny-eblen','https://pflmma.com/regular-fighter/paul-hughes']);
});

test('PFL profile parser separates hometown from fighting base and camp',()=>{
  const html='<!doctype html><html><head><title>Johnny Eblen | Middleweight (185)</title></head><body><main><div>FROM Des Moines, IA</div><div>FIGHTING OUT OF Coconut Creek, FL</div><div>FIGHT CAMP American Top Team</div><div>SOCIAL</div></main></body></html>';
  const row=parsePflProfile(html,'https://pflmma.com/all-fighter/johnny-eblen');
  assert.equal(row.fighter_name,'Johnny Eblen');
  assert.equal(row.fighting_out_of,'Coconut Creek, FL');
  assert.equal(row.fight_camp,'American Top Team');
  assert.deepEqual(row.location,{raw_value:'Coconut Creek, FL',city:'Coconut Creek',region:'FL',country:'United States'});
  assert.doesNotMatch(JSON.stringify(row),/Des Moines/);
});

test('professional location parser only decomposes explicit location text',()=>{
  assert.deepEqual(parseProfessionalLocation('Mesa, AZ'),{raw_value:'Mesa, AZ',city:'Mesa',region:'AZ',country:'United States'});
  assert.deepEqual(parseProfessionalLocation('Columbus, Ohio'),{raw_value:'Columbus, Ohio',city:'Columbus',region:'OH',country:'United States'});
  assert.deepEqual(parseProfessionalLocation('Paris, France'),{raw_value:'Paris, France',city:'Paris',region:null,country:'France'});
  assert.deepEqual(parseProfessionalLocation('Colombia'),{raw_value:'Colombia',city:null,region:null,country:'Colombia'});
  assert.deepEqual(parseProfessionalLocation('Ecuador'),{raw_value:'Ecuador',city:null,region:null,country:'Ecuador'});
  assert.deepEqual(parseProfessionalLocation('Spain'),{raw_value:'Spain',city:null,region:null,country:'Spain'});
  assert.deepEqual(parseProfessionalLocation('Mystery Gym City'),{raw_value:'Mystery Gym City',city:null,region:null,country:null});
});

test('promotion location sync uses exact normalized identity only and skips ambiguity',()=>{
  const source=read('scripts/sync-promotion-location.mjs');
  assert.match(source,/normalized_name IN/);
  assert.match(source,/hits\.length===1/);
  assert.match(source,/hits\.length>1/);
  assert.match(source,/ambiguous/);
  assert.doesNotMatch(source,/fuzzy|levenshtein|similarity/i);
  assert.match(source,/fighter_location_evidence/);
  assert.match(source,/FIGHTING OUT OF/);
  assert.match(source,/FIGHT CAMP/);
  assert.doesNotMatch(source,/fighter_opportunity_status/);
});

test('PFL location and camp evidence is first-party grade A and cannot affect Global Rating',()=>{
  const source=read('scripts/sync-promotion-location.mjs'),rating=read('scripts/build-global-scout-rating-v2.py');
  assert.match(source,/promotion_direct/);
  assert.match(source,/q\('A'\)/);
  assert.match(source,/team\.primary/);
  assert.doesNotMatch(rating,/fighter_location_evidence|scout_current_location|promotion-location|base_source_url/);
});

test('package and workflow provide independent idempotent promotion-location sync',()=>{
  const pkg=JSON.parse(read('package.json')),workflow=read('.github/workflows/promotion-location-sync.yml');
  assert.equal(pkg.scripts['locations:sync'],'node scripts/sync-promotion-location.mjs --remote');
  assert.match(workflow,/group: mmascouts-promotion-location/);
  assert.match(workflow,/d1 migrations apply cagemetrix --remote/);
  assert.match(workflow,/sync-promotion-location\.mjs --dry-run/);
  assert.match(workflow,/npm run locations:sync/);
});

test('name normalization remains exact-compatible without fuzzy identity repair',()=>{
  assert.equal(normalizeFighterName('Salah Eddine Hamli'),'salah eddine hamli');
  assert.equal(normalizeFighterName('Cédric Doumbé'),'cedric doumbe');
});


test('PFL load-more contract is parsed without inventing endpoints or pagination',()=>{
  const script=`headers: {'X-CSRF-TOKEN': 'abc123'}`;
  assert.equal(extractPflCsrfToken(script),'abc123');
  assert.deepEqual(parsePflAjaxPayload(JSON.stringify({html:'<a href="/all-fighter/a">A</a>',count:8,total:99})),{html:'<a href="/all-fighter/a">A</a>',count:8,total:99});
  const source=read('scripts/sync-promotion-location.mjs');
  assert.ok(PFL_LOCATION_SOURCE.rosterUrls.length>=6);
  for(const path of ['regular-fighter-roster','cs-fighter-roster','mena-fighter-roster','europe-fighter-roster','africa-fighter-roster'])assert.ok(PFL_LOCATION_SOURCE.rosterUrls.some(url=>url.includes(path)),path);
  assert.match(source,/\/ajax\/query_fighters/);
  assert.match(source,/for\(let page=2;page<=100;page\+\+\)/);
  for(const field of ['season_type','season_year','weightclass','gender','query_s','page'])assert.match(source,new RegExp("form\\.append\\('"+field+"'"));
  assert.match(source,/payload\.total===0\|\|payload\.count===0/);
  assert.match(source,/x-csrf-token/);
  assert.match(source,/getSetCookie/);
  assert.match(source,/cookieHeader/);
  assert.match(source,/cookie:cookieHeader/);
});


test('ONE roster parser accepts only canonical same-host athlete profiles',()=>{
  const html='<main><a href="/athletes/joshua-perreira/">Joshua “Flyin Hawaiian” Perreira</a><a href="/athletes/takeharu-ogawa/">Takeharu Ogawa</a><a href="/athletes/page/2/">Page 2</a><a href="/athletes/country/us/">USA</a><a href="https://evil.example/athletes/fake/">Fake</a></main>';
  const rows=parseOneRoster(html,ONE_LOCATION_SOURCE);
  assert.deepEqual(rows,[
    {url:'https://www.onefc.com/athletes/joshua-perreira',fighter_name:'Joshua Perreira',normalized_name:'joshua perreira'},
    {url:'https://www.onefc.com/athletes/takeharu-ogawa',fighter_name:'Takeharu Ogawa',normalized_name:'takeharu ogawa'}
  ]);
});

test('ONE identity normalization strips only explicit quoted nicknames before exact matching',()=>{
  assert.equal(stripQuotedNickname('Joshua “Flyin Hawaiian” Perreira'),'Joshua Perreira');
  assert.equal(stripQuotedNickname('John "Hands of Stone" Doe'),'John Doe');
  assert.equal(stripQuotedNickname("O'Neal Thompson"),"O'Neal Thompson");
});

test('ONE profile parses literal fighting-out-of base with full US state name',()=>{
  const html='<!doctype html><html><head><title>Joshua “Flyin Hawaiian” Perreira - ONE Championship – The Home of Martial Arts</title></head><body><h1>Joshua “Flyin Hawaiian” Perreira</h1><h2>About Joshua Perreira</h2><p>Joshua Perreira is a mixed martial artist from Kailua, Hawaii, currently fighting out of Columbus, Ohio.</p><h2>ONE Championship Records</h2></body></html>';
  const row=parseOneProfile(html,'https://www.onefc.com/athletes/joshua-perreira');
  assert.equal(row.fighter_name,'Joshua Perreira');
  assert.equal(row.normalized_name,'joshua perreira');
  assert.equal(row.fighting_out_of,'Columbus, Ohio');
  assert.deepEqual(row.location,{raw_value:'Columbus, Ohio',city:'Columbus',region:'OH',country:'United States'});
  assert.equal(row.fight_camp,null);
  assert.doesNotMatch(JSON.stringify(row),/Kailua/);
});

test('ONE profile separates explicit fight camp from professional base',()=>{
  const html='<!doctype html><html><body><h1>Takeharu Ogawa</h1><h2>About Takeharu Ogawa</h2><p>Fighting out of Kanagawa, Japan, with Taniyama Gym Yamato, he gained the attention of ONE Championship for his aggressive style.</p><h2>ONE Championship Records</h2></body></html>';
  const row=parseOneProfile(html,'https://www.onefc.com/athletes/takeharu-ogawa');
  assert.equal(row.fighting_out_of,'Kanagawa, Japan');
  assert.deepEqual(row.location,{raw_value:'Kanagawa, Japan',city:'Kanagawa',region:null,country:'Japan'});
  assert.equal(row.fight_camp,'Taniyama Gym Yamato');
});

test('ONE profile accepts country-only fighting base but rejects stance language',()=>{
  const colombia=parseOneProfile('<html><body><h1>Jordan Estupinan</h1><h2>About Jordan Estupinan</h2><p>Fighting out of Colombia, Jordan is ready to compete.</p><h2>ONE Championship Records</h2></body></html>','https://www.onefc.com/athletes/jordan-estupinan');
  assert.deepEqual(colombia.location,{raw_value:'Colombia',city:null,region:null,country:'Colombia'});
  const stance=parseOneProfile('<html><body><h1>Example Fighter</h1><h2>About Example Fighter</h2><p>Fighting out of the southpaw stance, he pressures opponents.</p><h2>ONE Championship Records</h2></body></html>','https://www.onefc.com/athletes/example-fighter');
  assert.equal(stance.fighting_out_of,null);
  assert.deepEqual(stance.location,{raw_value:null,city:null,region:null,country:null});
});

test('ONE production sync bounds probes and exact-prefilters the large athlete directory',()=>{
  const source=read('scripts/sync-promotion-location.mjs');
  assert.match(source,/onePageLimit=dry\?3:100/);
  assert.match(source,/oneProfileLinks=oneRosterLinks\.slice\(0,30\)/);
  assert.match(source,/SELECT source_key,source_fighter_id,normalized_name FROM scout_active_global_profiles/);
  assert.match(source,/oneCounts\.get\(row\.normalized_name\)===1/);
  assert.match(source,/profile\.normalized_name!==item\.normalized_name/);
  assert.doesNotMatch(source,/fuzzy|levenshtein|similarity/i);
});

test('ONE location evidence is first-party Grade A and remains rating-independent',()=>{
  assert.equal(ONE_LOCATION_SOURCE.publisher,'ONE Championship');
  assert.equal(ONE_LOCATION_SOURCE.sourceType,'promotion_direct');
  assert.equal(ONE_LOCATION_SOURCE.confidence,'A');
  assert.equal(ONE_LOCATION_SOURCE.promotionSlug,'one');
  const rating=read('scripts/build-global-scout-rating-v2.py');
  assert.doesNotMatch(rating,/one-athletes|fighter_location_evidence|scout_current_location/);
});
