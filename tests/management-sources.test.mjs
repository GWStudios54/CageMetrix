import test from 'node:test';
import assert from 'node:assert/strict';
import {MANAGEMENT_SOURCES,applyManagementAliases,normalizeManagementName,parseManagementRoster} from '../scripts/lib/management-sources.mjs';

test('management source registry separates roster sources from agency profile evidence',()=>{
  assert.ok(MANAGEMENT_SOURCES.length>=6);
  for(const source of MANAGEMENT_SOURCES){
    assert.ok(source.slug&&source.name&&source.website);
    assert.ok(['A','B','C'].includes(source.confidence));
    assert.ok(['official_public_roster','profile_only'].includes(source.rosterScope));
    assert.ok(Array.isArray(source.urls));
    assert.ok(Array.isArray(source.profileUrls)&&source.profileUrls.length>0);
    for(const url of [...source.urls,...source.profileUrls])assert.match(url,/^https:\/\//);
    if(source.rosterScope==='official_public_roster')assert.ok(source.urls.length>0);
    if(source.rosterScope==='profile_only')assert.equal(source.urls.length,0);
  }
  assert.ok(MANAGEMENT_SOURCES.some(source=>source.slug==='suckerpunch-entertainment'&&source.rosterScope==='profile_only'));
  assert.ok(MANAGEMENT_SOURCES.some(source=>source.slug==='paradigm-sports'&&source.rosterScope==='profile_only'));
  const artnox=MANAGEMENT_SOURCES.find(source=>source.slug==='artnox-fight-sport');
  assert.ok(artnox);
  assert.equal(artnox.confidence,'A');
  assert.equal(artnox.rosterScope,'official_public_roster');
  assert.ok(artnox.urls.some(url=>/artnoxfightsport\.pl\/pages\/zawodnicy/.test(url)));
  const fairPlay=MANAGEMENT_SOURCES.find(source=>source.slug==='fair-play-mma');
  const ak=MANAGEMENT_SOURCES.find(source=>source.slug==='ak-fighter-management');
  for(const source of [fairPlay,ak]){
    assert.ok(source);
    assert.equal(source.confidence,'A');
    assert.equal(source.rosterScope,'official_public_roster');
    assert.ok(source.urls.length>0);
  }
  assert.ok(fairPlay.urls.some(url=>/fairplaymma\.com/.test(url)));
  assert.ok(ak.urls.some(url=>/akfightermanagement\.com/.test(url)));
});

test('warehouse-compatible normalization preserves cautious exact matching',()=>{
  assert.equal(normalizeManagementName('Lone’er Kavanagh'),'lone er kavanagh');
  assert.equal(normalizeManagementName('Arman Tsarukyan'),'arman tsarukyan');
  assert.equal(normalizeManagementName('Jonas Mågård'),'jonas magard');
});

test('roster parser extracts athlete names but not page furniture',()=>{
  const html=`<main><h1>UFC Athletes</h1><div><h6>Ilia Topuria</h6></div><div><p>Mayra Bueno Silva</p></div><div><span>Lone’er Kavanagh</span></div><div><img alt="Kamaru Usman"><p>Kamaru Usman (UFC)</p></div><h2>Our Services</h2><p>First Round Management</p><p>Las Vegas, Nevada</p></main>`;
  const names=parseManagementRoster(html),normalized=names.map(normalizeManagementName);
  for(const expected of ['ilia topuria','mayra bueno silva','lone er kavanagh','kamaru usman'])assert.ok(normalized.includes(expected),`missing ${expected}: ${JSON.stringify(names)}`);
  assert.ok(!normalized.includes('first round management'));
  assert.ok(!normalized.includes('our services'));
});

test('agency team pages are never registered as fighter roster sources',()=>{
  const sucker=MANAGEMENT_SOURCES.find(source=>source.slug==='suckerpunch-entertainment');
  const paradigm=MANAGEMENT_SOURCES.find(source=>source.slug==='paradigm-sports');
  assert.deepEqual(sucker.urls,[]);
  assert.ok(sucker.profileUrls.some(url=>/about-us/.test(url)));
  assert.deepEqual(paradigm.urls,[]);
  assert.ok(paradigm.profileUrls.some(url=>/representation/.test(url)));
});

test('official roster promotion labels are stripped before matching',()=>{
  const names=parseManagementRoster(`<section><p>Khabib Nurmagomedov (UFC)</p><p>Kayla Harrison (PFL)</p><p>Islam Makhachev (UFC)</p></section>`).map(normalizeManagementName);
  assert.deepEqual(names.sort(),['islam makhachev','kayla harrison','khabib nurmagomedov'].sort());
});

test('small explicit aliases fix source spelling without fuzzy identity guesses',()=>{
  const aliases={'bia mesquita':'Beatriz Mesquita','sodiq yusuf':'Sodiq Yusuff'};
  assert.equal(applyManagementAliases('Bia Mesquita',aliases),'Beatriz Mesquita');
  assert.equal(applyManagementAliases('Unknown Prospect',aliases),'Unknown Prospect');
});
