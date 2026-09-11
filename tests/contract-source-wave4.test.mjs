import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='pfl-news');

test('wave 4 seeds first-party PFL contract history',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Professional Fighters League');
  assert.equal(source.sourceType,'promotion_direct');
  assert.equal(source.promotionSlug,'pfl');
  assert.ok(Array.isArray(source.seedArticles));
  assert.ok(source.seedArticles.length>=8);
  assert.ok(source.seedArticles.every(row=>new URL(row.url).hostname==='pflmma.com'));
  assert.ok(source.seedArticles.some(row=>/Bryan Battle/.test(row.title)));
  assert.ok(source.seedArticles.some(row=>/Paul Hughes/.test(row.title)));
  assert.ok(source.seedArticles.some(row=>/Cedric Doumbe.*Extension/.test(row.title)));
});

test('PFL exclusive multi-fight language resolves to PFL under-contract evidence',()=>{
  assert.equal(detectContractPromotion('Paul Hughes has signed an exclusive, multi-fight contract with the Professional Fighters League.',null),'pfl');
  assert.deepEqual(detectContractSignal('Paul Hughes has signed an exclusive, multi-fight contract with the Professional Fighters League.'),{eventType:'signing',status:'under_contract'});
});

test('PFL extension article resolves extension rather than a new signing',()=>{
  assert.deepEqual(detectContractSignal('Cedric Doumbe has signed an exclusive, multi-year contract extension with PFL.'),{eventType:'extension',status:'under_contract'});
  assert.equal(detectContractPromotion('Cedric Doumbe has signed an exclusive, multi-year contract extension with PFL.',null),'pfl');
});

test('PFL seed candidate remains private and exact-identity scoped',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'9001',fighter_name:'Bryan Battle'}];
  const rows=candidateRows(
    {title:'Middleweight Contender Bryan Battle Signs Exclusive, Multi-Year Contract With Professional Fighters League',url:'https://pflmma.com/news/middleweight-contender-bryan-battle-signs-exclusive-multiyear-contract-with-professional-fighters-league',publishedAt:'2025-09-05'},
    source,
    'The Professional Fighters League today announced the signing of Middleweight contender Bryan Battle to an exclusive, multi-year contract.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Bryan Battle');
  assert.equal(rows[0].promotionSlug,'pfl');
  assert.equal(rows[0].reviewStatus,'pending');
  assert.equal(rows[0].sourceFighterId,'9001');
});
