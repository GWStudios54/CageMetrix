import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const bySlug=slug=>CONTRACT_DISCOVERY_SOURCES.find(source=>source.slug===slug);

test('wave 3 adds BRAVE CF, CFFC and OKTAGON as official promotion sources',()=>{
  for(const [slug,publisher] of [
    ['brave-cf-news','BRAVE Combat Federation'],
    ['cffc-news','Cage Fury Fighting Championships'],
    ['oktagon-news','OKTAGON MMA']
  ]){
    const source=bySlug(slug);
    assert.ok(source,slug);
    assert.equal(source.publisher,publisher);
    assert.equal(source.sourceType,'promotion_direct');
    assert.equal(source.promotionSlug,null,'publisher identity must not become contract attribution');
    assert.ok(Array.isArray(source.seedArticles)&&source.seedArticles.length>0,slug+' needs at least one first-party historical seed');
  }
});

test('BRAVE listing accepts same-host signing stories and rejects unrelated links',()=>{
  const source=bySlug('brave-cf-news');
  const rows=parseContractListing(`<main>
    <article><a href="/news/amil-tutic-signs-exclusive-multi-fight-deal-with-brave-cf">Amil Tutic Signs Exclusive Multi-Fight Deal with BRAVE CF</a></article>
    <article><a href="/news/brave-cf-110-results">BRAVE CF 110 Results</a></article>
    <article><a href="https://example.com/news/fake-signing">Fake Fighter Signs Contract</a></article>
  </main>`,source);
  assert.equal(rows.length,1);
  assert.match(rows[0].url,/bravecf\.com\/news\/amil-tutic/);
});

test('CFFC and OKTAGON listing paths stay scoped to official editorial pages',()=>{
  const cffc=bySlug('cffc-news'),oktagon=bySlug('oktagon-news');
  const cffcRows=parseContractListing(`<main>
    <article><a href="/news/2026/8/11/cffc-flyweight-champion-bilal-hasan-remains-undefeated-secures-ufc-deal">Bilal Hasan Secures UFC Deal</a></article>
    <a href="/fighters/bilal-hasan">Bilal Hasan signs contract</a>
  </main>`,cffc);
  assert.equal(cffcRows.length,1);
  const oktagonRows=parseContractListing(`<main>
    <article><a href="/en/blog/patrik-kincl-everything-you-ever-wanted-to-know/">Patrik Kincl signed a contract with OKTAGON MMA</a></article>
    <a href="/en/fighters/patrik-kincl/">Patrik Kincl contract</a>
  </main>`,oktagon);
  assert.equal(oktagonRows.length,1);
});

test('wave 3 promotion attribution recognizes MMA Scouts canonical promotion slugs',()=>{
  assert.equal(detectContractPromotion('Amil Tutic signed an exclusive multi-fight deal with BRAVE CF',null),'brave-cf');
  assert.equal(detectContractPromotion('Jane Doe signed a new CFFC contract',null),'cffc');
  assert.equal(detectContractPromotion('Patrik Kincl signed a contract with OKTAGON MMA',null),'oktagon');
});

test('official publisher reporting a different promotion does not inherit publisher promotion',()=>{
  const source=bySlug('cffc-news');
  const profiles=[{source_key:'mma',source_fighter_id:'1',fighter_name:'Bilal Hasan'}];
  const rows=candidateRows(
    {title:'Bilal Hasan Secures UFC Deal',url:'https://cffc.tv/news/2026/8/11/cffc-flyweight-champion-bilal-hasan-remains-undefeated-secures-ufc-deal',publishedAt:'2026-08-11'},
    source,
    'Bilal Hasan earned a UFC contract after his performance.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].reviewStatus,'pending');
});


test('historical seed articles are official first-party URLs and remain source scoped',()=>{
  const brave=bySlug('brave-cf-news'),cffc=bySlug('cffc-news'),oktagon=bySlug('oktagon-news');
  assert.ok(brave.seedArticles.length>=7);
  assert.ok(brave.seedArticles.every(row=>new URL(row.url).hostname==='www.bravecf.com'));
  assert.ok(cffc.seedArticles.every(row=>new URL(row.url).hostname==='cffc.tv'));
  assert.ok(oktagon.seedArticles.every(row=>new URL(row.url).hostname==='oktagonmma.com'));
});
