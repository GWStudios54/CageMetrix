import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='lfa-news');

test('wave 5 registers Legacy Fighting Alliance as a promotion-direct contract source',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Legacy Fighting Alliance');
  assert.equal(source.sourceType,'promotion_direct');
  assert.equal(source.promotionSlug,'lfa');
  assert.equal(source.kind,'html');
  assert.equal(source.host,'www.lfa.com');
  assert.equal(source.titleSignalOnly,true);
});

test('LFA listing accepts UFC call-up stories but rejects known site navigation and off-host links',()=>{
  const html=`
    <main>
      <a href="/news/">News</a>
      <a href="/events/">Events</a>
      <a href="/champions/">Champions</a>
      <a href="/watch-lfa/">Watch LFA</a>
      <a href="/lfafightnetwork/">LFA Fight Network</a>
      <a href="/media/">Media</a>
      <a href="/contact/">Contact</a>
      <article><a href="/kropschot-signs-with-the-ufc-after-lfa-title-run/">Kropschot Signs With The UFC After LFA Title Run</a></article>
      <article><a href="/budka-earns-ufc-contract-on-contender-series/">Budka Earns UFC Contract On Contender Series</a></article>
      <article><a href="/lfa-241-official-weigh-in-results/">LFA 241 Official Weigh In Results</a></article>
      <article><a href="https://example.com/fake-ufc-contract/">Fake Fighter Signs UFC Contract</a></article>
    </main>`;
  const rows=parseContractListing(html,source);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.title).sort(),['Budka Earns UFC Contract On Contender Series','Kropschot Signs With The UFC After LFA Title Run']);
  assert.ok(rows.every(row=>new URL(row.url).hostname==='www.lfa.com'));
});

test('an LFA-reported UFC signing queues a UFC candidate, crediting LFA only as the launching promotion',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'701',fighter_name:'Joe Kropschot'}];
  const rows=candidateRows(
    {title:'Kropschot Signs With The UFC After LFA Title Run',url:'https://www.lfa.com/kropschot-signs-with-the-ufc-after-lfa-title-run/',publishedAt:'2026-08-20'},
    source,
    'LFA middleweight champion Joe Kropschot has signed a contract with the UFC after his title-winning run.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Joe Kropschot');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'signing');
  assert.equal(rows[0].reviewStatus,'pending');
  assert.equal(detectContractPromotion('Joe Kropschot has signed a contract with the UFC.','lfa'),'ufc');
});
