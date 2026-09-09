import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGlobalEventBouts} from '../scripts/lib/global-event-bouts.mjs';

test('structured SportsEvent competitors become verified MMA matchups',()=>{
  const html=`<script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org','@type':'SportsEvent',name:'PFL World Tournament',sport:'Mixed Martial Arts',
    subEvent:[
      {'@type':'SportsEvent',name:'Alex Alpha vs Ben Bravo',sport:'Mixed Martial Arts',competitor:[{'@type':'Person',name:'Alex Alpha'},{'@type':'Person',name:'Ben Bravo'}]},
      {'@type':'SportsEvent',name:'Cara Charlie vs Dana Delta',sport:'Mixed Martial Arts',competitor:[{'@type':'Person',name:'Cara Charlie'},{'@type':'Person',name:'Dana Delta'}]}
    ]
  })}</script>`;
  const bouts=parseGlobalEventBouts(html,{sourceSlug:'pfl',sourceUrl:'https://pflmma.com/event/example'});
  assert.equal(bouts.length,2);
  assert.deepEqual(bouts.map(bout=>[bout.fighterAName,bout.fighterBName]),[['Alex Alpha','Ben Bravo'],['Cara Charlie','Dana Delta']]);
  assert.equal(bouts[0].sourceUrl,'https://pflmma.com/event/example');
});

test('visible fight rows use fighter anchors and preserve surrounding weight-class context',()=>{
  const html=`<article class="fight-card-bout"><span>Lightweight MMA</span><a href="/a">Alex Alpha</a><b> vs </b><a href="/b">Ben Bravo</a></article>`;
  const [bout]=parseGlobalEventBouts(html,{sourceSlug:'lfa',sourceUrl:'https://www.lfa.com/event/lfa-example/'});
  assert.equal(bout.fighterAName,'Alex Alpha');
  assert.equal(bout.fighterBName,'Ben Bravo');
  assert.equal(bout.weightClass,'Lightweight');
  assert.equal(bout.discipline,'MMA');
});

test('ONE card parser excludes non-MMA disciplines and accepts explicitly tagged MMA rows',()=>{
  const html=`
    <article class="fight"><span>Muay Thai</span><a>Striker One</a> vs <a>Striker Two</a></article>
    <article class="fight"><span>Kickboxing</span><a>Kicker One</a> vs <a>Kicker Two</a></article>
    <article class="fight"><span>MMA · Flyweight</span><a>Grappler One</a> vs <a>Grappler Two</a></article>`;
  const bouts=parseGlobalEventBouts(html,{sourceSlug:'one',sourceUrl:'https://www.onefc.com/events/example/'});
  assert.equal(bouts.length,1);
  assert.equal(bouts[0].fighterAName,'Grappler One');
  assert.equal(bouts[0].fighterBName,'Grappler Two');
});

test('calendar listing titles are not mistaken for full fight-card rows',()=>{
  const html=`<article><h3><a href="/event/lfa-241/">LFA 241 – Pires vs. Pereira</a></h3><p>September 11, 2026</p></article>`;
  assert.deepEqual(parseGlobalEventBouts(html,{sourceSlug:'lfa',sourceUrl:'https://www.lfa.com/events/'}),[]);
});

test('mirrored duplicate matchups collapse to one stable bout key',()=>{
  const html=`<ul><li class="fight"><a>Alex Alpha</a> vs <a>Ben Bravo</a></li><li class="fight"><a>Ben Bravo</a> vs <a>Alex Alpha</a></li></ul>`;
  const bouts=parseGlobalEventBouts(html,{sourceSlug:'cffc',sourceUrl:'https://cffc.tv/event/example'});
  assert.equal(bouts.length,1);
  assert.match(bouts[0].boutKey,/alex-alpha/);
  assert.match(bouts[0].boutKey,/ben-bravo/);
});

test('global cards remain separate from the locked core bout pipeline',()=>{
  const migration=fs.readFileSync('migrations/0036_global_event_bouts.sql','utf8');
  const sync=fs.readFileSync('scripts/sync-global-events.mjs','utf8');
  const page=fs.readFileSync('src/event-page.ts','utf8');
  const events=fs.readFileSync('src/events.ts','utf8');
  assert.match(migration,/CREATE TABLE IF NOT EXISTS scout_event_bouts/);
  assert.match(sync,/parseGlobalEventBouts/);
  assert.match(sync,/DELETE FROM scout_event_bouts/);
  assert.doesNotMatch(sync,/INSERT INTO bouts\s*\(/);
  assert.match(page,/FROM scout_event_bouts sb/);
  assert.match(page,/scout_public_global_profiles/);
  assert.match(events,/SELECT COUNT\(\*\) FROM scout_event_bouts/);
});
