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

test('DEEP parser reads only the active card and excludes cancelled or postponed bouts',()=>{
  const html=`<div class="newsRes">
    <p>【対戦カード】</p>
    <p>メインイベント DEEPメガトン級タイトルマッチ 5分3R</p>
    <p>8. 王者：大成 （Battle-Box） VS シビサイ頌真（チームセラヴィ）：挑戦者</p>
    <p>DEEPストロー級 5分3R</p>
    <p>7. 北方大地（パンクラス大阪稲垣組）VS 新井丈 (和術慧舟會HEARTS)</p>
    <p>【中止カード】</p>
    <p>DEEPフェザー級 5分3R</p>
    <p>・ 海飛（HEARTS） VS 三井俊希（reversal gym）</p>
  </div>`;
  const bouts=parseGlobalEventBouts(html,{sourceSlug:'deep',sourceUrl:'https://www.deep2001.com/deep-133-impact/'});
  assert.equal(bouts.length,2);
  assert.deepEqual(bouts.map(bout=>[bout.fighterAName,bout.fighterBName]),[['大成','シビサイ頌真'],['北方大地','新井丈']]);
  assert.equal(bouts[0].weightClass,'Megatonweight');
  assert.equal(bouts[0].titleFight,true);
  assert.equal(bouts[1].weightClass,'Strawweight');
});

test('ACA structured main and prelim rows yield full fighter names',()=>{
  const html=`<div class="card__more card__more--main active">
      <div class="card__more-item">Evgeniy Goncharov 115 kg | 23-3 V S 18 Jailton Almeida 109 kg | 22-5</div>
      <div class="card__more-item">Kirill Kornilov 113 kg | 20-3 V S 17 Khadis Ibragimov 120 kg | 11-7</div>
    </div><div class="card__more card__more--prelim">
      <div class="card__more-item">Bogdan Plutakhin 70 kg | 15-3 V S 13 Nemat Abdrashitov 70 kg | 20-9</div>
    </div>`;
  const bouts=parseGlobalEventBouts(html,{sourceSlug:'aca',sourceUrl:'https://www.aca-mma.com/en'});
  assert.equal(bouts.length,3);
  assert.equal(bouts[0].fighterAName,'Evgeniy Goncharov');
  assert.equal(bouts[0].fighterBName,'Jailton Almeida');
  assert.equal(bouts[0].weightClass,'Heavyweight');
  assert.equal(bouts[2].weightClass,'Lightweight');
});

test('RIZIN parser accepts MMA rules and rejects kickboxing cards',()=>{
  const html=`<div class="event-scoreboard__fights">
    <article class="event-scoreboard-card"><h4>RAZHABALI SHAIDULLOEV VS AJ MCKEE</h4><ul><li>Championship: Featherweight Titles</li><li>Weight: 66.0 kg</li><li>Rule: RIZIN MMA Rules</li></ul></article>
    <article class="event-scoreboard-card"><h4>“BlackPanther”Beynoah VS Hide Meison Usami</h4><ul><li>Weight: 71.0 kg</li><li>Rule: RIZIN Open-Finger Glove Kickboxing Rules</li></ul></article>
  </div>`;
  const bouts=parseGlobalEventBouts(html,{sourceSlug:'rizin',sourceUrl:'https://www.rizin.tv/'});
  assert.equal(bouts.length,1);
  assert.equal(bouts[0].fighterAName,'RAZHABALI SHAIDULLOEV');
  assert.equal(bouts[0].fighterBName,'AJ MCKEE');
  assert.equal(bouts[0].weightClass,'66.0 kg');
  assert.equal(bouts[0].titleFight,true);
});

test('Cage Warriors parser scopes names and division to the same matchup row and rejects TBA',()=>{
  const html=`<main>
    <div class="et_pb_row"><div class="et_pb_text_inner"><p>Middleweight Title Fight</p></div></div>
    <div class="et_pb_row"><div class="et_pb_text_inner"><p>Paddy McCorry</p></div><div class="et_pb_text_inner"><p>VS.</p></div><div class="et_pb_text_inner"><p>Julio Spadaccini</p></div></div>
    <div class="et_pb_row"><div class="et_pb_text_inner"><p>Featherweight Bout</p></div></div>
    <div class="et_pb_row"><div class="et_pb_text_inner"><p>Keith Keogh</p></div><div class="et_pb_text_inner"><p>VS.</p></div><div class="et_pb_text_inner"><p>TBA</p></div></div>
    <div class="et_pb_row"><div class="et_pb_text_inner"><p>Flyweight Bout</p></div></div>
    <div class="et_pb_row"><div class="et_pb_text_inner"><p>Ger Harris</p></div><div class="et_pb_text_inner"><p>VS.</p></div><div class="et_pb_text_inner"><p>Michelangelo Lupoli</p></div></div>
  </main>`;
  const bouts=parseGlobalEventBouts(html,{sourceSlug:'cage-warriors',sourceUrl:'https://cagewarriors.com/cw-210-dublin/'});
  assert.equal(bouts.length,2);
  assert.deepEqual(bouts.map(bout=>[bout.fighterAName,bout.fighterBName]),[['Paddy McCorry','Julio Spadaccini'],['Ger Harris','Michelangelo Lupoli']]);
  assert.equal(bouts[0].weightClass,'Middleweight');
  assert.equal(bouts[0].titleFight,true);
  assert.equal(bouts[1].weightClass,'Flyweight');
});

test('FNC VS-marker parser excludes explicit UB kickboxing matchups',()=>{
  const html=`<main>
    <section><h3>Hatef Moeil</h3><span>Germany</span><h3>Darko Stosic</h3><span>Serbia</span><b>VS</b><a>Hatef Moeil</a><a>Darko Stosic</a></section>
    <section><div>UB 79.4 KG</div><h3>Hrvoje Sep</h3><span>Croatia</span><h3>Ante Bilić</h3><span>Croatia</span><b>VS</b><a>Hrvoje Sep</a><a>Ante Bilić</a></section>
  </main>`;
  const bouts=parseGlobalEventBouts(html,{sourceSlug:'fnc',sourceUrl:'https://www.fnc.hr/en/event/fnc-33/'});
  assert.equal(bouts.length,1);
  assert.ok(new Set([bouts[0].fighterAName,bouts[0].fighterBName]).has('Hatef Moeil'));
  assert.ok(new Set([bouts[0].fighterAName,bouts[0].fighterBName]).has('Darko Stosic'));
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
