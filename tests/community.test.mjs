import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeHandle,pickPoints,validateConfidence} from '../src/community.ts';

test('community handles and confidence are deliberately constrained',()=>{
  assert.equal(normalizeHandle(' FightNerd_54 '),'fightnerd_54');
  assert.equal(normalizeHandle('ab'),null);
  assert.equal(normalizeHandle('bad-name'),null);
  assert.equal(validateConfidence(50),50);
  assert.equal(validateConfidence(100),100);
  assert.equal(validateConfidence(49),null);
  assert.equal(validateConfidence(101),null);
});

test('pick em points reward correct confidence and punish wrong confidence',()=>{
  assert.equal(pickPoints(true,50),100);
  assert.equal(pickPoints(true,100),150);
  assert.equal(Math.abs(pickPoints(false,50)),0);
  assert.equal(pickPoints(false,100),-50);
  assert.equal(pickPoints(null,100),0);
});

test('community v1 is wired into events, fights and persistent profiles',()=>{
  const worker=fs.readFileSync('src/worker.ts','utf8');
  const module=fs.readFileSync('src/community.ts','utf8');
  const migration=fs.readFileSync('migrations/0017_community_loop.sql','utf8');
  const client=fs.readFileSync('public/community.js','utf8');
  assert.match(worker,/\/api\/community\/register/);
  assert.match(worker,/enhanceEventCommunity/);
  assert.match(worker,/enhanceFightCommunity/);
  assert.match(worker,/communityProfilePage/);
  assert.match(module,/Save this recovery key/);
  assert.match(module,/community_event_picks/);
  assert.match(module,/FIGHT DISCUSSION/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS community_accounts/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS community_posts/);
  assert.match(client,/BEAT CAGEMETRIX|Beat Cagemetrix|you vs model/i);
  assert.match(client,/recovery key/i);
});
