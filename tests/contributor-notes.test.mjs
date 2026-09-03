import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb,seed,d1,token,secondToken} from './helpers/fight-fixture.mjs';
import {getContributorNotes,saveContributorNote} from '../src/contributor-notes.ts';

const request=(body,key=token,origin='https://cagemetrix.com')=>new Request('https://cagemetrix.com/api/fights/2/notes',{
  method:'PUT',headers:{authorization:`Bearer ${key}`,'content-type':'application/json',origin},body:JSON.stringify(body)
});

test('contributors can publish and revise short or long pre-fight analysis with an optional pick',async()=>{
  const db=freshDb();seed(db);const env={DB:d1(db)};
  let response=await saveContributorNote(request({revision:0,title:'Range vs. pressure',body:'Short take: the jab and first layer of takedown defense decide this.',picked_fighter_id:1}),env,'2');
  assert.equal(response.status,200);let body=await response.json();assert.equal(body.revision,1);assert.equal(body.notes.length,1);assert.equal(body.notes[0].picked_fighter_id,1);

  const longBody=('Detailed matchup read with pace, wrestling and cage-position notes.\n\n').repeat(120);
  response=await saveContributorNote(request({revision:1,title:'Full pre-fight breakdown',body:longBody,picked_fighter_id:null}),env,'2');
  assert.equal(response.status,200);body=await response.json();assert.equal(body.revision,2);assert.match(body.notes[0].body,/Detailed matchup read/);assert.equal(body.notes[0].picked_fighter_id,null);

  const listed=await getContributorNotes(new Request('https://cagemetrix.com/api/fights/2/notes'),env,'2');
  assert.equal(listed.status,200);const publicBody=await listed.json();assert.equal(publicBody.meta.can_publish,true);assert.equal(publicBody.notes[0].title,'Full pre-fight breakdown');
  db.close();
});

test('multiple named contributors stay separate and optimistic revisions prevent overwrites',async()=>{
  const db=freshDb();seed(db);const env={DB:d1(db)};
  const first=await saveContributorNote(request({revision:0,title:'Desk read',body:'Fighter A by decision.',picked_fighter_id:1}),env,'2');assert.equal(first.status,200);
  const second=await saveContributorNote(request({revision:0,title:'Guest read',body:'Fighter B can punish the entries.',picked_fighter_id:2},secondToken),env,'2');assert.equal(second.status,200);
  const listed=await getContributorNotes(new Request('https://cagemetrix.com/api/fights/2/notes'),env,'2');const body=await listed.json();assert.equal(body.notes.length,2);assert.deepEqual(new Set(body.notes.map(n=>n.display_name)),new Set(['CageMetrix Desk','Guest Analyst']));
  const conflict=await saveContributorNote(request({revision:0,title:'Overwrite',body:'Should fail.',picked_fighter_id:null}),env,'2');assert.equal(conflict.status,409);
  db.close();
});

test('pre-fight notes reject invalid picks, cross-origin writes and edits after the card starts',async()=>{
  const db=freshDb();seed(db);const env={DB:d1(db)};
  let response=await saveContributorNote(request({revision:0,title:'Bad pick',body:'Nope.',picked_fighter_id:999}),env,'2');assert.equal(response.status,400);
  response=await saveContributorNote(request({revision:0,title:'Cross origin',body:'Nope.',picked_fighter_id:null},token,'https://example.com'),env,'2');assert.equal(response.status,403);
  response=await saveContributorNote(new Request('https://cagemetrix.com/api/fights/1/notes',{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',origin:'https://cagemetrix.com'},body:JSON.stringify({revision:0,title:'Too late',body:'The card already started.',picked_fighter_id:1})}),env,'1');assert.equal(response.status,409);
  const past=await getContributorNotes(new Request('https://cagemetrix.com/api/fights/1/notes'),env,'1');const pastBody=await past.json();assert.equal(pastBody.meta.can_publish,false);
  db.close();
});
