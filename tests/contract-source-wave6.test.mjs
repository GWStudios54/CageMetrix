import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CONTRACT_DISCOVERY_SOURCES,
  candidateRows,
  detectContractPromotion,
  detectContractSignal,
  detectContractSignals,
  hasContractSignal
} from '../scripts/lib/contract-intel-discovery.mjs';

const read=path=>fs.readFileSync(path,'utf8');
const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='mma-fighting');

test('wave 6 registers current high-value MMA Fighting transition leads',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'MMA Fighting');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.match(String(source.path),/one/);
  assert.ok(Array.isArray(source.seedArticles));
  const expected=new Map([
    ['Michael Page','ufc'],
    ['Roberto Soldic','one'],
    ['Michel Pereira','ufc'],
    ['Francis Ngannou','pfl'],
    ['Adriano Moraes','one']
  ]);
  for(const [fighter,promotion] of expected){
    const row=source.seedArticles.find(article=>article.subjectFighterName===fighter);
    assert.ok(row,fighter);
    assert.equal(row.promotionSlug,promotion);
    assert.ok(/^2026-\d{2}-\d{2}$/.test(row.publishedAt));
    const url=new URL(row.url);
    assert.equal(url.hostname,'www.mmafighting.com');
    assert.match(url.pathname,/^\/(?:ufc|pfl|one)\//);
  }
});

test('completed deal is treated as expiration rather than a new signing',()=>{
  const text='Michel Pereira completed his previous deal with the UFC after his February fight.';
  assert.equal(hasContractSignal(text),true);
  assert.deepEqual(detectContractSignal(text),{eventType:'expiration',status:'expired'});
  assert.equal(detectContractPromotion(text,null),'ufc');
});

test('release language attributes the named prior promotion',()=>{
  const text='PFL releases Francis Ngannou from his contract.';
  assert.deepEqual(detectContractSignal(text),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion(text,null),'pfl');
  assert.equal(detectContractPromotion('Michel Pereira was removed from the UFC roster.',null),'ufc');
});

test('explicit expiry and explicit free agency remain separate private facts',()=>{
  const text='Roberto Soldic says his ONE Championship contract has officially expired and he has entered free agency.';
  assert.deepEqual(detectContractSignals(text),[
    {eventType:'expiration',status:'expired'},
    {eventType:'free_agency',status:'free_agent'}
  ]);
  assert.equal(detectContractPromotion(text,null),'one');
});

test('free-agent fight wording remains excluded from free-agency evidence',()=>{
  assert.equal(hasContractSignal('A promoter proposed a free-agent fight between two veterans.'),false);
  assert.deepEqual(detectContractSignals('A promoter proposed a free-agent fight between two veterans.'),[
    {eventType:'status_update',status:'unknown'}
  ]);
});

test('curated transition subject resolves Michael Page without fuzzy nickname matching',()=>{
  const article=source.seedArticles.find(row=>row.subjectFighterName==='Michael Page');
  const profiles=[{source_key:'mma',source_fighter_id:'mvp-1',fighter_name:'Michael Page'}];
  const rows=candidateRows(
    article,
    source,
    'That was his last fight on his UFC contract.\nThe 39-year-old British fighter now enters free agency.',
    profiles
  );
  assert.deepEqual(rows.map(row=>[row.detectedEventType,row.detectedStatus,row.promotionSlug]).sort(),[
    ['free_agency','free_agent','ufc'],
    ['status_update','unknown','ufc']
  ]);
  assert.ok(rows.every(row=>row.fighterName==='Michael Page'));
  assert.ok(rows.every(row=>row.sourceFighterId==='mvp-1'));
  assert.ok(rows.every(row=>row.reviewStatus==='pending'));
  assert.ok(rows.every(row=>row.extractionMethod==='seed_subject_scoped_v6'));
});

test('curated seed subject still requires exactly one exact warehouse identity',()=>{
  const article=source.seedArticles.find(row=>row.subjectFighterName==='Michael Page');
  const profiles=[
    {source_key:'a',source_fighter_id:'1',fighter_name:'Michael Page'},
    {source_key:'b',source_fighter_id:'2',fighter_name:'Michael Page'}
  ];
  const rows=candidateRows(article,source,'He now enters free agency.',profiles);
  assert.equal(rows.length,1);
  assert.equal(rows[0].reviewStatus,'needs_identity');
  assert.equal(rows[0].sourceKey,null);
  assert.equal(rows[0].sourceFighterId,null);
});

test('curated subject metadata cannot bind an unrelated headline',()=>{
  const article={
    title:'Another fighter leaves a promotion',
    subjectFighterName:'Michael Page',
    promotionSlug:'ufc',
    url:'https://www.mmafighting.com/ufc/fake',
    publishedAt:'2026-09-09'
  };
  const profiles=[{source_key:'mma',source_fighter_id:'1',fighter_name:'Michael Page'}];
  assert.deepEqual(candidateRows(article,source,'He now enters free agency.',profiles),[]);
});

test('transition wave remains private review intelligence and rating-independent',()=>{
  const discovery=read('scripts/discover-contract-intel.mjs');
  const rating=read('scripts/build-global-scout-rating-v2.py');
  assert.match(discovery,/contract_intel_candidates/);
  assert.doesNotMatch(discovery,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_contract_events/i);
  assert.doesNotMatch(rating,/contract_intel_candidates|fighter_contract_events|seed_subject_scoped_v6/);
  const parser=read('scripts/lib/contract-intel-discovery.mjs');
  assert.doesNotMatch(parser,/levenshtein|jaro|similarity|fuzzy/i);
});
