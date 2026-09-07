import test from 'node:test';
import assert from 'node:assert/strict';
import { boutSourceUrls, eventIdFromOfficialPage, mirroredStats, officialFeedEventId, officialFightStats, resultSourcesForEvent } from '../scripts/lib/recent-source.mjs';

test('completed UFC cards map deterministically to official and statistics sources',()=>{
  assert.deepEqual(resultSourcesForEvent('UFC Fight Night: Hooker vs Parnasse','2026-09-05'),{
    name:'UFC Fight Night: Hooker vs Parnasse',date:'2026-09-05',
    statisticsUrl:'https://www.ufcalendar.com/events/ufc-fight-night-2026-09-05',
    officialUrl:'https://www.ufc.com/event/ufc-fight-night-september-05-2026'
  });
  assert.deepEqual(resultSourcesForEvent('UFC 330: Makhachev vs Machado Garry','2026-08-15'),{
    name:'UFC 330: Makhachev vs Machado Garry',date:'2026-08-15',
    statisticsUrl:'https://www.ufcalendar.com/events/ufc-330-2026-08-15',
    officialUrl:'https://www.ufc.com/event/ufc-330'
  });
  assert.equal(resultSourcesForEvent("Dana White's Contender Series 90",'2026-09-01'),null);
  assert.equal(resultSourcesForEvent('UFC Fight Night: Bad Date','September 5'),null);
});

test('official UFC LiveStats source ids are accepted only from the expected endpoint',()=>{
  const url='https://d29dxerjsp82wz.cloudfront.net/api/v3/event/live/1326.json';
  assert.equal(officialFeedEventId(url),'1326');
  assert.equal(officialFeedEventId('https://example.com/api/v3/event/live/1326.json'),null);
  assert.equal(eventIdFromOfficialPage(`<script data-drupal-selector="drupal-settings-json">${JSON.stringify({eventLiveStats:{event_fmid:1326}})}</script>`),'1326');
  assert.equal(eventIdFromOfficialPage('<html></html>'),null);
});

test('bout result URLs use canonical UFC fighter slugs and retain a reversed fallback',()=>{
  assert.deepEqual(boutSourceUrls('https://www.ufcalendar.com/events/ufc-fight-night-2026-09-05',{
    red:'Michael Venom Page',redSlug:'michael-page',blue:'Nursulton Ruziboev',blueSlug:'nursulton-ruziboev'
  }),[
    'https://www.ufcalendar.com/events/ufc-fight-night-2026-09-05/michael-page-vs-nursulton-ruziboev',
    'https://www.ufcalendar.com/events/ufc-fight-night-2026-09-05/nursulton-ruziboev-vs-michael-page'
  ]);
});

test('current UFCalendar fight totals markup is normalized to warehouse stat format',()=>{
  const row=(a,label,b)=>`<div class="grid grid-cols-[1fr_auto_1fr]"><span>${a}</span><span>${label}</span><span>${b}</span></div>`;
  const html=`<!doctype html><html><body><section><h2>Fight totals</h2>${row('Michael Page','vs','Nursulton Ruziboev')}${row('0','Knockdowns','0')}${row('12 / 28','Significant strikes','8 / 29')}${row('49 / 66','Total strikes','21 / 42')}${row('0 / 2','Takedowns','2 / 3')}${row('1','Submission attempts','0')}${row('1:06','Control time','5:28')}</section><script type="application/ld+json">${JSON.stringify({'@type':'SportsEvent',winner:{name:'Michael Page'}})}</script></body></html>`;
  const parsed=mirroredStats(html);
  assert.deepEqual(parsed.names,['Michael Page','Nursulton Ruziboev']);
  assert.deepEqual(parsed.values.get('Significant strikes'),['12 of 28','8 of 29']);
  assert.deepEqual(parsed.values.get('Takedowns'),['0 of 2','2 of 3']);
  assert.equal(parsed.winner,'Michael Page');
});

test('official UFC per-fight LiveStats totals map directly into the CMR stat row shape',()=>{
  const stat=(FighterId,values)=>({FighterId,Knockdowns:0,SigStrikesLanded:12,SigStrikesAttempted:28,TakedownsLanded:0,TakedownsAttempted:2,SubmissionsAttempted:1,Reversals:0,ControlTime:'1:06',TotalStrikesLanded:49,TotalStrikesAttempted:66,SigHeadStrikesLanded:6,SigHeadStrikesAttempted:14,SigBodyStrikesLanded:4,SigBodyStrikesAttempted:8,SigLegStrikesLanded:2,SigLegStrikesAttempted:6,SigDistanceStrikesLanded:10,SigDistanceStrikesAttempted:24,SigClinchStrikesLanded:1,SigClinchStrikesAttempted:2,SigGroundStrikesLanded:1,SigGroundStrikesAttempted:2,...values});
  const payload={LiveFightDetail:{FightId:12947,Fighters:[
    {FighterId:1,Corner:'Red',Name:{FirstName:'Michael',LastName:'Page'},Outcome:{Outcome:'Win'}},
    {FighterId:2,Corner:'Blue',Name:{FirstName:'Nursulton',LastName:'Ruziboev'},Outcome:{Outcome:'Loss'}}
  ],FightStats:[stat(1,{}),stat(2,{SigStrikesLanded:8,SigStrikesAttempted:29,TotalStrikesLanded:21,TotalStrikesAttempted:42,TakedownsLanded:2,TakedownsAttempted:3,SubmissionsAttempted:0,ControlTime:'5:28'})]}};
  const parsed=officialFightStats(payload,'12947');
  assert.deepEqual(parsed.names,['Michael Page','Nursulton Ruziboev']);
  assert.deepEqual(parsed.values.get('Significant strikes'),['12 of 28','8 of 29']);
  assert.deepEqual(parsed.values.get('Total strikes'),['49 of 66','21 of 42']);
  assert.deepEqual(parsed.values.get('Takedowns'),['0 of 2','2 of 3']);
  assert.deepEqual(parsed.values.get('Control time'),['1:06','5:28']);
  assert.equal(parsed.winner,'Michael Page');
  assert.throws(()=>officialFightStats(payload,'99999'),/fight mismatch/);
});
