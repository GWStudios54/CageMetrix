import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMP_DISCOVERY_SOURCES,campCandidateRows,detectCamp,detectCampEventType,hasCampSignal,parseCampListing} from '../scripts/lib/camp-intel-discovery.mjs';

const source=CAMP_DISCOVERY_SOURCES.find(row=>row.slug==='sherdog-camp-news');

test('registers Sherdog and UFC.com as the camp-intel discovery sources, both reachable by the real fetch mechanism',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Sherdog');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.kind,'rss');
  assert.equal(source.host,'www.sherdog.com');

  const ufcSource=CAMP_DISCOVERY_SOURCES.find(row=>row.slug==='ufc-news-camp');
  assert.ok(ufcSource);
  assert.equal(ufcSource.publisher,'UFC');
  assert.equal(ufcSource.sourceType,'promotion_direct');
  assert.equal(ufcSource.kind,'html');
  assert.equal(ufcSource.host,'www.ufc.com');
});

test('a UFC.com camp-joining story queues a candidate with exact identity, same as Sherdog',()=>{
  const ufcSource=CAMP_DISCOVERY_SOURCES.find(row=>row.slug==='ufc-news-camp');
  const html='<main><article><a href="https://www.ufc.com/news/kyoji-horiguchi-joins-american-top-team">Kyoji Horiguchi Joins American Top Team Ahead Of Title Push</a></article><article><a href="https://www.ufc.com/news/ufc-331-fight-card">UFC 331 Fight Card Announced</a></article></main>';
  const rows=parseCampListing(html,ufcSource);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Kyoji Horiguchi Joins American Top Team Ahead Of Title Push');

  const profiles=[{source_key:'mma',source_fighter_id:'7001',fighter_name:'Kyoji Horiguchi'}];
  const candidates=campCandidateRows(
    {title:'Kyoji Horiguchi Joins American Top Team Ahead Of Title Push',url:'https://www.ufc.com/news/kyoji-horiguchi-joins-american-top-team',publishedAt:'2026-09-15'},
    ufcSource,
    'Flyweight contender Kyoji Horiguchi has officially joined American Top Team as he prepares for his next title opportunity.',
    profiles
  );
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].fighterName,'Kyoji Horiguchi');
  assert.equal(candidates[0].campSlug,'american-top-team');
  assert.equal(candidates[0].detectedEventType,'joined');
  assert.equal(candidates[0].reviewStatus,'pending');
});

test('real, verified camp-departure headlines are recognized (Nunes, Covington, Lawler all leaving American Top Team)',()=>{
  assert.equal(hasCampSignal('UFC Featherweight Champ Amanda Nunes Parts Ways with American Top Team'),true);
  assert.equal(detectCampEventType('UFC Featherweight Champ Amanda Nunes Parts Ways with American Top Team'),'left');
  assert.equal(detectCamp('UFC Featherweight Champ Amanda Nunes Parts Ways with American Top Team'),'american-top-team');

  assert.equal(hasCampSignal('UFC Welterweight Colby Covington Confirms Departure from American Top Team'),true);
  assert.equal(detectCampEventType('UFC Welterweight Colby Covington Confirms Departure from American Top Team'),'left');
  assert.equal(detectCamp('UFC Welterweight Colby Covington Confirms Departure from American Top Team'),'american-top-team');

  assert.equal(hasCampSignal('Former UFC Welterweight Champ Robbie Lawler Leaves American Top Team'),true);
  assert.equal(detectCampEventType('Former UFC Welterweight Champ Robbie Lawler Leaves American Top Team'),'left');
});

test('real, verified camp-joining headlines are recognized (Horiguchi, Barboza, Tuivasa all joining American Top Team)',()=>{
  assert.equal(hasCampSignal('UFC Flyweight Contender Kyoji Horiguchi Moves to US, Joins American Top Team'),true);
  assert.equal(detectCampEventType('UFC Flyweight Contender Kyoji Horiguchi Moves to US, Joins American Top Team'),'joined');
  assert.equal(detectCamp('UFC Flyweight Contender Kyoji Horiguchi Moves to US, Joins American Top Team'),'american-top-team');

  assert.equal(hasCampSignal('UFC Lightweight Edson Barboza Announces Move To Florida and American Top Team'),true);
  assert.equal(detectCampEventType('UFC Lightweight Edson Barboza Announces Move To Florida and American Top Team'),'joined');

  assert.equal(hasCampSignal('Tai Tuivasa joins American Top Team amid seven-fight skid'),true);
  assert.equal(detectCamp('Tai Tuivasa joins American Top Team amid seven-fight skid'),'american-top-team');
});

test('the ATT abbreviation resolves to the same camp as the full name, matching real usage',()=>{
  assert.equal(detectCamp('Tuivasa says he is now training at ATT full time'),'american-top-team');
});

test('unrelated fight-card and matchup news does not falsely trigger a camp signal',()=>{
  assert.equal(hasCampSignal('UFC 331 fight card announced for September'),false);
  assert.equal(hasCampSignal('Fighter X faces Fighter Y at UFC 400'),false);
});

test('a comparison sentence ("fights like a young X") does not falsely attribute a camp change to that fighter',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'7001',fighter_name:'Kyoji Horiguchi'}];
  const rows=campCandidateRows(
    {title:'x',url:'https://www.sherdog.com/news/news/y',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'The young prospect fights like a young Kyoji Horiguchi, who joined American Top Team years ago.',
    profiles
  );
  assert.equal(rows.length,0);
});

test('Sherdog RSS only surfaces same-host article links carrying a camp-change signal',()=>{
  const xml=`<?xml version="1.0"?><rss><channel>
    <item><title>Former UFC Welterweight Champ Robbie Lawler Leaves American Top Team</title><link>https://www.sherdog.com/news/news/Robbie-Lawler-Leaves-ATT-115979</link><description>Lawler has parted ways with the Coconut Creek, Fla. camp after years of training there.</description><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>UFC 331 Fight Card Set</title><link>https://www.sherdog.com/news/news/UFC-331-Fight-Card-Set-999999</link><description>The full card for UFC 331 has been announced.</description></item>
    <item><title>Fighter Leaves American Top Team</title><link>https://example.com/fake</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseCampListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Former UFC Welterweight Champ Robbie Lawler Leaves American Top Team');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='www.sherdog.com'));
});

test('a camp-change story queues a candidate with exact identity and a resolved camp slug',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'7001',fighter_name:'Kyoji Horiguchi'}];
  const rows=campCandidateRows(
    {title:'UFC Flyweight Contender Kyoji Horiguchi Moves to US, Joins American Top Team',url:'https://www.sherdog.com/news/news/example',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'Flyweight contender Kyoji Horiguchi has relocated to South Florida and joined American Top Team, an unprecedented move for a fighter of his stature in Japan.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Kyoji Horiguchi');
  assert.equal(rows[0].campSlug,'american-top-team');
  assert.equal(rows[0].detectedEventType,'joined');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('camp candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const rows=campCandidateRows(
    {title:'x',url:'https://www.sherdog.com/news/news/x',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'Kyoji Horiguchi joined American Top Team.',
    [{source_key:'mma',source_fighter_id:'9',fighter_name:'Someone Else'}]
  );
  assert.equal(rows.length,0);
});

test('a block that mentions a fighter but no identifiable camp produces no candidate, rather than guessing',()=>{
  // "no fuzzy matching" extends to camps too: if we can't confidently identify which camp, we don't
  // record a candidate with a null camp -- unlike a contract event, a camp-change candidate with no
  // camp identified isn't a useful lead at all.
  const rows=campCandidateRows(
    {title:'x',url:'https://www.sherdog.com/news/news/x',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'Kyoji Horiguchi joined a new gym this week, according to a source close to the fighter.',
    [{source_key:'mma',source_fighter_id:'7001',fighter_name:'Kyoji Horiguchi'}]
  );
  assert.equal(rows.length,0);
});
