import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COACH_DISCOVERY_SOURCES,coachCandidateRows,detectCoachEventType,detectCoachName,hasCoachSignal,parseCoachListing} from '../scripts/lib/coach-intel-discovery.mjs';

const source=COACH_DISCOVERY_SOURCES.find(row=>row.slug==='sherdog-coach-news');

test('registers Sherdog, UFC.com, BJPenn.com and MMA Mania as coach-intel sources (MMA Fighting was tried and dropped for camp/injury discovery)',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Sherdog');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.kind,'rss');

  const ufcSource=COACH_DISCOVERY_SOURCES.find(row=>row.slug==='ufc-news-coach');
  assert.ok(ufcSource);
  assert.equal(ufcSource.sourceType,'promotion_direct');
  assert.equal(ufcSource.kind,'html');

  const bjpenn=COACH_DISCOVERY_SOURCES.find(row=>row.slug==='bjpenn-coach-news');
  assert.ok(bjpenn);
  assert.equal(bjpenn.host,'www.bjpenn.com');

  const mmaMania=COACH_DISCOVERY_SOURCES.find(row=>row.slug==='mmamania-coach-news');
  assert.ok(mmaMania);
  assert.equal(mmaMania.host,'www.mmamania.com');

  assert.equal(COACH_DISCOVERY_SOURCES.find(row=>row.slug==='mmafighting-coach-news'),undefined);
});

test('real, verified coach-change headlines are recognized (Henry Cejudo/Eric Albarracin, Ilia Topuria)',()=>{
  // Verified against real reporting: "UFC news, rumors: Henry Cejudo parts with longtime coach" (CBS
  // Sports), body text "The former two-division champion handed longtime coach Eric Albarracin his
  // walking papers"; "Ilia Topuria splits from coaches in shock move ahead of UFC 317 title fight"
  // (Yahoo Sports/AOL).
  assert.equal(hasCoachSignal('UFC news, rumors: Henry Cejudo parts with longtime coach'),true);
  assert.equal(detectCoachEventType('Henry Cejudo parts with longtime coach Eric Albarracin'),'parted_ways');

  const full='The former two-division champion handed longtime coach Eric Albarracin his walking papers';
  assert.equal(hasCoachSignal(full),true);
  assert.equal(detectCoachEventType(full),'parted_ways');
  assert.equal(detectCoachName(full),'Eric Albarracin');

  assert.equal(hasCoachSignal('Ilia Topuria splits from coaches in shock move ahead of UFC 317 title fight'),true);
  assert.equal(detectCoachEventType('Ilia Topuria splits from coaches in shock move ahead of UFC 317 title fight'),'parted_ways');
});

test('unrelated fight-card and matchup news does not falsely trigger a coach signal',()=>{
  assert.equal(hasCoachSignal('UFC 331 fight card announced for September'),false);
  assert.equal(hasCoachSignal('Fighter X faces Fighter Y at UFC 400'),false);
});

test('detectCoachName returns null rather than guessing when no name follows "coach"',()=>{
  assert.equal(detectCoachName('The champion parts ways with his coach after a tough loss'),null);
  assert.equal(detectCoachName(''),null);
});

test('Sherdog RSS only surfaces same-host article links carrying a coach signal',()=>{
  const xml=`<?xml version="1.0"?><rss><channel>
    <item><title>Henry Cejudo Parts With Longtime Coach</title><link>https://www.sherdog.com/news/news/Cejudo-Coach-Split-115979</link><description>The former champion handed longtime coach Eric Albarracin his walking papers.</description><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>UFC 331 Fight Card Set</title><link>https://www.sherdog.com/news/news/UFC-331-Fight-Card-Set-999999</link><description>The full card for UFC 331 has been announced.</description></item>
    <item><title>Fighter Splits From Coach</title><link>https://example.com/fake</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseCoachListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Henry Cejudo Parts With Longtime Coach');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='www.sherdog.com'));
});

test('a coach-change story queues a candidate with exact identity',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'7001',fighter_name:'Henry Cejudo'}];
  const rows=coachCandidateRows(
    {title:'Henry Cejudo Parts With Longtime Coach',url:'https://www.sherdog.com/news/news/example',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'Henry Cejudo, the former two-division champion, handed longtime coach Eric Albarracin his walking papers.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Henry Cejudo');
  assert.equal(rows[0].detectedEventType,'parted_ways');
  assert.equal(rows[0].detectedCoachName,'Eric Albarracin');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('coach candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const rows=coachCandidateRows(
    {title:'x',url:'https://www.sherdog.com/news/news/x',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'Henry Cejudo parts with longtime coach Eric Albarracin.',
    [{source_key:'mma',source_fighter_id:'9',fighter_name:'Someone Else'}]
  );
  assert.equal(rows.length,0);
});

test('a comparison sentence does not falsely attribute a coach change to that fighter',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'7001',fighter_name:'Henry Cejudo'}];
  const rows=coachCandidateRows(
    {title:'x',url:'https://www.sherdog.com/news/news/y',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'The young prospect fights like a young Henry Cejudo, who parted with his coach years ago.',
    profiles
  );
  assert.equal(rows.length,0);
});

test('coach discovery runs on a schedule against production, same shape as camp/contract/injury/antidoping discovery, and only ever queues candidates',()=>{
  const workflow=fs.readFileSync('.github/workflows/coach-intel-discovery.yml','utf8');
  assert.match(workflow,/schedule:\s*\n\s*- cron: '\d/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/npx wrangler d1 migrations apply cagemetrix --remote/);
  assert.match(workflow,/node scripts\/discover-coach-intel\.mjs --remote/);
  assert.match(workflow,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  const discovery=fs.readFileSync('scripts/discover-coach-intel.mjs','utf8');
  assert.match(discovery,/INSERT OR IGNORE INTO coach_intel_candidates/);
  assert.doesNotMatch(discovery,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_coach_history/i);
});
