import test from 'node:test';
import assert from 'node:assert/strict';
import { recentResultEvents } from '../scripts/lib/recent-source.mjs';

test('recent result parser supports the current UFCalendar link markup',()=>{
  const html=`<!doctype html><html><body>
    <a href="/events/ufc-fight-night-2026-09-05"><span>Sep 5, 2026</span><span>UFC</span><strong>UFC Fight Night: Hooker vs Parnasse</strong><span>MMA</span><span>Paris</span></a>
    <a href="/events/ufc-330-2026-08-15"><span>Aug 15, 2026</span><span>UFC</span><strong>UFC 330: Makhachev vs Machado Garry</strong><span>MMA</span></a>
    <a href="/events/brave-cf-108-2026-09-05">BRAVE CF 108 MMA</a>
  </body></html>`;
  assert.deepEqual(recentResultEvents(html,'2026-08-29'),[
    {url:'https://www.ufcalendar.com/events/ufc-fight-night-2026-09-05',name:'UFC Fight Night: Hooker vs Parnasse'}
  ]);
});

test('recent result parser keeps compatibility with the former ItemList markup',()=>{
  const html=`<!doctype html><script type="application/ld+json">${JSON.stringify({'@type':'ItemList',itemListElement:[
    {name:'UFC Fight Night: New vs Card',url:'https://www.ufcalendar.com/events/ufc-fight-night-2026-09-12'},
    {name:'UFC Fight Night: Old vs Card',url:'https://www.ufcalendar.com/events/ufc-fight-night-2026-08-29'}
  ]})}</script>`;
  assert.deepEqual(recentResultEvents(html,'2026-08-29'),[
    {url:'https://www.ufcalendar.com/events/ufc-fight-night-2026-09-12',name:'UFC Fight Night: New vs Card'}
  ]);
});
