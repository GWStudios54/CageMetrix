import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dedupeEventBouts} from '../src/event-page.ts';

test('event pages collapse duplicate bout rows and prefer the current public model',()=>{
  const rows=[
    {id:41,bout_order:1,fighter_a_id:10,fighter_b_id:20,model_version:'0.1.0',fighter_a_probability:.495,fighter_b_probability:.505},
    {id:84,bout_order:1,fighter_a_id:10,fighter_b_id:20,model_version:'0.2.1',fighter_a_probability:.434,fighter_b_probability:.566},
    {id:85,bout_order:2,fighter_a_id:30,fighter_b_id:40,model_version:'0.2.1'}
  ];
  const bouts=dedupeEventBouts(rows);
  assert.equal(bouts.length,2);
  assert.equal(bouts[0].id,84);
  assert.equal(bouts[0].model_version,'0.2.1');
  assert.equal(bouts[1].id,85);
});

test('community hero CTA is a single mobile-safe flex box',()=>{
  const css=fs.readFileSync('public/community.css','utf8');
  assert.match(css,/\.cm-community-hero>\.button\{display:inline-flex/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.cm-community-hero>\.button\{display:flex;width:100%/);
});
