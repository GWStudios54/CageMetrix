import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {INJURY_DISCOVERY_SOURCES,detectInjuryEventType,hasInjurySignal,injuryCandidateRows,parseInjuryListing} from '../scripts/lib/injury-intel-discovery.mjs';

const source=INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='sherdog-injury-news');

test('registers Sherdog, UFC.com, BJPenn.com and MMA Mania as injury-intel sources, all reachable by the real fetch mechanism (MMA Fighting was tried and dropped)',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Sherdog');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.kind,'rss');

  const ufcSource=INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='ufc-news-injury');
  assert.ok(ufcSource);
  assert.equal(ufcSource.sourceType,'promotion_direct');
  assert.equal(ufcSource.kind,'html');

  const bjpenn=INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='bjpenn-injury-news');
  assert.ok(bjpenn);
  assert.equal(bjpenn.host,'www.bjpenn.com');

  const mmaMania=INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='mmamania-injury-news');
  assert.ok(mmaMania);
  assert.equal(mmaMania.host,'www.mmamania.com');

  assert.equal(INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='mmafighting-injury-news'),undefined);
});

test('registers LowKickMMA, MiddleEasy and Cageside Press as additional injury-intel sources, confirmed reachable by the real fetch mechanism (FightBookMMA was tried and dropped, see lib comment)',()=>{
  const lowkick=INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='lowkickmma-injury-news');
  assert.ok(lowkick);
  assert.equal(lowkick.host,'www.lowkickmma.com');
  assert.equal(lowkick.kind,'rss');

  const middleeasy=INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='middleeasy-injury-news');
  assert.ok(middleeasy);
  assert.equal(middleeasy.host,'middleeasy.com');
  assert.equal(middleeasy.contentSelector,'.elementor-widget-theme-post-content');

  const cageside=INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='cagesidepress-injury-news');
  assert.ok(cageside);
  assert.equal(cageside.host,'cagesidepress.com');

  assert.equal(INJURY_DISCOVERY_SOURCES.find(row=>row.slug==='fightbookmma-injury-news'),undefined);
});

test('real, verified withdrawal headlines are recognized (Brian Ortega/UFC 331, Deen The Great/Misfits)',()=>{
  assert.equal(hasInjurySignal('Brian Ortega releases statement after withdrawing from UFC 331 fight'),true);
  assert.equal(detectInjuryEventType('Brian Ortega releases statement after withdrawing from UFC 331 fight'),'withdrawal');

  assert.equal(hasInjurySignal('Brian Ortega shows cut that forced him out of UFC 331'),true);
  assert.equal(detectInjuryEventType('Brian Ortega shows cut that forced him out of UFC 331'),'withdrawal');

  assert.equal(hasInjurySignal('Henry Cejudo now faces undefeated MVP boxer at Misfits event after Deen The Great backs out'),true);
  assert.equal(detectInjuryEventType('Deen The Great backs out'),'withdrawal');
});

test('real, verified replacement headlines are recognized (Bogdan Guskov/Khalil Rountree, Joel Alvarez/Geoff Neal)',()=>{
  assert.equal(hasInjurySignal('Bogdan Guskov steps in on 12 days notice'),true);
  assert.equal(detectInjuryEventType('Bogdan Guskov steps in on 12 days notice'),'replacement_announced');

  assert.equal(hasInjurySignal('Joel Alvarez steps in on short notice for UFC 330 after Geoff Neal injury'),true);
  assert.equal(detectInjuryEventType('Joel Alvarez steps in on short notice for UFC 330 after Geoff Neal injury'),'replacement_announced');

  assert.equal(detectInjuryEventType('Bogdan Guskov replaces injured Khalil Rountree in UFC Abu Dhabi main event'),'replacement_announced');
});

test('real, verified clearance and injury-disclosure headlines are recognized (Tom Aspinall)',()=>{
  assert.equal(hasInjurySignal('Fighter X is medically cleared to return next month'),true);
  assert.equal(detectInjuryEventType('Fighter X is medically cleared to return next month'),'cleared_to_compete');

  // A negated clearance ("cannot get medically cleared") is a real, live headline shape (Tom Aspinall,
  // September 2026) and is still injury news -- it must not be misclassified as a positive clearance.
  assert.equal(hasInjurySignal('Tom Aspinall says he cannot get medically cleared to fight right now'),true);
  assert.equal(detectInjuryEventType('Tom Aspinall says he cannot get medically cleared to fight right now'),'injury_disclosed');

  assert.equal(hasInjurySignal("Tom Aspinall's UFC return hits medical roadblock due to eye injury"),true);
  assert.equal(detectInjuryEventType("Tom Aspinall's UFC return hits medical roadblock due to eye injury"),'injury_disclosed');
});

test('"pulls out a win" is a real, common MMA turn of phrase for a comeback result, not a withdrawal, and is excluded',()=>{
  assert.equal(hasInjurySignal('Alexander Volkanovski pulls out a win in the final round'),false);
  assert.equal(hasInjurySignal('The champion pulls out the victory after a late takedown'),false);
});

test('unrelated fight-card and matchup news does not falsely trigger an injury signal',()=>{
  assert.equal(hasInjurySignal('UFC 331 Fight Card Announced'),false);
  assert.equal(hasInjurySignal('Fighter X faces Fighter Y at UFC 400'),false);
});

test('Sherdog RSS only surfaces same-host article links carrying an injury signal',()=>{
  const xml=`<?xml version="1.0"?><rss><channel>
    <item><title>Brian Ortega Withdraws From UFC 331 Fight</title><link>https://www.sherdog.com/news/news/Brian-Ortega-Withdraws-115979</link><description>Ortega has pulled out due to a facial cut.</description><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>UFC 331 Fight Card Set</title><link>https://www.sherdog.com/news/news/UFC-331-Fight-Card-Set-999999</link><description>The full card for UFC 331 has been announced.</description></item>
    <item><title>Fighter Withdraws From Fight</title><link>https://example.com/fake</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseInjuryListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Brian Ortega Withdraws From UFC 331 Fight');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='www.sherdog.com'));
});

test('a withdrawal story queues a candidate with exact identity',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'7001',fighter_name:'Brian Ortega'}];
  const rows=injuryCandidateRows(
    {title:'Brian Ortega Withdraws From UFC 331 Fight',url:'https://www.sherdog.com/news/news/example',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'Brian Ortega has withdrawn from his UFC 331 bout after suffering a deep facial cut in training.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Brian Ortega');
  assert.equal(rows[0].detectedEventType,'withdrawal');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('injury candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const rows=injuryCandidateRows(
    {title:'x',url:'https://www.sherdog.com/news/news/x',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'Brian Ortega has withdrawn from his UFC 331 bout.',
    [{source_key:'mma',source_fighter_id:'9',fighter_name:'Someone Else'}]
  );
  assert.equal(rows.length,0);
});

test('a comparison sentence does not falsely attribute a withdrawal to that fighter',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'7001',fighter_name:'Brian Ortega'}];
  const rows=injuryCandidateRows(
    {title:'x',url:'https://www.sherdog.com/news/news/y',publishedAt:'2026-09-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'The young prospect fights like a young Brian Ortega, who withdrew from a title fight years ago.',
    profiles
  );
  assert.equal(rows.length,0);
});

test('injury discovery runs on a schedule against production, same shape as camp/contract/anti-doping discovery, and only ever queues candidates',()=>{
  const workflow=fs.readFileSync('.github/workflows/injury-intel-discovery.yml','utf8');
  assert.match(workflow,/schedule:\s*\n\s*- cron: '\d/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/npx wrangler d1 migrations apply cagemetrix --remote/);
  assert.match(workflow,/node scripts\/discover-injury-intel\.mjs --remote/);
  assert.match(workflow,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  const discovery=fs.readFileSync('scripts/discover-injury-intel.mjs','utf8');
  assert.match(discovery,/INSERT OR IGNORE INTO injury_intel_candidates/);
  assert.doesNotMatch(discovery,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_injury_events/i);
});

