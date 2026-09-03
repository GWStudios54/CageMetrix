import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.ts';
import {validateCard,totalCard,publicPredictionSnapshot} from '../src/fights.ts';
import {confirmedResult,liveFeedBouts,resultCheckDue} from '../src/live-results.ts';
import {recoverSnapshot,snapshotInsertSql,predictionSnapshot} from '../scripts/lib/prediction-snapshot.mjs';
import {forecast} from '../scripts/lib/forecast.mjs';
import {freshDb,seed,d1,token,secondToken,ratingA,ratingB,fighterA,fighterB} from './helpers/fight-fixture.mjs';
globalThis.caches={default:{match:async()=>undefined,put:async()=>{}}};
function setup(){const db=freshDb(),fixture=seed(db),env={DB:d1(db),MODEL_VERSION:'0.3.0'};const request=(path,init={})=>worker.fetch(new Request(`https://cagemetrix.com${path}`,init),env,{waitUntil(){}});return {db,fixture,request};}
const body=(revision=0)=>({revision,rounds:[{round:1,text:'Measured pressure and cleaner combinations.',score_a:10,score_b:9},{round:2,text:'A clear second round for the blue corner.',score_a:8,score_b:10}],final_thoughts:'A close fight after two scored rounds.'});
const put=(card,key=token)=>({method:'PUT',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify(card)});

test('upgrading a pre-feature database preserves historical prediction bytes and the original immutable trigger',()=>{
  const db=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).sort().filter(n=>n<'0008'))db.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  db.exec("INSERT INTO fighters(id,name,slug) VALUES(1,'Alpha','alpha'),(2,'Bravo','bravo'); INSERT INTO events(id,name,slug,event_date,starts_at) VALUES(1,'Historical','historical','2026-08-29','2026-08-29T20:00:00Z'); INSERT INTO bouts(id,event_id,fighter_a_id,fighter_b_id,weight_class) VALUES(1,1,1,2,'Lightweight'); INSERT INTO predictions(id,bout_id,model_version_id,locked_at,fighter_a_probability,fighter_b_probability,notes) VALUES(1,1,1,'2026-08-28T00:00:00Z',0.7123456789123456,0.2876543210876544,'Saved original');");
  const before=db.prepare('SELECT * FROM predictions').get();
  db.exec(readFileSync(new URL('../migrations/0008_fight_details.sql',import.meta.url),'utf8'));
  const {input_snapshot_json,...after}=db.prepare('SELECT * FROM predictions').get();assert.deepEqual(after,{...before});assert.equal(input_snapshot_json,null);
  assert.throws(()=>db.exec("UPDATE predictions SET notes='Rewritten'"),/immutable/);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
});

test('fight routes retain public pre-fight snapshots without exposing model internals',async()=>{
  const {db,request,fixture}=setup();
  const before=await(await request('/api/fights/1')).json();
  assert.deepEqual(before.prediction.snapshot,publicPredictionSnapshot(fixture.snapshot));
  assert.equal(before.prediction.input_snapshot_key,undefined);
  assert.equal(before.prediction.snapshot.features,undefined);
  assert.ok(!JSON.stringify(before).includes('coefficient'));
  assert.deepEqual(JSON.parse(db.prepare('SELECT input_snapshot_json FROM predictions WHERE id=1').get().input_snapshot_json),fixture.snapshot);
  db.exec("UPDATE fighters SET name='Changed display name' WHERE id=1; INSERT INTO ratings_history(fighter_id,model_version_id,as_of_date,cmr,snapshot_key) VALUES(1,1,'2027-01-01',99,'later'); UPDATE bouts SET status='completed',winner_id=1,result_method='KO/TKO',result_round=2,result_time_seconds=108 WHERE id=1");
  const after=await(await request('/api/fights/1')).json();
  assert.deepEqual(after.prediction.snapshot,before.prediction.snapshot);assert.equal(after.prediction.fighter_a_probability,before.prediction.fighter_a_probability);assert.equal(after.prediction.grade,'incorrect');
  db.exec("UPDATE bouts SET winner_id=NULL,result_method='No Contest' WHERE id=1");assert.equal((await(await request('/api/fights/1')).json()).prediction.grade,'void');
  assert.equal((await request('/api/fights/1/snapshot')).status,404);
  assert.equal((await request('/api/fights/999')).status,404);assert.equal((await request('/api/fights/1?prediction=5')).status,404);
  assert.equal((await request('/api/fights/1',{method:'DELETE'})).status,405);db.close();
});
test('migration preserves existing rows, adds immutable storage and protects predicted identities without blocking results',()=>{
  const {db}=setup();const before=JSON.stringify(db.prepare('SELECT * FROM predictions').all());
  assert.throws(()=>db.exec('UPDATE predictions SET fighter_a_probability=.2 WHERE id=1'),/immutable/);
  assert.throws(()=>db.exec('UPDATE predictions SET input_snapshot_json=NULL WHERE id=1'),/immutable/);
  assert.throws(()=>db.exec('DELETE FROM predictions WHERE id=1'),/immutable/);
  assert.throws(()=>db.exec('UPDATE bouts SET fighter_b_id=3 WHERE id=1'),/immutable/);
  db.exec("UPDATE bouts SET status='completed',winner_id=2 WHERE id=1");assert.equal(JSON.stringify(db.prepare('SELECT * FROM predictions').all()),before);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});
test('archive recovery verifies source and exact drivers; repeated backfill never changes the saved record',()=>{
  const {db,fixture}=setup();
  const row={...db.prepare('SELECT * FROM predictions WHERE id=1').get(),model_name:'CageMetrix Win Probability',model_version:'0.1.0',fighter_a_name:fighterA.name,fighter_a_slug:fighterA.slug,fighter_b_name:fighterB.name,fighter_b_slug:fighterB.slug};
  const recovered=recoverSnapshot(row,ratingA,ratingB,'2026-08-29');assert.equal(recovered.available,true);assert.equal(recovered.provenance,'verified_archive');assert.deepEqual(JSON.parse(JSON.stringify(recovered.features)),fixture.snapshot.features);
  for(const [p,a,b,date] of [[row,{...ratingA,cmr:80},ratingB,'2026-08-29'],[row,null,ratingB,'2026-08-29'],[row,ratingA,ratingB,'2099-01-01'],[{...row,top_factors_json:'[]'},ratingA,ratingB,'2026-08-29']])assert.equal(recoverSnapshot(p,a,b,date).available,false);
  db.exec(snapshotInsertSql(1,recovered));const original=db.prepare('SELECT snapshot_json FROM prediction_snapshots').get().snapshot_json;
  db.exec(snapshotInsertSql(1,{...recovered,reason:'must not overwrite'}));assert.equal(db.prepare('SELECT snapshot_json FROM prediction_snapshots').get().snapshot_json,original);
  assert.throws(()=>db.exec("UPDATE prediction_snapshots SET snapshot_json='{}'"),/immutable/);assert.throws(()=>db.exec('DELETE FROM prediction_snapshots'),/immutable/);db.close();
});
test('fallback snapshot records neutral Elo as the only driver and leaves missing CMR unrated',()=>{
  const probabilities=forecast(ratingA,null);const s=predictionSnapshot({a:fighterA,b:fighterB,ratingA,ratingB:null,probabilities,snapshotKey:'key',sourceMaxDate:'2026-08-29',lockedAt:'2026-09-01T00:00:00Z'});
  assert.equal(s.model_used,'elo_fallback');assert.equal(s.fighters.b.rating,null);assert.equal(s.features.length,1);assert.equal(s.features[0].name,'elo_diff');assert.equal(s.probability_a,probabilities.probabilityA);
});
test('scheduled, live-event, completed, cancelled and replacement pages remain distinct and are linked from forecasts',async()=>{
  const {request,db}=setup();
  for(const [id,status] of [[1,'scheduled'],[2,'scheduled'],[3,'completed'],[4,'cancelled'],[5,'scheduled']]){const p=await(await request(`/api/fights/${id}`)).json();assert.equal(p.bout.status,status);assert.equal(p.canonical,`https://cagemetrix.com/fights/${id}`);}
  const original=await(await request('/api/fights/4')).json(),replacement=await(await request('/api/fights/5')).json();
  assert.equal(original.related[0].id,5);assert.equal(replacement.related[0].id,4);assert.equal(original.prediction.grade,'cancelled');assert.notDeepEqual(original.prediction.snapshot,replacement.prediction.snapshot);
  const forecasts=await(await request('/api/forecasts')).json();assert.ok(forecasts.data.every(p=>p.fight_url===`/fights/${p.bout_id}`));db.close();
});
test('contributor keys authorize only their own cards, revoked and cross-origin writes fail, conflicts retain the winner',async()=>{
  const {request,db}=setup();
  assert.equal((await request('/api/fights/1/commentary',put(body(),'wrong'))).status,401);
  assert.equal((await request('/api/contributors/me',{headers:{authorization:`Bearer ${token}`}})).status,200);
  const created=await request('/api/fights/1/commentary',put({...body(),contributor_id:2}));assert.equal(created.status,200);
  const result=await created.json();assert.deepEqual(result.commentary[0].totals,{a:18,b:19,scored_rounds:2});assert.equal(result.commentary[0].contributor_id,1);
  assert.ok(!JSON.stringify(result).includes('updated_at'));assert.ok(!JSON.stringify(result).includes('token_hash'));
  assert.equal((await request('/api/fights/1/commentary',put(body()))).status,409);
  assert.equal((await request('/api/fights/1/commentary',put({...body(1),final_thoughts:'Updated'}))).status,200);
  assert.equal((await request('/api/fights/1/commentary',put({...body(1),final_thoughts:'Stale overwrite'}))).status,409);
  assert.equal((await request('/api/fights/1/commentary',put(body(),secondToken))).status,200);
  const cross=put(body(2));cross.headers.origin='https://other.example';assert.equal((await request('/api/fights/1/commentary',cross)).status,403);
  db.exec("UPDATE contributor_keys SET revoked_at=CURRENT_TIMESTAMP WHERE id='test-key'");assert.equal((await request('/api/fights/1/commentary',put(body(2)))).status,401);
  const cards=(await(await request('/api/fights/1')).json()).commentary;assert.equal(cards.length,2);assert.equal(cards.find(c=>c.contributor_id===1).final_thoughts,'Updated');db.close();
});
test('round score validation enforces normal MMA scores, partial cards, length, timing and unplayed rounds',async()=>{
  const {db,request}=setup();
  for(const [a,b] of [[10,9],[9,10],[10,8],[8,10],[10,7],[7,10],[10,10]])assert.equal(validateCard({revision:0,rounds:[{round:1,text:'',score_a:a,score_b:b}],final_thoughts:''},{scheduled_rounds:5,starts_at:'2020-01-01'}),null);
  for(const pair of [[9,9],[11,9],[10,6],[10,null],['10',9],[null,undefined]]){const card={revision:0,rounds:[{round:1,text:'',score_a:pair[0],score_b:pair[1]}],final_thoughts:''};assert.equal((await request('/api/fights/1/commentary',put(card))).status,400);}
  for(const id of [2,4,5])assert.equal((await request(`/api/fights/${id}/commentary`,put(body()))).status,400);
  assert.equal((await request('/api/fights/3/commentary',put({...body(),rounds:[{round:3,text:'Unplayed',score_a:10,score_b:9}]}))).status,400);
  assert.equal((await request('/api/fights/2/commentary',put({revision:0,rounds:[],final_thoughts:'Pre-event thoughts.'}))).status,200);
  assert.equal((await request('/api/fights/1/commentary',put({...body(),rounds:[body().rounds[0],body().rounds[0]]}))).status,400);
  assert.equal((await request('/api/fights/1/commentary',put({...body(),final_thoughts:'x'.repeat(33000)}))).status,413);
  const invalid=JSON.stringify([{round:1,text:'No score keys'}]);assert.throws(()=>db.prepare('INSERT INTO fight_commentary(bout_id,contributor_id,rounds_json,revision) VALUES(1,1,?,1)').run(invalid),/Invalid/);
  assert.deepEqual(totalCard([{score_a:10,score_b:9},{score_a:null,score_b:null}]),{a:10,b:9,scored_rounds:1});db.close();
});
test('existing official final-result confirmation and two-minute cadence still grade the fight page',async()=>{
  const {db,request}=setup();const b=db.prepare(`SELECT b.*,a.name fighter_a_name,a.slug fighter_a_slug,z.name fighter_b_name,z.slug fighter_b_slug FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id WHERE b.id=1`).get();
  const payload={LiveEventDetail:{EventId:1326,FightCard:[{FightId:12947,Status:'Final',Fighters:[{Corner:'Red',Name:{FirstName:'Umar',LastName:'Nurmagomedov'},Outcome:{Outcome:'Loss'}},{Corner:'Blue',Name:{FirstName:'Song',LastName:'Yadong'},Outcome:{Outcome:'Win'}}],Result:{Method:'KO/TKO',EndingRound:2,EndingTime:'1:48'}}]}};
  const result=confirmedResult(liveFeedBouts(payload,'1326')[0],b);assert.equal(result.winner_id,2);
  db.prepare('UPDATE bouts SET status=?,winner_id=?,result_method=?,result_round=?,result_time_seconds=? WHERE id=1').run(...Object.values(result));
  assert.equal((await(await request('/api/fights/1')).json()).prediction.grade,'correct');
  const now=Date.now();assert.equal(resultCheckDue(new Date(now).toISOString(),new Date(now-60000).toISOString(),now),false);assert.equal(resultCheckDue(new Date(now).toISOString(),new Date(now-120000).toISOString(),now),true);db.close();
});