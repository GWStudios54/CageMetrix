import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOBAL_EVENT_SOURCES } from '../scripts/lib/global-event-sources.mjs';
import { usableUpcomingEvents } from '../scripts/lib/global-event-calendar.mjs';
import { parseSpecialPromotion } from '../scripts/lib/global-event-special.mjs';
import { parseExtendedPromotion } from '../scripts/lib/global-event-special-extended.mjs';

const now=new Date('2026-09-08T12:00:00Z');
const source=slug=>GLOBAL_EVENT_SOURCES.find(item=>item.slug===slug);

test('LFA official JSON-LD preserves country and canonical event URL',()=>{
  const html=`<script type="application/ld+json">[{"@context":"https://schema.org","@type":"Event","name":"LFA 241 &#8211; Pires vs. Pereira","startDate":"2026-09-11T00:00:00-07:00","url":"/event/lfa-241/","location":{"@type":"Place","name":"GINÁSIO MINEIRINHO","address":{"@type":"PostalAddress","addressCountry":"Brazil"}}}]</script>`;
  const events=usableUpcomingEvents(parseSpecialPromotion(source('lfa'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].name,'LFA 241 – Pires vs. Pereira');
  assert.equal(events[0].country,'Brazil');
  assert.equal(events[0].sourceUrl,'https://www.lfa.com/event/lfa-241/');
});

test('relative official links are normalized for CFFC, FNC and Shooto',()=>{
  const cffc=`<div class="sqs-col-6"><h2>Friday, September 11th, 2026 Rockford, IL</h2><h3>CFFC 161</h3><a href="/tickets/cage-fury-161-september-11-2026-hard-rock-live-casino-rockford-illinois-mma-fights-show-event-tickets">Tickets</a></div>`;
  const cffcEvents=usableUpcomingEvents(parseSpecialPromotion(source('cffc'),cffc,now),now);
  assert.equal(cffcEvents.length,1);
  assert.match(cffcEvents[0].sourceUrl,/^https:\/\/cffc\.tv\/tickets\//);

  const fnc=`<section class="upcomingEvent"><div class="fight-details"><div class="title-wrap"><h2>FNC 33 POWERED BY SUPERSPORT | ZAGREB</h2><p>September 12, 2026</p></div></div><a href="/en/event/fnc-33-powered-by-supersport-zagreb/">Event</a></section><p>FNC is coming to Arena Zagreb on September 12.</p>`;
  const fncEvents=usableUpcomingEvents(parseSpecialPromotion(source('fnc'),fnc,now),now);
  assert.equal(fncEvents.length,1);
  assert.equal(fncEvents[0].sourceUrl,'https://www.fnc.hr/en/event/fnc-33-powered-by-supersport-zagreb/');

  const shooto=`<div id="schedule"><div class="row list-block"><span class="result-list-day">2026-10-19</span><a href="./?id=287"><span class="result-list-title">PROFESSIONAL SHOOTO 2026 Vol.7</span></a><span class="result-list-place">後楽園ホール (</span></div></div>`;
  const shootoEvents=usableUpcomingEvents(parseSpecialPromotion(source('shooto'),shooto,now),now);
  assert.equal(shootoEvents.length,1);
  assert.equal(shootoEvents[0].venue,'後楽園ホール');
  assert.equal(shootoEvents[0].sourceUrl,'https://www.shooto-mma.com/schedule/?id=287');
});

test('OKTAGON venue geography supplies country for rich event locations',()=>{
  const html=`<div class="okt-future-events-card"><h2 class="okt-card-title">OKTAGON 94: ECKERLIN VS. KOZMA</h2><span class="okt-card-subTitle">26.09.2026</span><span class="okt-card-subTitle">Deutsche Bank Park, Frankfurt am Main</span><a href="/en/events/oktagon-94/">Fightcard</a></div>`;
  const events=usableUpcomingEvents(parseSpecialPromotion(source('oktagon'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].country,'Germany');
  assert.equal(events[0].sourceUrl,'https://oktagonmma.com/en/events/oktagon-94/');
});

test('DEEP detail parser emits the event heading once and ignores bout labels',()=>{
  const deepSource={...source('deep'),url:'https://www.deep2001.com/deep-133-impact/',detailUrlPattern:null};
  const html=`<main><h1>DEEP 133 IMPACT</h1><p>2026年9月13日（日）に後楽園ホールで開催する『宗明建設Presents DEEP 133 IMPACT』の大会概要となります。</p><h2>決定対戦カード</h2><p>DEEP 63kg以下 5分2R</p><p>DEEPフェザー級 5分2R</p></main>`;
  const events=usableUpcomingEvents(parseExtendedPromotion(deepSource,html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].name,'DEEP 133 IMPACT');
  assert.equal(events[0].venue,'後楽園ホール');
  assert.equal(events[0].country,'Japan');
});
