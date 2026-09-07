import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('forum is a first-class destination with category and scoped thread routes',()=>{
  const worker=fs.readFileSync('src/worker.ts','utf8'),forum=fs.readFileSync('src/forum.ts','utf8'),migration=fs.readFileSync('migrations/0021_forum_threads.sql','utf8');
  assert.match(worker,/url\.pathname==='\/forum'/);
  assert.match(worker,/\/forum\\\/event/);
  assert.match(worker,/\/forum\\\/fight/);
  assert.match(worker,/\/forum\\\/thread/);
  assert.match(forum,/FIGHT NIGHT/);
  assert.match(forum,/CAGEMETRIX/);
  assert.match(forum,/OFF TOPIC/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS forum_threads/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS forum_posts/);
});

test('fight and event pages send discussion to the forum instead of embedding it visibly',()=>{
  const source=fs.readFileSync('src/discussion-links.ts','utf8');
  assert.match(source,/\/forum\/event\//);
  assert.match(source,/\/forum\/fight\//);
  assert.match(source,/scope==='event'\?'the card':'this fight'/);
  assert.match(source,/hidden/);
});

test('homepage is a fight-week dashboard',()=>{
  const source=fs.readFileSync('src/static-seo.ts','utf8'),client=fs.readFileSync('public/home-dashboard.js','utf8');
  assert.match(source,/NEXT CARD/);
  assert.match(source,/THE CROWD DISAGREES/);
  assert.match(source,/Active discussions/);
  assert.match(source,/community picks/);
  assert.match(client,/beat_model/);
  assert.match(client,/Finish your card/);
});
