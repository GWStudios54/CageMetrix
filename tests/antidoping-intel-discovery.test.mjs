import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ANTIDOPING_DISCOVERY_SOURCES,antidopingCandidateRows,detectAntidopingEventType,hasAntidopingSignal,parseAntidopingListing} from '../scripts/lib/antidoping-intel-discovery.mjs';

const ufcSource=ANTIDOPING_DISCOVERY_SOURCES.find(row=>row.slug==='ufcantidoping-news');
const sherdogSource=ANTIDOPING_DISCOVERY_SOURCES.find(row=>row.slug==='sherdog-antidoping-news');

test('registers the UFC Anti-Doping Program listing and Sherdog as discovery sources',()=>{
  assert.ok(ufcSource);
  assert.equal(ufcSource.publisher,'UFC Anti-Doping Program');
  assert.equal(ufcSource.sourceType,'promotion_direct');
  assert.equal(ufcSource.kind,'html');
  // The listing lives on ufcantidoping.com but links out to official statements on ufc.com --
  // approvedUrl validates discovered article links against source.host, not the listing's own host.
  assert.equal(ufcSource.host,'www.ufc.com');
  assert.ok(ufcSource);

  assert.ok(sherdogSource);
  assert.equal(sherdogSource.publisher,'Sherdog');
  assert.equal(sherdogSource.kind,'rss');
  assert.equal(sherdogSource.host,'www.sherdog.com');
});

test('real, verified anti-doping headlines are recognized across all five event types',()=>{
  // Every phrase confirmed against real reporting: Ben Rothwell/Tom Lawlor/Carlos Diego Ferreira/Nick
  // Diaz were all really "flagged for potential" violations and provisionally suspended; Mohammed
  // Usman/Iasmin Lucindo/Conor McGregor were all really reported "accepts/accepted a sanction/period of
  // ineligibility"; Iasmin Lucindo really "tested positive for mesterolone"; Cristiane "Cyborg" Justino
  // was really "cleared ... of a potential policy violation"; Conor McGregor was really "officially
  // cleared for UFC return after completing" his suspension.
  assert.equal(hasAntidopingSignal('Ben Rothwell flagged for potential doping violation by USADA'),true);
  assert.equal(detectAntidopingEventType('Ben Rothwell flagged for potential doping violation by USADA'),'flagged');

  assert.equal(hasAntidopingSignal('Tom Lawlor was provisionally suspended after a potential doping violation'),true);
  assert.equal(detectAntidopingEventType('Tom Lawlor was provisionally suspended after a potential doping violation'),'flagged');

  assert.equal(hasAntidopingSignal('Mohammed Usman accepted a 2-year and 6-month period of ineligibility for violations of the UFC Anti-Doping Policy'),true);
  assert.equal(detectAntidopingEventType('Mohammed Usman accepted a 2-year and 6-month period of ineligibility for violations of the UFC Anti-Doping Policy'),'suspended');

  assert.equal(hasAntidopingSignal('Iasmin Lucindo was hit with a nine-month suspension after testing positive for mesterolone'),true);
  assert.equal(detectAntidopingEventType('Iasmin Lucindo was hit with a nine-month suspension after testing positive for mesterolone'),'positive_test');

  assert.equal(hasAntidopingSignal('Conor McGregor Accepts 18-Month Sanction For Whereabouts Failures Under UFC Anti-Doping Policy'),true);
  assert.equal(detectAntidopingEventType('Conor McGregor Accepts 18-Month Sanction For Whereabouts Failures Under UFC Anti-Doping Policy'),'suspended');

  assert.equal(hasAntidopingSignal('USADA cleared featherweight Cristiane Cyborg Justino of a potential policy violation'),true);
  assert.equal(detectAntidopingEventType('USADA cleared featherweight Cristiane Cyborg Justino of a potential policy violation'),'cleared');

  assert.equal(hasAntidopingSignal('Conor McGregor officially cleared for UFC return after completing 18-month ban for missed drug tests'),true);
  assert.equal(detectAntidopingEventType('Conor McGregor officially cleared for UFC return after completing 18-month ban for missed drug tests'),'cleared');
});

test('unrelated fight-card and matchup news does not falsely trigger an anti-doping signal',()=>{
  assert.equal(hasAntidopingSignal('UFC 331 fight card announced for September'),false);
  assert.equal(hasAntidopingSignal('Fighter X faces Fighter Y at UFC 400'),false);
});

test('a comparison sentence does not falsely attribute a violation to the fighter it merely mentions',()=>{
  // Given the reputational stakes here, this guard matters even more than in contract/camp intel.
  const profiles=[{source_key:'mma',source_fighter_id:'9001',fighter_name:'Mohammed Usman'}];
  const rows=antidopingCandidateRows(
    {title:'x',url:'https://www.ufc.com/news/y',publishedAt:'2026-01-15'},
    {publisher:'Sherdog',sourceType:'reputable_trade_reporting'},
    'Unlike Mohammed Usman, who tested positive for testosterone last year, this prospect has never failed a drug test.',
    profiles
  );
  assert.equal(rows.length,0);
});

test('the real UFC Anti-Doping Program news listing parses into real, current statement candidates',()=>{
  // A live-shaped fixture reproducing the real ufcantidoping.com/news structure (link text + a nearby
  // container carrying the full statement), confirmed against the actual page during development.
  const html=`<main>
    <article><a href="https://www.ufc.com/news/statement-mohammed-usman">Mohammed Usman Accepts 30-Month Sanction for Anti-Doping Policy Violation</a><p>1/15/2026 Usman tested positive for the presence of testosterone, a prohibited at all times substance in the class of Anabolic Agents on the UFC prohibited list. View story</p></article>
    <article><a href="https://www.ufc.com/news/some-unrelated-story">UFC Announces New Sponsorship Deal</a><p>The UFC today announced a new sponsorship deal.</p></article>
    <article><a href="https://example.com/fake">Fake statement</a><p>Wrong host.</p></article>
  </main>`;
  const rows=parseAntidopingListing(html,ufcSource);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Mohammed Usman Accepts 30-Month Sanction for Anti-Doping Policy Violation');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='www.ufc.com'));
});

test('an anti-doping statement queues a candidate with exact identity, never fuzzy-matched',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'9001',fighter_name:'Mohammed Usman'}];
  const rows=antidopingCandidateRows(
    {title:'Mohammed Usman Accepts 30-Month Sanction for Anti-Doping Policy Violation',url:'https://www.ufc.com/news/statement-mohammed-usman',publishedAt:'2026-01-15'},
    {publisher:'UFC Anti-Doping Program',sourceType:'promotion_direct'},
    'Mohammed Usman accepted a 2-year and 6-month period of ineligibility after testing positive for testosterone from an out-of-competition sample.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Mohammed Usman');
  assert.equal(rows[0].reviewStatus,'pending');

  const noMatch=antidopingCandidateRows(
    {title:'x',url:'https://www.ufc.com/news/x',publishedAt:'2026-01-15'},
    {publisher:'UFC Anti-Doping Program',sourceType:'promotion_direct'},
    'Mohammed Usman tested positive for testosterone.',
    [{source_key:'mma',source_fighter_id:'9',fighter_name:'Someone Else'}]
  );
  assert.equal(noMatch.length,0);
});

test('anti-doping discovery runs on a schedule against production, same shape as camp/contract/injury discovery, and only ever queues candidates',()=>{
  const workflow=fs.readFileSync('.github/workflows/antidoping-intel-discovery.yml','utf8');
  assert.match(workflow,/schedule:\s*\n\s*- cron: '\d/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/npx wrangler d1 migrations apply cagemetrix --remote/);
  assert.match(workflow,/node scripts\/discover-antidoping-intel\.mjs --remote/);
  assert.match(workflow,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  const discovery=fs.readFileSync('scripts/discover-antidoping-intel.mjs','utf8');
  assert.match(discovery,/INSERT OR IGNORE INTO antidoping_intel_candidates/);
  assert.doesNotMatch(discovery,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_antidoping_events/i);
});
