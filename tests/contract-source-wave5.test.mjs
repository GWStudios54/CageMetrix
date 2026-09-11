import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='one-mma-rss');

test('wave 5 seeds first-party ONE Championship MMA signing history',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'ONE Championship');
  assert.equal(source.sourceType,'promotion_direct');
  assert.equal(source.promotionSlug,'one');
  assert.ok(Array.isArray(source.seedArticles));
  assert.ok(source.seedArticles.length>=9);
  assert.ok(source.seedArticles.every(row=>{
    const url=new URL(row.url);
    return url.hostname==='www.onefc.com'&&/^\/news\/[a-z0-9-]+\/?$/i.test(url.pathname);
  }));
  for(const fighter of ['Dustin Joynson','Stephen Loman','Jhanlo','Jeremy Pacatiw','Saygid Izagakhmaev','Marcus Almeida','Kantharaj','Ritu Phogat','Willie Van Rooyen']){
    assert.ok(source.seedArticles.some(row=>row.title.toLowerCase().includes(fighter.toLowerCase())),fighter);
  }
});

test('ONE seed set stays scoped to MMA recruiting rather than unrelated combat-sport signings',()=>{
  const titles=source.seedArticles.map(row=>row.title).join('\n');
  for(const nonMma of ['Seksan','Ricardo Bravo','Takeru Segawa','Wei Rui','Prajanchai','Helena Crevar','Danielle Kelly','Gordon Ryan']){
    assert.doesNotMatch(titles,new RegExp(nonMma,'i'));
  }
});

test('ONE joining headlines still require signing language in article body',()=>{
  assert.equal(hasContractSignal('5-Time MMA Champion Stephen Loman Joins ONE Championship'),false);
  const body='ONE Championship announced the signing of five-time Mixed Martial Arts Champion Stephen Loman.';
  assert.equal(hasContractSignal(body),true);
  assert.deepEqual(detectContractSignal(body),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion(body+' He signed with ONE Championship.','one'),'one');
});

test('ONE direct signing language resolves to ONE under-contract evidence',()=>{
  for(const sentence of [
    'Dustin Joynson officially put pen to paper with ONE Championship.',
    'Jhanlo Sangiao has officially signed with ONE Championship.',
    'Saygid Izagakhmaev has signed a contract with ONE Championship.',
    'Willie Van Rooyen has officially signed with ONE Championship.'
  ]){
    assert.equal(hasContractSignal(sentence),true,sentence);
    assert.deepEqual(detectContractSignal(sentence),{eventType:'signing',status:'under_contract'});
    assert.equal(detectContractPromotion(sentence,'one'),'one');
  }
});

test('ONE seed candidates remain private and exact-identity scoped',()=>{
  const profiles=[
    {source_key:'mma',source_fighter_id:'one-1',fighter_name:'Stephen Loman'},
    {source_key:'mma',source_fighter_id:'one-2',fighter_name:'Jhanlo Sangiao'}
  ];
  const article=source.seedArticles.find(row=>/Stephen Loman/.test(row.title));
  const rows=candidateRows(
    article,
    source,
    'ONE Championship announced the signing of five-time Mixed Martial Arts Champion Stephen Loman. Stephen Loman signed with ONE Championship and will compete in MMA.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Stephen Loman');
  assert.equal(rows[0].promotionSlug,'one');
  assert.equal(rows[0].reviewStatus,'pending');
  assert.equal(rows[0].sourceFighterId,'one-1');
});
