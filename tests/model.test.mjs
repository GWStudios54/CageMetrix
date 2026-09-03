import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObservations, buildRatings, canonicalWeightClass } from '../scripts/lib/model_v03.mjs';
import { forecast, gradePrediction } from '../scripts/lib/forecast.mjs';

function bout(a,b,date,extra={}) {return {red_fighter_name:a,blue_fighter_name:b,event_date:date,event_name:date,bout_type:'Flyweight Bout',method:'Decision - Unanimous',round:'3',time:'5:00',time_format:'3 Rnd (5-5-5)',fight_outcome:'red_win',red_fighter_sig_str:'40 of 80',blue_fighter_sig_str:'20 of 50',red_fighter_TD:'1 of 3',blue_fighter_TD:'0 of 2',red_fighter_ctrl:'1:20',blue_fighter_ctrl:'0:30',...extra};}
test('Bruno Silvas retain separate identities, division samples and opponent histories',()=>{
  const pairs=buildObservations([bout('Bruno Silva','Tyson Nam','2023-03-11',{red_fighter_nickname:'Bulldog'}),bout('Bruno Silva','Brad Tavares','2023-04-22',{red_fighter_nickname:'Blindado',bout_type:'Middleweight Bout'})]);
  const brunos=buildRatings(pairs).ratings.filter(r=>r.name==='Bruno Silva');
  assert.equal(brunos.length,2);
  assert.deepEqual(brunos.map(r=>r.bouts),[1,1]);
  assert.deepEqual(new Set(brunos.map(r=>r.weightClass)),new Set(['Flyweight','Middleweight']));
  assert.equal(new Set(brunos.map(r=>r.fighterId)).size,2);
  assert.throws(()=>buildObservations([bout('Bruno Silva','Tyson Nam','2023-03-11')]),/Ambiguous Bruno/);
});
test('women’s featherweight is never normalized into men’s featherweight',()=>{
  assert.equal(canonicalWeightClass("Women's Featherweight Title Bout"),"Women's Featherweight");
  assert.equal(canonicalWeightClass('Featherweight Title Bout'),'Featherweight');
});
test('historical cutoffs exclude future opponent baselines and future division changes',()=>{
  const past=[bout('Alpha','Bravo','2020-01-01'),bout('Bravo','Charlie','2020-02-01'),bout('Alpha','Charlie','2020-03-01')];
  const future=bout('Alpha','Bravo','2022-01-01',{bout_type:'Heavyweight Bout',red_fighter_sig_str:'900 of 1000'});
  const full=buildObservations([...past,future]);
  const asOf=buildRatings(full,null,{asOfDate:'2020-12-31'});
  assert.deepEqual(asOf,buildRatings(buildObservations(past)));
});
test('no contests do not inflate samples or Elo; DQ is not a finishing-skill bonus',()=>{
  const past=bout('Alpha','Bravo','2020-01-01');
  const nc=bout('Alpha','Charlie','2020-02-01',{fight_outcome:'no_contest',method:'Overturned'});
  const ratings=buildRatings(buildObservations([past,nc])).ratings;
  assert.equal(ratings.find(r=>r.name==='Alpha').bouts,1);
  assert.equal(ratings.find(r=>r.name==='Alpha').eloRaw,1514);
  assert.equal(buildObservations([bout('Alpha','Bravo','2020-01-01',{method:'DQ'})])[0].red.finish,false);
});
test('forecast probabilities complement and reverse; missing histories stay labeled',()=>{
  const a={eloRaw:1600,confidence:90,bouts:10},b={eloRaw:1400,confidence:80,bouts:8};
  const ab=forecast(a,b),ba=forecast(b,a);
  assert.ok(Math.abs(ab.probabilityA+ab.probabilityB-1)<1e-12);
  assert.ok(Math.abs(ab.probabilityA-ba.probabilityB)<1e-12);
  assert.equal(forecast(null,null).probabilityA,.5);
  assert.equal(forecast(null,null).pick,null);
  assert.equal(forecast(a,null).limitedHistory,true);
  assert.equal(gradePrediction(.7,'a'),true);
  assert.equal(gradePrediction(.7,'b'),false);
  assert.equal(gradePrediction(.7,'NC'),null);
  assert.equal(gradePrediction(.5,'a'),null);
});
