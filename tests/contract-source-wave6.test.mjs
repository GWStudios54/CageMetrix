import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='tuff-n-uff-rss');

test('wave 6 registers Tuff-N-Uff as an RSS-based promotion-direct contract source',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Tuff-N-Uff');
  assert.equal(source.sourceType,'promotion_direct');
  assert.equal(source.promotionSlug,'tuff-n-uff');
  assert.equal(source.kind,'rss');
  assert.equal(source.host,'tuffnuff.com');
});

test('Tuff-N-Uff RSS only surfaces same-host, dated article links with a contract signal',()=>{
  const xml=`<?xml version="1.0"?><rss><channel>
    <item><title>Eric McConico Signs With The UFC After Tuff-N-Uff Run</title><link>https://tuffnuff.com/2026/02/14/mcconico-signs-with-the-ufc/</link><description>Three-time Tuff-N-Uff veteran Eric McConico has signed a UFC contract.</description><pubDate>Fri, 14 Feb 2026 10:00:00 GMT</pubDate></item>
    <item><title>Tuff-N-Uff 157</title><link>https://tuffnuff.com/2026/09/04/tuff-n-uff-157/</link><description>Championship fights headline the next card.</description></item>
    <item><title>Fighter signs UFC contract</title><link>https://example.com/2026/02/14/fake/</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Eric McConico Signs With The UFC After Tuff-N-Uff Run');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='tuffnuff.com'));
});

test('a Tuff-N-Uff-reported UFC signing queues a UFC candidate, crediting Tuff-N-Uff only as the launching promotion',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'801',fighter_name:'Eric McConico'}];
  const rows=candidateRows(
    {title:'Eric McConico Signs With The UFC After Tuff-N-Uff Run',url:'https://tuffnuff.com/2026/02/14/mcconico-signs-with-the-ufc/',publishedAt:'2026-02-14'},
    source,
    'Three-time Tuff-N-Uff veteran Eric McConico has signed a contract with the UFC on a five-fight win streak.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Eric McConico');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'signing');
  assert.equal(rows[0].reviewStatus,'pending');
  assert.equal(detectContractPromotion('Eric McConico has signed a contract with the UFC.','tuff-n-uff'),'ufc');
});
