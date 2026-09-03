import test from 'node:test';
import assert from 'node:assert/strict';
import {fanIdentity,scorableRounds,validateFanScorecard} from '../src/fans.ts';

test('fan predictions use a persistent anonymous first-party identity',()=>{
  const first=fanIdentity(new Request('https://cagemetrix.com/fights/1'));
  assert.match(first.id,/^[0-9a-f-]{36}$/i);
  assert.match(first.setCookie,/cm_fan_id=/);
  assert.match(first.setCookie,/HttpOnly/);
  const second=fanIdentity(new Request('https://cagemetrix.com/fights/1',{headers:{cookie:`cm_fan_id=${first.id}`}}));
  assert.equal(second.id,first.id);
  assert.equal(second.setCookie,undefined);
});

test('fan scorecards cover completed rounds only',()=>{
  assert.equal(scorableRounds({status:'completed',scheduled_rounds:3,result_round:3,result_method:'Decision - Unanimous'}),3);
  assert.equal(scorableRounds({status:'completed',scheduled_rounds:3,result_round:3,result_method:'KO/TKO'}),2);
  assert.equal(scorableRounds({status:'completed',scheduled_rounds:3,result_round:1,result_method:'Submission'}),0);
  assert.equal(scorableRounds({status:'scheduled',scheduled_rounds:3,result_round:null,result_method:null}),0);
});

test('fan cards require a complete valid ten-point-must card',()=>{
  const bout={status:'completed',scheduled_rounds:3,result_round:3,result_method:'Decision - Split'};
  assert.equal(validateFanScorecard({rounds:[
    {round:1,score_a:10,score_b:9},
    {round:2,score_a:9,score_b:10},
    {round:3,score_a:10,score_b:10}
  ]},bout),null);
  assert.match(validateFanScorecard({rounds:[{round:1,score_a:10,score_b:9}]},bout),/Score all 3/);
  assert.match(validateFanScorecard({rounds:[
    {round:1,score_a:9,score_b:9},
    {round:2,score_a:10,score_b:9},
    {round:3,score_a:10,score_b:9}
  ]},bout),/ten-point-must/);
});
