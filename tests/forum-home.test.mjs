import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('forum implementation remains preserved for a possible future product',()=>{
  const worker=fs.readFileSync('src/worker.ts','utf8'),forum=fs.readFileSync('src/forum.ts','utf8'),migration=fs.readFileSync('migrations/0021_forum_threads.sql','utf8');
  assert.match(worker,/url\.pathname==='\/forum'/);
  assert.match(worker,/\/forum\\\/event/);
  assert.match(worker,/\/forum\\\/fight/);
  assert.match(worker,/\/forum\\\/thread/);
  assert.match(forum,/FIGHT NIGHT/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS forum_threads/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS forum_posts/);
});

test('legacy discussion-link implementation remains preserved but is not a public destination',()=>{
  const source=fs.readFileSync('src/discussion-links.ts','utf8');
  const entry=fs.readFileSync('src/entry.ts','utf8');
  assert.match(source,/\/forum\/event\//);
  assert.match(source,/\/forum\/fight\//);
  assert.match(entry,/path==='\/forum'/);
  assert.match(entry,/Response\.redirect\(new URL\('\/scout'/);
});

test('homepage is a scouting dashboard instead of a prediction or community dashboard',()=>{
  const source=fs.readFileSync('src/static-seo.ts','utf8'),html=fs.readFileSync('public/index.html','utf8'),client=fs.readFileSync('public/home.js','utf8');
  assert.match(source,/EVENT SCOUT/);
  assert.match(source,/Who has faced stronger opposition/);
  assert.match(html,/THE MMA SCOUTING ENGINE/);
  assert.match(html,/Ask MMA Scouts/);
  assert.match(html,/Fighter Reports/);
  assert.match(html,/Prospect Scout/);
  assert.match(html,/SCOUT RANKINGS · FIGHTER DATABASE/);
  assert.match(client,/\/api\/fighters\?q=/);
  assert.match(client,/\/scout\?q=/);
  assert.doesNotMatch(source,/MATCHUP SCOUT|THE CROWD DISAGREES|Active discussions|Win Probability/);
  assert.doesNotMatch(html,/Matchup Scout|fan consensus|Predictions/);
});
