import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('public event pages are scouting pages, not prediction pages',()=>{
  const page=read('src/event-page.ts');
  assert.match(page,/EVENT SCOUT/);
  assert.match(page,/Scout fighter/);
  assert.match(page,/Compare in Scout AI/);
  assert.match(page,/SportsEvent/);
  assert.doesNotMatch(page,/fighter_a_probability|picked_fighter_id|data-cm-inline-pick|event-picks-inline\.js|MODEL PICK/);
});

test('event directory routes users into scouting research',()=>{
  const page=read('src/events.ts');
  assert.match(page,/Scout this event/);
  assert.match(page,/Promotion scouting/);
  assert.match(page,/Ask Scout AI/);
  assert.doesNotMatch(page,/UFC predictions|\/predictions\.html/);
});

test('prediction and social public routes are retired at the entry boundary',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/path==='\/predictions\.html'/);
  assert.match(entry,/path==='\/validation\.html'/);
  assert.match(entry,/path==='\/community'/);
  assert.match(entry,/path==='\/forum'/);
  assert.match(entry,/feature_retired/);
  assert.match(entry,/\/api\/forecasts/);
  assert.match(entry,/fan-prediction/);
});
