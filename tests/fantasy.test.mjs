import test from 'node:test';
import assert from 'node:assert/strict';
import {draftPosition,normalizeTier,scorePremier,scoreChallenger} from '../src/fantasy.ts';

test('snake turns reverse on alternating rounds',()=>{
  assert.deepEqual(Array.from({length:12},(_,n)=>draftPosition(n,4)),[0,1,2,3,3,2,1,0,0,1,2,3]);
});
test('tiers remain separate and require explicit selection',()=>{
  assert.equal(normalizeTier('premier'),'premier');
  assert.equal(normalizeTier('challengers'),'challengers');
  assert.equal(normalizeTier('dynasty'),null);
});
test('Premier uses verified completed fights and detailed stats',()=>{
  assert.equal(scorePremier({status:'completed',won:1,result_method:'KO/TKO',knockdowns:1,sig_strikes:51,takedowns:2,control_seconds:90}),31.6);
  assert.equal(scorePremier({status:'scheduled',won:1,sig_strikes:100}),0);
});
test('Challengers awards only results supported by fight history',()=>{
  assert.equal(scoreChallenger({result:'W',method:'Submission',round_num:1}),23);
  assert.equal(scoreChallenger({result:'W',method:'Decision',round_num:3}),13);
  assert.equal(scoreChallenger({result:'L',method:'Decision'}),0);
});
