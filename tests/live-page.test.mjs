import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const read=name=>readFileSync(new URL(`../public/${name}`,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('polling pauses when hidden, prevents overlapping requests and resumes on return',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 let hidden=false,calls=0,finish;Object.defineProperty(w.document,'hidden',{get:()=>hidden});
 w.eval(read('auto-refresh.js'));const stop=w.startAutoRefresh(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},()=>{},60_000);
 w.document.dispatchEvent(new w.Event('visibilitychange'));assert.equal(calls,1);
 hidden=true;w.document.dispatchEvent(new w.Event('visibilitychange'));finish();await tick();
 hidden=false;w.document.dispatchEvent(new w.Event('visibilitychange'));assert.equal(calls,2);
 stop();finish();dom.window.close();
});
test('a new result updates accuracy in place, keeps the live card, and retains data on network failure',async()=>{
 const dom=new JSDOM(read('predictions.html'),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://cagemetrix.com/predictions'});const w=dom.window;
 let refresh,onError,response;
 w.startAutoRefresh=(load,error)=>{refresh=load;onError=error;};w.fighterMedia={ready:Promise.resolve(),portrait:()=>''};
 w.fetch=async()=>({ok:true,json:async()=>response});w.AbortSignal=AbortSignal;
 const row={event_slug:'test',event_name:'Test',event_date:'2026-09-05',starts_at:'2026-09-05T16:00:00Z',event_live:true,results_success_at:new Date().toISOString(),source_url:'https://www.ufc.com/event/test',fighter_a_id:1,fighter_b_id:2,fighter_a_name:'Alpha',fighter_b_name:'Bravo',fighter_a_slug:'alpha',fighter_b_slug:'bravo',fighter_a_probability:.7,fighter_b_probability:.3,grade:'pending',locked_at:'2026-09-01T00:00:00Z'};
 response={data:[row],summary:{correct:0,incorrect:0,graded:0,pending:1,accuracy:null,brier:null},meta:{model_version:'0.1.0'}};
 w.eval(read('predictions.js'));await refresh();assert.equal(w.document.querySelector('#live-record').textContent,'0 / 0');
 response={...response,data:[{...row,grade:'incorrect',winner_id:2,result_method:'KO/TKO'}],summary:{correct:0,incorrect:1,graded:1,pending:0,accuracy:0,brier:.49}};
 await refresh();assert.equal(w.document.querySelector('#live-record').textContent,'0 / 1');assert.equal(w.document.querySelectorAll('.event-card').length,1);assert.match(w.document.querySelector('.result-label').textContent,/Bravo wins/);assert.match(w.document.querySelector('.forecast-matchup').textContent,/70.0%/);
 onError();assert.equal(w.document.querySelector('#live-record').textContent,'0 / 1');assert.match(w.document.querySelector('#live-refresh-status').textContent,/Retrying/);dom.window.close();
});
