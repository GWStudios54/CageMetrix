import test from 'node:test';
import assert from 'node:assert/strict';
import {MANAGEMENT_SOURCES,applyManagementAliases,normalizeManagementName,parseManagementRoster} from '../scripts/lib/management-sources.mjs';

test('management source registry starts with current official agency rosters',()=>{
  assert.ok(MANAGEMENT_SOURCES.length>=4);
  for(const source of MANAGEMENT_SOURCES){
    assert.ok(source.slug&&source.name&&source.website);
    assert.ok(['A','B','C'].includes(source.confidence));
    assert.ok(Array.isArray(source.urls)&&source.urls.length>0);
    for(const url of source.urls)assert.match(url,/^https:\/\//);
  }
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

test('official roster promotion labels are stripped before matching',()=>{
  const names=parseManagementRoster(`<section><p>Khabib Nurmagomedov (UFC)</p><p>Kayla Harrison (PFL)</p><p>Islam Makhachev (UFC)</p></section>`).map(normalizeManagementName);
  assert.deepEqual(names.sort(),['islam makhachev','kayla harrison','khabib nurmagomedov'].sort());
});

test('small explicit aliases fix source spelling without fuzzy identity guesses',()=>{
  const aliases={'bia mesquita':'Beatriz Mesquita','sodiq yusuf':'Sodiq Yusuff'};
  assert.equal(applyManagementAliases('Bia Mesquita',aliases),'Beatriz Mesquita');
  assert.equal(applyManagementAliases('Unknown Prospect',aliases),'Unknown Prospect');
});
