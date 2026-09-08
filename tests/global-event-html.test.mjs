import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOBAL_EVENT_SOURCES, parsePromotionEvents } from '../scripts/lib/global-event-sources.mjs';
import { usableUpcomingEvents } from '../scripts/lib/global-event-calendar.mjs';
import { scopePromotionHtml } from '../scripts/lib/global-event-html.mjs';

const now=new Date('2026-09-08T12:00:00Z');

test('PFL parsing is restricted to the official upcoming tab, never the archive',()=>{
  const source=GLOBAL_EVENT_SOURCES.find(item=>item.slug==='pfl');
  const html=`
    <div id="nav-upcoming">
      <article><h6>Fri, Oct 2</h6><h3>PFL MENA 11</h3><p>Riyadh, KSA</p><a href="/event/pflmena11">MATCHUPS</a></article>
    </div>
    <div id="nav-past">
      <article><h6>Fri, Sep 20</h6><h3>PFL MENA 3</h3><p>RIYADH, KSA</p><a href="/event/2024-mena-3">VIEW RESULTS</a></article>
    </div>`;
  const scoped=scopePromotionHtml(source,html);
  assert.match(scoped,/PFL MENA 11/);
  assert.doesNotMatch(scoped,/PFL MENA 3/);
  const events=usableUpcomingEvents(parsePromotionEvents(source,scoped,now),now);
  assert.equal(events.length,1,JSON.stringify(events));
  assert.equal(events[0].name,'PFL MENA 11');
  assert.equal(events[0].eventDate,'2026-10-02');
  assert.equal(events[0].country,'Saudi Arabia');
});
