import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOBAL_EVENT_SOURCES, dateFromText, eventSlug, parseOneEvents, parsePromotionEvents } from '../scripts/lib/global-event-sources.mjs';
import { usableUpcomingEvents } from '../scripts/lib/global-event-calendar.mjs';

const now=new Date('2026-09-08T12:00:00Z');
const source=slug=>GLOBAL_EVENT_SOURCES.find(item=>item.slug===slug);

test('date parser handles promotion calendar formats',()=>{
  assert.equal(dateFromText('Friday, September 11th, 2026',now),'2026-09-11');
  assert.equal(dateFromText('12.09.2026 Winning Group Arena',now),'2026-09-12');
  assert.equal(dateFromText('2026-10-10 19:00:00',now),'2026-10-10');
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

test('event slugs are stable and promotion-scoped',()=>{
  assert.equal(eventSlug({promotionSlug:'rizin',name:'SUPER RIZIN.5',eventDate:'2026-09-10'}),'rizin-super-rizin-5-2026-09-10');
});
