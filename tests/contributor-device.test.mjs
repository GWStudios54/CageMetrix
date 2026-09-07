import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
import {freshDb,seed,d1,token} from './helpers/fight-fixture.mjs';

globalThis.caches={default:{match:async()=>undefined,put:async()=>{}}};
function setup(){
  const db=freshDb();seed(db);const env={DB:d1(db),MODEL_VERSION:'0.3.0'};
  const request=(path,init={})=>worker.fetch(new Request(`https://mmascouts.com${path}`,init),env,{waitUntil(){}});
  return {db,request};
}

test('a contributor can remember a trusted phone, rename their public byline, publish by cookie, and disconnect',async()=>{
  const {db,request}=setup();
  const remembered=await request('/api/contributors/device',{method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(remembered.status,200);
  const setCookie=remembered.headers.get('set-cookie');
  assert.match(setCookie,/cm_contributor_key=/);
  assert.match(setCookie,/HttpOnly/);
  assert.match(setCookie,/Secure/);
  assert.match(setCookie,/SameSite=Strict/);
  const cookie=setCookie.split(';')[0];

  const me=await request('/api/contributors/me',{headers:{cookie}});
  assert.equal(me.status,200);assert.equal((await me.json()).id,1);

  const renamed=await request('/api/contributors/me',{method:'PATCH',headers:{cookie,origin:'https://mmascouts.com','content-type':'application/json'},body:JSON.stringify({display_name:'Southpaw Ledger'})});
  assert.equal(renamed.status,200);assert.equal((await renamed.json()).display_name,'Southpaw Ledger');
  assert.equal(db.prepare('SELECT display_name FROM contributors WHERE id=1').get().display_name,'Southpaw Ledger');

  const published=await request('/api/fights/2/commentary',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({revision:0,rounds:[],final_thoughts:'Pre-event note.'})});
  assert.equal(published.status,200);
  assert.equal((await published.json()).commentary[0].display_name,'Southpaw Ledger');

  const forgotten=await request('/api/contributors/device',{method:'DELETE',headers:{cookie}});
  assert.equal(forgotten.status,200);assert.match(forgotten.headers.get('set-cookie'),/Max-Age=0/);
  db.close();
});

test('forecast cards receive only aggregate fan consensus, not voter identities',async()=>{
  const {db,request}=setup();
  db.prepare('INSERT INTO fan_predictions(bout_id,voter_id,picked_fighter_id) VALUES(2,?,1),(2,?,1),(2,?,2)').run('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
  const response=await request('/api/forecasts');assert.equal(response.status,200);
  const payload=await response.json(),row=payload.data.find(r=>r.bout_id===2);
  assert.equal(row.fan_total,3);assert.equal(row.fan_consensus_pick,'a');assert.equal(row.fan_a_pct,2/3);assert.equal(row.fan_b_pct,1/3);
  assert.ok(!JSON.stringify(payload).includes('00000000-0000-4000-8000-000000000001'));
  db.close();
});
