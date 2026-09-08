import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GLOBAL_EVENT_SOURCES, dateFromText, eventDetailUrls, eventSlug, parseOneEvents, parsePromotionEvents } from '../scripts/lib/global-event-sources.mjs';
import { usableUpcomingEvents } from '../scripts/lib/global-event-calendar.mjs';

const now=new Date('2026-09-08T12:00:00Z');
const source=slug=>GLOBAL_EVENT_SOURCES.find(item=>item.slug===slug);

test('every registered regional promotion has an official event source',()=>{
  const registry=JSON.parse(fs.readFileSync('scripts/data/scout-promotions.json','utf8'));
  const registered=registry.map(item=>item.slug).sort();
  const sourced=GLOBAL_EVENT_SOURCES.map(item=>item.slug).sort();
  assert.deepEqual(sourced,registered);
  assert.equal(new Set(sourced).size,sourced.length);
});

test('date parser handles international promotion calendar formats',()=>{
  assert.equal(dateFromText('Friday, September 11th, 2026',now),'2026-09-11');
  assert.equal(dateFromText('12.09.2026 Winning Group Arena',now),'2026-09-12');
  assert.equal(dateFromText('25/09/2026 ARES 43',now),'2026-09-25');
  assert.equal(dateFromText('2026-10-10 19:00:00',now),'2026-10-10');
  assert.equal(dateFromText('2026年9月13日（日）',now),'2026-09-13');
  assert.equal(dateFromText('2026년 10월 25일',now),'2026-10-25');
  assert.equal(dateFromText('PANCRASE 367：10.4 ニューピアホール',now),'2026-10-04');
  assert.equal(dateFromText('Sat, Dec 19',now),'2026-12-19');
});

test('LFA-style calendar card resolves event date and venue',()=>{
  const html=`<article><time>September 11</time><h3><a href="/event/lfa-241/">LFA 241 – Pires vs. Pereira</a></h3><address>GINÁSIO MINEIRINHO</address><p>September 11, 2026</p></article>`;
  const events=usableUpcomingEvents(parsePromotionEvents(source('lfa'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].eventDate,'2026-09-11');
  assert.match(events[0].venue,/MINEIRINHO/i);
  assert.match(events[0].sourceUrl,/^https:\/\/www\.lfa\.com\//);
});

test('OKTAGON-style compact card resolves date and arena',()=>{
  const html=`<section><h2>OKTAGON 93: ROUŠAL vs. MÅGÅRD</h2><p>12.09.2026 Winning Group Arena, Brno-město</p><a href="/en/events/oktagon-93/">Fightcard</a></section>`;
  const events=usableUpcomingEvents(parsePromotionEvents(source('oktagon'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].eventDate,'2026-09-12');
  assert.match(events[0].venue,/Winning Group Arena/i);
});

test('KSW-style calendar resolves scheduled gala',()=>{
  const html=`<article><h3><a href="/en/gala/xtb-ksw-121">XTB KSW 121</a></h3><p>2026-09-19 19:00:00</p><address>Home Credit Arena, Liberec</address></article>`;
  const events=usableUpcomingEvents(parsePromotionEvents(source('ksw'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].eventDate,'2026-09-19');
  assert.match(events[0].venue,/Home Credit Arena/i);
});

test('ONE live schedule joins official venue listing',()=>{
  const listing=`<section><h3>ONE Friday Fights 170 &amp; The Inner Circle 30</h3><address>Lumpinee Stadium, Bangkok</address></section><section><h3>ONE SAMURAI 3</h3><address>Yokohama Buntai, Yokohama</address></section>`;
  const live=`<section><h2>The Inner Circle 30</h2><p>Friday, Sep 11, 11:30 AM UTC</p></section><section><h2>ONE Samurai 3</h2><p>Saturday, Sep 12, 8:30 AM UTC</p></section>`;
  const events=usableUpcomingEvents(parseOneEvents(listing,live,now),now);
  assert.equal(events.length,2);
  const inner=events.find(event=>/Inner Circle 30/.test(event.name));
  assert.equal(inner.eventDate,'2026-09-11');
  assert.equal(inner.startsAt,'2026-09-11T11:30:00Z');
  assert.match(inner.venue,/Lumpinee/i);
});

test('CFFC non-MMA BJJ cards are excluded',()=>{
  const html=`<section><h3>CFFC BJJ 18</h3><p>October 2, 2026</p><p>Philadelphia, PA</p></section><section><h3>CFFC 161</h3><p>September 11th, 2026</p><p>Rockford, IL</p></section>`;
  const events=usableUpcomingEvents(parsePromotionEvents(source('cffc'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].name,'CFFC 161');
  assert.equal(events[0].country,'United States');
});

test('new North American sources parse Tuff-N-Uff and ACA-style cards',()=>{
  const tuff=`<article><h2>Tuff-N-Uff 157</h2><p>Friday, September 25, 2026</p><address>THE Pool, Las Vegas, NV</address></article>`;
  const tuffEvents=usableUpcomingEvents(parsePromotionEvents(source('tuff-n-uff'),tuff,now),now);
  assert.equal(tuffEvents.length,1);
  assert.equal(tuffEvents[0].eventDate,'2026-09-25');
  assert.equal(tuffEvents[0].country,'United States');

  const aca=`<section><h2>ACA 207 Goncharov vs Almeida</h2><p>Krasnodar</p><p>September 12, 2026 | 3:00 pm</p></section>`;
  const acaEvents=usableUpcomingEvents(parsePromotionEvents(source('aca'),aca,now),now);
  assert.equal(acaEvents.length,1);
  assert.equal(acaEvents[0].venue,'Krasnodar');
  assert.equal(acaEvents[0].country,'Russia');
});

test('ARES dates are parsed but cards stay unpublished until a physical venue is known',()=>{
  const html=`<section><p>Upcoming event</p><p>25/09/2026</p><h2>ARES 43</h2><a href="?competition=3277">Fight Card</a></section>`;
  const parsed=parsePromotionEvents(source('ares'),html,now);
  assert.ok(parsed.some(event=>event.name==='ARES 43'&&event.eventDate==='2026-09-25'));
  assert.equal(usableUpcomingEvents(parsed,now).length,0);
});

test('Japanese and Korean calendar layouts resolve real physical venues',()=>{
  const grachan=`<table><tr><th>大会名</th><th>日程</th><th>場所</th></tr><tr><td>GRACHAN85</td><td>9月13日（日）</td><td>福岡・アクロス福岡</td></tr></table>`;
  const grachanEvents=usableUpcomingEvents(parsePromotionEvents(source('grachan'),grachan,now),now);
  assert.equal(grachanEvents.length,1);
  assert.equal(grachanEvents[0].eventDate,'2026-09-13');
  assert.equal(grachanEvents[0].city,'福岡');
  assert.equal(grachanEvents[0].venue,'アクロス福岡');

  const black=`<article><h3>블랙컵 결승: 대한민국 vs 일본</h3><p>2026년 10월 25일</p><p>서울시 송파구 학생체육관</p></article>`;
  const blackEvents=usableUpcomingEvents(parsePromotionEvents(source('black-combat'),black,now),now);
  assert.equal(blackEvents.length,1);
  assert.equal(blackEvents[0].eventDate,'2026-10-25');
  assert.equal(blackEvents[0].country,'South Korea');
});

test('Shooto schedule rows become stable dated events',()=>{
  const html=`<section><p>2026-09-27</p><p><a href="/schedule/?id=255">プロフェッショナル修斗公式戦 PROFESSIONAL SHOOTO 2026 Vol.6</a></p><p>ニューピアホール</p></section>`;
  const events=usableUpcomingEvents(parsePromotionEvents(source('shooto'),html,now),now);
  assert.equal(events.length,1);
  assert.equal(events[0].eventDate,'2026-09-27');
  assert.match(events[0].name,/PROFESSIONAL SHOOTO/i);
  assert.match(events[0].venue,/ニューピアホール/);
  assert.match(events[0].sourceUrl,/id=255/);
});

test('detail-driven Japanese calendars use event pages instead of nearby news dates',()=>{
  const deepSource=source('deep');
  const deepListing=`<main><a href="/deep-133-impact/">DEEP 133 IMPACT</a><p>NEWS 2026/09/07</p></main>`;
  const deepUrls=eventDetailUrls(deepSource,deepListing);
  assert.deepEqual(deepUrls,['https://www.deep2001.com/deep-133-impact/']);
  const deepDetail=`<main><h1>DEEP 133 IMPACT</h1><p>2026年9月13日（日）に開催</p><p>●会場：後楽園ホール</p></main>`;
  const deepEvents=usableUpcomingEvents(parsePromotionEvents({...deepSource,url:deepUrls[0],detailUrlPattern:null},deepDetail,now),now);
  assert.equal(deepEvents.length,1);
  assert.equal(deepEvents[0].eventDate,'2026-09-13');
  assert.equal(deepEvents[0].venue,'後楽園ホール');

  const panSource=source('pancrase');
  const panListing=`<nav><a href="/tour/2026/pancrase366/index.html">9.23 立川</a></nav>`;
  const panUrls=eventDetailUrls(panSource,panListing);
  assert.deepEqual(panUrls,['https://www.pancrase.co.jp/tour/2026/pancrase366/index.html']);
  const panDetail=`<main><h1>PANCRASE 366</h1><p>日時：9月23日(水)</p><p>会場：立川ステージガーデン</p></main>`;
  const panEvents=usableUpcomingEvents(parsePromotionEvents({...panSource,url:panUrls[0],detailUrlPattern:null},panDetail,now),now);
  assert.equal(panEvents.length,1);
  assert.equal(panEvents[0].eventDate,'2026-09-23');
  assert.equal(panEvents[0].venue,'立川ステージガーデン');
});

test('event slugs are stable and promotion-scoped',()=>{
  assert.equal(eventSlug({promotionSlug:'rizin',name:'SUPER RIZIN.5',eventDate:'2026-09-10'}),'rizin-super-rizin-5-2026-09-10');
});
