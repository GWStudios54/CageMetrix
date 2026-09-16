import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,articleText,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const bySlug=slug=>CONTRACT_DISCOVERY_SOURCES.find(source=>source.slug===slug);

test('wave 2 registers Cage Warriors official news and Sherdog RSS as contract sources',()=>{
  const cageWarriors=bySlug('cage-warriors-news');
  const sherdog=bySlug('sherdog-news-rss');
  assert.ok(cageWarriors);
  assert.equal(cageWarriors.publisher,'Cage Warriors');
  assert.equal(cageWarriors.sourceType,'promotion_direct');
  assert.equal(cageWarriors.titleSignalOnly,true);
  assert.ok(sherdog);
  assert.equal(sherdog.publisher,'Sherdog');
  assert.equal(sherdog.sourceType,'reputable_trade_reporting');
  assert.equal(sherdog.kind,'rss');
});

test('Cage Warriors listing accepts contract-signing stories but rejects generic navigation and non-signal stories',()=>{
  const source=bySlug('cage-warriors-news');
  const html=`
    <main>
      <a href="/news/">News</a>
      <a href="/events/">Events</a>
      <article><a href="/adam-darby-secures-ufc-contract/">Adam Darby Secures UFC Contract</a><p>Official Cage Warriors update.</p></article>
      <article><a href="/sean-clancy-jr-secures-a-ufc-contract/">Sean Clancy Jr. Secures A UFC Contract</a></article>
      <article><a href="/cw-200-results/">Cage Warriors 200 Results</a><p>Another fighter later signed elsewhere.</p></article>
      <article><a href="https://example.com/fake-signing/">Fake Fighter Signs UFC Contract</a></article>
    </main>`;
  const rows=parseContractListing(html,source);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.title).sort(),['Adam Darby Secures UFC Contract','Sean Clancy Jr. Secures A UFC Contract']);
  assert.ok(rows.every(row=>new URL(row.url).hostname==='cagewarriors.com'));
});

test('Sherdog RSS only surfaces same-host news items with contract signals',()=>{
  const source=bySlug('sherdog-news-rss');
  const xml=`<?xml version="1.0"?><rss><channel>
    <item><title>Four fighters earn UFC contracts on Contender Series</title><link>https://www.sherdog.com/news/news/Four-Fighters-Earn-UFC-Contracts-200001</link><description>Four prospects secured UFC contracts.</description><pubDate>Wed, 09 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>Event results</title><link>https://www.sherdog.com/news/news/Event-Results-200002</link><description>Full results from the card.</description></item>
    <item><title>Fighter signs contract</title><link>https://example.com/news/news/Fake-200003</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Four fighters earn UFC contracts on Contender Series');
  assert.match(rows[0].url,/sherdog\.com\/news\/news\//);
});

test('contracting promotion is taken from evidence rather than publisher identity',()=>{
  assert.equal(detectContractPromotion('Adam Darby has signed with the UFC after his latest victory.','cage-warriors'),'ufc');
  assert.equal(detectContractPromotion('The promotion awarded Jane Doe a PFL contract after the bout.',null),'pfl');
  assert.equal(detectContractPromotion('Jane Doe signed a new Cage Warriors contract.',null),'cage-warriors');
  assert.equal(detectContractPromotion('Jane Doe signed a new contract after negotiations.','one'),'one');
});

test('Cage Warriors reporting about a UFC signing queues a UFC candidate, not a Cage Warriors contract',()=>{
  const source=bySlug('cage-warriors-news');
  const profiles=[{source_key:'mma',source_fighter_id:'501',fighter_name:'Adam Darby'}];
  const rows=candidateRows(
    {title:'Adam Darby Secures UFC Contract',url:'https://cagewarriors.com/adam-darby-secures-ufc-contract/',publishedAt:'2026-09-09'},
    source,
    'Adam Darby has signed with the UFC after securing a contract through Dana White’s Contender Series.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Adam Darby');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'signing');
  assert.equal(rows[0].reviewStatus,'pending');
});


test('Sherdog article extraction excludes related and latest story modules',()=>{
  const source=bySlug('sherdog-news-rss');
  const html='<main><article><div class="article"><div class="content body_content"><p>Christian Natividad earned a UFC contract.</p></div></div><div class="module_list_generic related_articles"><ul><li>Michael Page declines to re-sign</li></ul></div></article></main>';
  const body=articleText(html,source);
  assert.match(body,/Christian Natividad earned a UFC contract/);
  assert.doesNotMatch(body,/Michael Page declines to re-sign/);
});

test('credited relatives and proposed opponents do not inherit contract status',()=>{
  const source=bySlug('sherdog-news-rss');
  const profiles=['Christian Natividad','Kevin Natividad','Michael Page','Derek Brunson'].map((fighter_name,index)=>({source_key:'mma',source_fighter_id:String(index+1),fighter_name}));
  let rows=candidateRows({title:'Christian Natividad earns UFC contract',url:'https://www.sherdog.com/news/news/a'},source,'Christian Natividad credits Kevin Natividad after earning a UFC contract.',profiles);
  assert.deepEqual(rows.map(row=>row.fighterName),['Christian Natividad']);
  rows=candidateRows({title:'Michael Page exits UFC',url:'https://www.sherdog.com/news/news/b'},source,'Michael Page completes his UFC contract as Derek Brunson proposes a free-agent fight.',profiles);
  assert.deepEqual(rows.map(row=>row.fighterName),['Michael Page']);
  assert.equal(rows[0].detectedEventType,'expiration');
  assert.equal(rows[0].detectedStatus,'expired');
  assert.equal(rows[0].extractionMethod,'signal_block_scoped_subject_v4');
});

test('free-agent fight is not itself evidence of free agency',()=>{
  assert.equal(hasContractSignal('Derek Brunson proposes a free-agent fight'),false);
  assert.deepEqual(detectContractSignal('UFC declines to re-sign Michael Page'),{eventType:'status_update',status:'unknown'});
});

test('promotion attribution supports multi-fighter award sentences',()=>{
  assert.equal(detectContractPromotion('Dana White signs Christian Natividad, Martin Kozak, Isaac Moreno and Quentin Pasley to the UFC',null),'ufc');
});


test("a source-declared contentSelector scopes extraction to the real entry body, not article recirculation (MMA Fighting's own shape before it was dropped for a 403)",()=>{
  const source={contentSelector:'.duet--layout--entry-body'};
  const html='<article><div class="duet--layout--entry-body"><p>Christian Natividad earned a UFC contract.</p></div><div class="duet--layout--article-recirc"><p>Jake Paul shows interest in signing Michael Page.</p></div></article>';
  const body=articleText(html,source);
  assert.match(body,/Christian Natividad earned a UFC contract/);
  assert.doesNotMatch(body,/Michael Page/);
});

test('registers LowKickMMA, MiddleEasy and Cageside Press as additional contract-intel sources, and no longer registers the dropped MMA Fighting source',()=>{
  const lowkick=bySlug('lowkickmma-contract-news');
  assert.ok(lowkick);
  assert.equal(lowkick.host,'www.lowkickmma.com');
  assert.equal(lowkick.kind,'rss');

  const middleeasy=bySlug('middleeasy-contract-news');
  assert.ok(middleeasy);
  assert.equal(middleeasy.host,'middleeasy.com');
  assert.equal(middleeasy.contentSelector,'.elementor-widget-theme-post-content');

  const cageside=bySlug('cagesidepress-contract-news');
  assert.ok(cageside);
  assert.equal(cageside.host,'cagesidepress.com');

  assert.equal(bySlug('mma-fighting'),undefined);
});
