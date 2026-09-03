import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedResult,resultCheckDue} from '../src/live-results.ts';
const stored={id:1,source_key:'ufc:12947:umar-nurmagomedov:song-yadong',fighter_a_id:10,fighter_b_id:20,fighter_a_name:'Umar Nurmagomedov',fighter_b_name:'Song Yadong',fighter_a_slug:'umar-nurmagomedov',fighter_b_slug:'song-yadong'};
const official={officialId:'12947',red:'Umar Nurmagomedov',blue:'Song Yadong',redSlug:'umar-nurmagomedov',blueSlug:'song-yadong',redOutcome:'loss',blueOutcome:'win',methods:['KO/TKO','KO/TKO'],rounds:['2','2'],times:['1:48','1:48'],sourceStatus:''};
test('live results require a complete final outcome and survive reversed corners',()=>{
 assert.equal(confirmedResult(official,stored).winner_id,20);
 assert.equal(confirmedResult({...official,red:official.blue,blue:official.red,redSlug:official.blueSlug,blueSlug:official.redSlug,redOutcome:'win',blueOutcome:'loss'},stored).winner_id,20);
 for(const partial of [{blueOutcome:''},{redOutcome:'win'},{methods:[]},{rounds:[]},{times:['5:31']},{methods:['KO/TKO','Decision']}])assert.equal(confirmedResult({...official,...partial},stored),null);
});
test('replacement fighters, unknown IDs and ambiguous Bruno Silvas never grade old picks',()=>{
 assert.equal(confirmedResult({...official,blue:'Replacement Fighter',blueSlug:'replacement-fighter'},stored),null);
 assert.equal(confirmedResult({...official,officialId:'9'},stored),null);
 const bruno={...stored,fighter_a_name:'Bruno Silva',fighter_a_slug:'bruno-silva'};
 assert.equal(confirmedResult({...official,red:'Bruno Silva',redSlug:'bruno-silva-blindado'},bruno),null);
});
test('official draws, no contests, cancellations and corrections are explicit',()=>{
 for(const method of ['Draw','No Contest','Overturned','NC'])assert.equal(confirmedResult({...official,methods:[method]},stored).winner_id,null);
 assert.equal(confirmedResult({...official,sourceStatus:'cancelled',methods:[],rounds:[],times:[]},stored).status,'cancelled');
 assert.equal(confirmedResult({...official,redOutcome:'win',blueOutcome:'loss'},stored).winner_id,10);
});
test('checks run every two minutes on fight day, hourly around it, and stop after 72 hours',()=>{
 const start='2026-09-05T16:00:00.000Z',now=Date.parse(start);
 assert.equal(resultCheckDue(start,null,now),true);
 assert.equal(resultCheckDue(start,new Date(now-60_000).toISOString(),now),false);
 assert.equal(resultCheckDue(start,new Date(now-120_000).toISOString(),now),true);
 assert.equal(resultCheckDue(start,new Date(now-3_600_000).toISOString(),now-2*3_600_000),false);
 assert.equal(resultCheckDue(start,null,now+73*3_600_000),false);
 assert.equal(resultCheckDue(start,null,now-8*86400_000),false);
});
