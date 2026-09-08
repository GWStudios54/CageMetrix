import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOBAL_EVENT_SOURCES } from '../scripts/lib/global-event-sources.mjs';
import { usableUpcomingEvents } from '../scripts/lib/global-event-calendar.mjs';
import { parseSpecialPromotion } from '../scripts/lib/global-event-special.mjs';

const now=new Date('2026-09-08T12:00:00Z');
const source=slug=>GLOBAL_EVENT_SOURCES.find(item=>item.slug===slug);

test('ONE upcoming template is parsed from official data timestamps without JavaScript',()=>{
  const html=`<template id="events-upcoming"><ul><li class="menu-item-card"><a href="https://www.onefc.com/events/one-friday-fights-170/"><div class="datetime" data-timestamp="1789126200"></div><div class="location">Lumpinee Stadium, Bangkok</div><span class="title">ONE Friday Fights 170 &amp; The Inner Circle 30</span></a></li></ul></template>`;
  const events=usableUpcomingEvents(parseSpecialPromotion(source('one'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].eventDate,'2026-09-11');
  assert.equal(events[0].startsAt,'2026-09-11T11:30:00.000Z');
  assert.equal(events[0].country,'Thailand');
  assert.match(events[0].sourceUrl,/one-friday-fights-170/);
});

test('KSW cards parse DD-MM-YYYY dates and physical venues',()=>{
  const html=`<a href="https://www.kswmma.com/en/event/xtb-ksw-121"><img alt="XTB KSW 121"><div class="row"><div class="col-sm-6 pt-2 ps-5 text-uppercase">XTB KSW 121</div><div class="col-sm-6 text-end pt-2 pe-5">19-09-2026</div></div><div class="row"><div class="col-sm-12 ps-5 text-uppercase"><h2>Vojčák <span>vs</span> Wójcik</h2></div></div><div class="row"><div class="col-sm-12 ps-5 text-uppercase">Home Credit Arena, Liberec</div></div></a>`;
  const events=usableUpcomingEvents(parseSpecialPromotion(source('ksw'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].eventDate,'2026-09-19');
  assert.equal(events[0].venue,'Home Credit Arena, Liberec');
  assert.equal(events[0].country,'Czech Republic');
});

test('OKTAGON future cards use subtitle date and arena fields',()=>{
  const html=`<div class="okt-future-events-card"><h2 class="okt-card-title">OKTAGON 93: ROUŠAL vs. MÅGÅRD</h2><span class="okt-card-subTitle">12.09.2026</span><span class="okt-card-subTitle">Winning Group Arena, Brno-město</span><a href="https://oktagonmma.com/en/events/oktagon-93/">Fightcard</a></div>`;
  const events=usableUpcomingEvents(parseSpecialPromotion(source('oktagon'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].eventDate,'2026-09-12');
  assert.match(events[0].venue,/Winning Group Arena/);
  assert.match(events[0].sourceUrl,/oktagon-93/);
});

test('Shooto schedule rows use row date, event label and venue',()=>{
  const html=`<div id="schedule"><div class="row list-block"><span class="result-list-day">2026-09-27</span><a href="./?id=255"><span class="result-list-subtitle">プロフェッショナル修斗公式戦</span><span class="result-list-title"> PROFESSIONAL SHOOTO 2026 Vol.6</span></a><span class="result-list-place">ニューピアホール</span></div></div>`;
  const events=usableUpcomingEvents(parseSpecialPromotion(source('shooto'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].eventDate,'2026-09-27');
  assert.equal(events[0].venue,'ニューピアホール');
  assert.equal(events[0].country,'Japan');
  assert.match(events[0].name,/PROFESSIONAL SHOOTO/i);
});
