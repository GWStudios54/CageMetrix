import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {birthDate,reachCentimeters,normalizedStance,profileIndex,fighterContext,contextVector} from '../scripts/lib/predictor-context.mjs';
import {CANDIDATE_VERSION,FEATURE_NAMES,EXPERIMENTS,indexesFor,matchupVector,fitCandidate,predictVector,candidateSnapshot} from '../scripts/lib/predictor_v02.mjs';
import {candidateHistory} from '../scripts/lib/predictor-history.mjs';
import {chronologicalSplit,chooseTrial,metrics,pairedBrierInterval,coverage} from '../scripts/lib/predictor-evaluation.mjs';
import {buildObservations} from '../scripts/lib/model_v03.mjs';
import {forecast} from '../scripts/lib/forecast.mjs';
import {ratingA,ratingB} from './helpers/fight-fixture.mjs';

const source={url:'https://example.test/factual-profile.csv',sha256:'a'.repeat(64),observed_on:'2026-08-01'};
const profile={dob:'1990-01-01',reach_cm:182.88,stance:'southpaw',source};
const contextA=fighterContext(profile,'2026-03-01','2026-09-12',{policy:'as_of',informationCutoff:'2026-09-03'});
const contextB=fighterContext({...profile,dob:'1995-01-01',reach_cm:177.8,stance:'orthodox'},'2026-06-01','2026-09-12',{policy:'as_of',informationCutoff:'2026-09-03'});
function bout(a,b,date,extra={}){return {red_fighter_name:a,blue_fighter_name:b,event_date:date,event_name:date,bout_type:'Flyweight Bout',method:'Decision - Unanimous',round:'3',time:'5:00',time_format:'3 Rnd (5-5-5)',fight_outcome:'red_win',red_fighter_sig_str:'40 of 80',blue_fighter_sig_str:'20 of 50',red_fighter_TD:'1 of 3',blue_fighter_TD:'0 of 2',...extra};}
function zeroModel(experiment='all_context'){return {version:CANDIDATE_VERSION,experiment,feature_names:[...FEATURE_NAMES],coefficients:indexesFor(experiment).map(index=>({index,feature:FEATURE_NAMES[index],raw_coefficient:0}))};}
function snapshotArgs(){return {model:zeroModel(),a:structuredClone(ratingA),b:structuredClone(ratingB),contextA:structuredClone(contextA),contextB:structuredClone(contextB),weightClass:'Bantamweight',lockedAt:'2026-09-03T13:00:00Z',sourceHashes:{stats:'b'.repeat(64),details:source.sha256},ratingsThrough:'2026-08-29'};}

test('0.2 parses only valid DOB and reach units and keeps unknown stance unknown',()=>{
  assert.equal(birthDate('Feb 29, 2000'),'2000-02-29');
  for(const invalid of ['Feb 29, 2001','1990-02-30','1990-13-01','--','',null])assert.equal(birthDate(invalid),null);
  assert.equal(reachCentimeters('72"'),182.88);
  for(const invalid of ['182.88 cm','72','--','2"','100"'])assert.equal(reachCentimeters(invalid),null);
  assert.equal(normalizedStance(' Southpaw '),'southpaw');assert.equal(normalizedStance('Open Stance'),null);
});

test('0.2 profiles exclude ambiguous identities and current career stats',()=>{
  const csv='fighter_name,DOB,Reach,Stance,SLpM\nAlpha,"Jan 01, 1990",,Orthodox,9000\nBruno Silva,"Jan 01, 1990",,Southpaw,9000';
  const profiles=profileIndex(csv,source);
  assert.deepEqual(Object.keys(profiles.get({name:'Alpha'})).sort(),['dob','reach_cm','source','stance']);
  assert.equal(profiles.get({name:'Bruno Silva',slug:'bruno-silva-blindado'}),null);
  assert.equal(profiles.get({name:'Bruno Silva',slug:'bruno-silva'}),null);
  assert.throws(()=>profileIndex(csv+'\nALPHA,,,,',source),/Ambiguous/);
  assert.throws(()=>profileIndex(csv,{}),/provenance/);
});

test('0.2 age uses the fight date and as-of context excludes later profile observations',()=>{
  assert.equal(contextA.days_since_ufc_fight,195);
  assert.ok(Math.abs(contextA.age_years-(Date.parse('2026-09-12')-Date.parse('1990-01-01'))/31557600000)<1e-12);
  const futureProfile={...profile,source:{...source,observed_on:'2026-09-04'}};
  const asOf=fighterContext(futureProfile,'2026-03-01','2026-09-12',{policy:'as_of',informationCutoff:'2026-09-03'});
  assert.equal(asOf.age_years,null);assert.equal(asOf.reach_cm,null);assert.equal(asOf.stance,null);
  const historic=fighterContext(futureProfile,'2025-01-01','2025-06-01');
  assert.equal(historic.historical_profile_assumption,true);
  assert.throws(()=>fighterContext(profile,'2026-09-12','2026-09-12'),/precede/);
  assert.equal(fighterContext({...profile,dob:'2020-01-01'},null,'2026-09-12').age_years,null);
});

test('0.2 features and probabilities reverse exactly including missing fields and division interactions',()=>{
  const unknown=fighterContext(null,null,'2026-09-12',{policy:'as_of'});
  for(const division of ['Flyweight','Heavyweight',"Women's Bantamweight"]){
    for(const b of [contextB,unknown]){
      const x=matchupVector(ratingA,ratingB,contextA,b,division),reverse=matchupVector(ratingB,ratingA,b,contextA,division);
      assert.equal(x.length,37);assert.ok(x.every(Number.isFinite));
      x.forEach((v,i)=>assert.ok(Math.abs(v+reverse[i])<1e-12,FEATURE_NAMES[i]));
      const model=zeroModel();model.coefficients.forEach((c,i)=>c.raw_coefficient=0.001*(i+1));
      assert.ok(Math.abs(predictVector(model,x)+predictVector(model,reverse)-1)<1e-12);
    }
  }
  const missing=contextVector(contextA,unknown,'Bantamweight');
  assert.equal(missing[0],0);assert.equal(missing[4],-1);assert.equal(missing[8],0);assert.equal(missing[9],-1);
});

test('0.2 history cannot use current-card outcomes, future bouts or future layoff dates',()=>{
  const past=[bout('Alpha','Bravo','2017-01-01'),bout('Charlie','Delta','2017-02-01'),bout('Alpha','Bravo','2017-12-01',{fight_outcome:'no_contest'})];
  const sameDay=[bout('Alpha','Charlie','2018-03-01'),bout('Bravo','Delta','2018-03-01')];
  const profiles={get:()=>profile};
  const rows=candidateHistory(buildObservations([...past,...sameDay]),profiles);
  const changed=candidateHistory(buildObservations([...past,...sameDay.map(b=>({...b,fight_outcome:'blue_win',red_fighter_sig_str:'900 of 999'})),bout('Alpha','Charlie','2019-01-01')]),profiles);
  assert.equal(rows.length,2);assert.equal(rows[0].context.a.last_ufc_fight_date,'2017-12-01');
  assert.equal(rows[0].context.a.days_since_ufc_fight,90);
  for(const [i,row] of rows.entries()){assert.deepEqual(row.x,changed[i].x);assert.deepEqual(row.context,changed[i].context);assert.equal(row.baseline_p,changed[i].baseline_p);}
  assert.throws(()=>candidateHistory(buildObservations([bout('Alpha','Bravo','2027-01-01')]),profiles),/evaluation end/);
});

test('0.2 split and trial selection do not train or tune on evaluation outcomes',()=>{
  const rows=['2018-01-01','2022-01-01','2023-01-01'].map((date,id)=>({date,id,rated:true,won:1}));
  const a=chronologicalSplit(rows),b=chronologicalSplit(rows.map(r=>r.date>='2023-01-01'?{...r,won:0}:r));
  assert.deepEqual(a.train,b.train);assert.deepEqual(a.validation,b.validation);assert.deepEqual(a.finalTrain,b.finalTrain);
  assert.throws(()=>chronologicalSplit([...rows,rows[0]]),/Duplicate/);
  const trials=[{experiment:'age',lambda:.01,metrics:{log_loss:.5,brier:.2}},{experiment:'layoff',lambda:.1,metrics:{log_loss:.6,brier:.1}}];
  assert.equal(chooseTrial(trials).experiment,'age');
});

test('0.2 symmetric fitting learns synthetic signal and fails on invalid inputs',()=>{
  const rows=Array.from({length:30},(_,i)=>{const x=new Array(FEATURE_NAMES.length).fill(0);x[24]=i-15;return {x,won:Number(i>=15)};});
  const model=fitCandidate(rows,'age',.01,{iterations:350});
  assert.equal(model.version,CANDIDATE_VERSION);
  assert.ok(predictVector(model,rows.at(-1).x)>.9);assert.ok(predictVector(model,rows[0].x)<.1);
  assert.throws(()=>predictVector(model,[NaN]),/vector/);
  const broken=structuredClone(model);broken.coefficients[0].raw_coefficient=Infinity;
  assert.throws(()=>predictVector(broken,rows[0].x),/coefficient/);
  assert.throws(()=>fitCandidate([{...rows[0],won:.5}],'age',.01),/decisive/);
  assert.throws(()=>indexesFor('injuries'),/Unknown/);
});

test('0.2 snapshots detach original inputs and explain precisely the probability-producing features',()=>{
  const args=snapshotArgs();args.model.coefficients.find(c=>c.feature==='age_years_diff').raw_coefficient=-.05;
  const snapshot=candidateSnapshot(args),saved=JSON.stringify(snapshot);
  const score=snapshot.features.reduce((sum,c)=>sum+c.contribution,0);
  assert.ok(Math.abs(1/(1+Math.exp(-score))-snapshot.probability_a)<1e-12);
  args.a.cmr=99;args.contextA.age_years=99;args.contextA.profile_source.observed_on='2030-01-01';args.model.coefficients[0].raw_coefficient=999;
  assert.equal(JSON.stringify(snapshot),saved);assert.equal(snapshot.research_only,true);
  const fallbackArgs=snapshotArgs();fallbackArgs.b=null;
  const fallback=candidateSnapshot(fallbackArgs);
  assert.equal(fallback.probability_a,forecast(fallbackArgs.a,null).probabilityA);
  assert.equal(fallback.model_used,'elo_fallback');assert.equal(fallback.features.length,1);
});

test('0.2 refuses retroactive or insufficiently sourced candidate locks',()=>{
  const a=snapshotArgs();a.contextA.policy='retrospective';assert.throws(()=>candidateSnapshot(a),/as-of/);
  const b=snapshotArgs();b.contextA.information_cutoff_date='2026-09-04';assert.throws(()=>candidateSnapshot(b),/before.*lock/);
  const c=snapshotArgs();c.contextA.profile_source.observed_on='2026-09-03';assert.throws(()=>candidateSnapshot(c),/evidence.*lock/);
  const d=snapshotArgs();d.ratingsThrough='2026-09-03';assert.throws(()=>candidateSnapshot(d),/Ratings/);
  const e=snapshotArgs();e.sourceHashes={};assert.throws(()=>candidateSnapshot(e),/hashes/);
  const f=snapshotArgs();f.contextA.profile_source.sha256='c'.repeat(64);assert.throws(()=>candidateSnapshot(f),/hash.*match/);
  const g=snapshotArgs();g.contextA.age_years=20;assert.throws(()=>candidateSnapshot(g),/Inconsistent/);
});

test('0.2 probability metrics handle certainty, ties, empty sets and paired event resampling',()=>{
  const rows=[{date:'2023-01-01',won:1,candidate_p:1,baseline_p:.5},{date:'2023-01-01',won:0,candidate_p:0,baseline_p:.5}];
  assert.equal(metrics(rows).accuracy,1);assert.equal(metrics(rows).brier,0);assert.equal(metrics(rows).log_loss,0);
  assert.equal(metrics(rows,'baseline_p').accuracy,.5);assert.equal(metrics([]).brier,null);
  const interval=pairedBrierInterval(rows);assert.equal(interval.low,-.25);assert.equal(interval.high,-.25);assert.equal(interval.event_dates,1);
  assert.throws(()=>metrics([{won:1,candidate_p:NaN}]),/Invalid/);
  const missing=fighterContext(null,null,'2026-09-12');
  const report=coverage([{rated:false,context:{a:contextA,b:missing}}]);assert.equal(report.age.one_missing,1);assert.equal(report.fallback_bouts,1);
});

test('0.2 remains disconnected from production forecast synchronization and deployment',()=>{
  for(const file of ['scripts/sync-forecasts.mjs','scripts/build.mjs','src/index.ts','src/fights.ts','scripts/lib/prediction-snapshot.mjs']){
    const code=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.doesNotMatch(code,/predictor_v02|0\.2\.0-candidate/);
  }
  assert.equal(Object.keys(EXPERIMENTS).length,7);
});
