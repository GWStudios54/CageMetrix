import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {getFight} from '../src/fights.ts';
import {freshDb,seed,d1,token} from './helpers/fight-fixture.mjs';
const read=name=>readFileSync(new URL(`../public/${name}`,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(id=1){
  const db=freshDb();seed(db);const data=await getFight(String(id),{DB:d1(db)});
  const dom=new JSDOM(read('fight.html'),{runScripts:'outside-only',pretendToBeVisual:true,url:`https://cagemetrix.com/fights/${id}`});
  const w=dom.window;w.document.querySelector('#fight-data').textContent=JSON.stringify(data);
  let refresh,onError;w.startAutoRefresh=(load,error)=>{refresh=load;onError=error;};w.AbortSignal=AbortSignal;
  w.fetch=async()=>({ok:true,json:async()=>data});w.eval(read('fight.js'));
  return {db,data,w,refresh,onError,close(){dom.window.close();db.close();}};
}
test('fight page refreshes official results and preserves pre-fight comparisons and probability on errors',async()=>{
  const t=await setup(),{w,data}=t,q=s=>w.document.querySelector(s);
  const stats=q('#fight-stats').innerHTML,odds=q('#fight-probability').innerHTML;
  data.bout.status='completed';data.bout.winner_id=2;data.bout.result_method='KO/TKO';data.prediction.grade='correct';
  await t.refresh();assert.match(q('#fight-result').textContent,/Song Yadong wins/);assert.equal(q('#fight-stats').innerHTML,stats);assert.equal(q('#fight-probability').innerHTML,odds);
  t.onError();assert.match(q('#fight-message').textContent,/retained/);assert.equal(q('#fight-stats').innerHTML,stats);t.close();
});
test('polling and write conflicts retain contributor drafts; keys never enter browser storage',async()=>{
  const t=await setup(),{w,data}=t,q=s=>w.document.querySelector(s);
  w.fetch=async url=>url==='/api/contributors/me'?{ok:true,json:async()=>({id:1,display_name:'Desk'})}:url.endsWith('/commentary')?{ok:false,json:async()=>({error:'This card changed in another editor.'})}:{ok:true,json:async()=>data};
  q('#publishing-key').value=token;q('#contributor-connect').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  q('#round-text-1').value='Unsaved round analysis';q('#round-text-1').dispatchEvent(new w.Event('input',{bubbles:true}));
  q('#final-thoughts').value='My draft';
  await t.refresh();assert.equal(q('#round-text-1').value,'Unsaved round analysis');assert.equal(q('#final-thoughts').value,'My draft');
  q('#scorecard-editor').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.match(q('#editor-feedback').textContent,/another editor/);assert.equal(q('#final-thoughts').value,'My draft');
  assert.equal(q('#publishing-key').value,'');assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);t.close();
});
test('commentary renders literal text without timestamps and shows every round plus Final Thoughts',async()=>{
  const t=await setup(3),{data,w}=t;
  data.commentary=[{contributor_id:1,display_name:'<script>name</script>',bio:'',revision:1,rounds:[{round:1,text:'<img src=x onerror=alert(1)>',score_a:10,score_b:9}],final_thoughts:'Final text',totals:{a:10,b:9,scored_rounds:1},updated_at:'2026-09-03T01:23:45Z'}];
  await t.refresh();const card=w.document.querySelector('#contributor-card');assert.equal(card.querySelectorAll('img,script,time').length,0);assert.ok(!card.textContent.includes('01:23'));assert.equal(card.querySelectorAll('h3').length,6);assert.match(card.textContent,/Not contested/);assert.match(card.textContent,/10 – 9/);t.close();
});
test('fight page keeps reasoning qualitative and does not expose downloadable model inputs',async()=>{
  const t=await setup(),{w,data}=t;
  const html=w.document.documentElement.outerHTML;
  assert.equal(w.document.querySelector('#snapshot-download'),null);
  assert.equal(w.document.querySelector('.feature-audit'),null);
  assert.equal(data.prediction.snapshot.features,undefined);
  assert.ok(!html.includes('Coefficient'));
  assert.ok(!html.includes('log-odds contribution'));
  assert.match(w.document.querySelector('#fight-drivers').textContent,/edge/);
  t.close();
});
