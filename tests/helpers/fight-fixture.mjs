import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {forecast,FORECAST_PARAMETERS,ELO_SLOPE} from '../../scripts/lib/forecast.mjs';
import {predictMatchup as predictV01Matchup} from '../../scripts/lib/predictor_v01.mjs';
import {predictionSnapshot} from '../../scripts/lib/prediction-snapshot.mjs';
export const token='cm_'+Buffer.alloc(32,7).toString('base64url');
export const secondToken='cm_'+Buffer.alloc(32,8).toString('base64url');
export const ratingA={eloRaw:1610,cmr:64,technical:62,resume:58,strikingOffense:70,strikingDefense:63,wrestlingOffense:57,wrestlingDefense:67,grappling:54,pace:68,finishing:59,strengthOfSchedule:65,recentForm:60,confidence:78,bouts:9,minutes:107.25,weightClass:'Bantamweight',components:{provisional:false,sample_reliability:.78}};
export const ratingB={...ratingA,eloRaw:1580,cmr:59,strikingOffense:60,strikingDefense:70,wrestlingOffense:62,wrestlingDefense:62,confidence:66,bouts:6,minutes:68.5};
export const fighterA={name:'Umar Nurmagomedov',slug:'umar-nurmagomedov'},fighterB={name:'Song Yadong',slug:'song-yadong'};
export function freshDb(){const db=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../../migrations/',import.meta.url)).sort())db.exec(readFileSync(new URL(`../../migrations/${file}`,import.meta.url),'utf8'));return db;}
export function seed(db){
  db.prepare("INSERT INTO model_versions(id,name,version,parameters_json) VALUES(100,'CageMetrix Win Probability','0.2.0',?)").run(JSON.stringify(FORECAST_PARAMETERS));
  db.exec("INSERT INTO model_versions(id,name,version) VALUES(101,'CageMetrix Elo Baseline','0.1.0')");
  db.exec("INSERT INTO model_versions(id,name,version) VALUES(102,'CageMetrix Opponent-Adjusted Rating','0.3.0')");
  db.exec("INSERT INTO model_versions(id,name,version) VALUES(103,'CageMetrix Win Probability','0.1.0')");
  const insert=db.prepare('INSERT INTO fighters(id,slug,name,current_weight_class) VALUES(?,?,?,?)');
  insert.run(1,fighterA.slug,fighterA.name,'Bantamweight');insert.run(2,fighterB.slug,fighterB.name,'Bantamweight');insert.run(3,'replacement-fighter','Replacement Fighter','Bantamweight');
  const past=new Date(Date.now()-3600000).toISOString(),future=new Date(Date.now()+86400000).toISOString(),locked=new Date(Date.now()-86400000).toISOString();
  const event=db.prepare('INSERT INTO events(id,slug,name,event_date,starts_at,source_url) VALUES(?,?,?,?,?,?)');
  event.run(1,'preview-live','Preview fixture · Fight night',past.slice(0,10),past,'https://www.ufc.com/event/ufc-fight-night-august-29-2026');
  event.run(2,'preview-scheduled','Preview fixture · Upcoming card',future.slice(0,10),future,'https://www.ufc.com/event/ufc-fight-night-september-05-2026');
  const bout=db.prepare('INSERT INTO bouts(id,event_id,fighter_a_id,fighter_b_id,scheduled_rounds,weight_class,status,source_key) VALUES(?,?,1,?,?,\'Bantamweight\',?,?)');
  bout.run(1,1,2,5,'scheduled','ufc:12947:song-yadong:umar-nurmagomedov');
  bout.run(2,2,2,3,'scheduled','ufc:22222:song-yadong:umar-nurmagomedov');
  bout.run(3,1,2,3,'completed','ufc:33333:song-yadong:umar-nurmagomedov');
  bout.run(4,2,2,3,'cancelled','ufc:44444:song-yadong:umar-nurmagomedov');
  bout.run(5,2,3,3,'scheduled','ufc:44444:replacement-fighter:umar-nurmagomedov');
  db.exec("UPDATE bouts SET winner_id=2,result_method='KO/TKO',result_round=2,result_time_seconds=108 WHERE id=3");

  // Current production fixture: Predictor 0.2 / CMR 0.3.1 snapshot identity.
  const probabilities=forecast(ratingA,ratingB,{a:fighterA.name,b:fighterB.name});
  const snapshot=predictionSnapshot({a:fighterA,b:fighterB,ratingA,ratingB,probabilities,snapshotKey:'0.3.1:fixture',sourceMaxDate:'2026-08-29',lockedAt:locked});
  const prediction=db.prepare('INSERT INTO predictions(id,bout_id,model_version_id,locked_at,fighter_a_probability,fighter_b_probability,picked_fighter_id,top_factors_json,notes,input_snapshot_key,input_snapshot_json) VALUES(?,?,100,?,?,?,?,?,?,?,?)');
  for(const id of [1,2,3,4])prediction.run(id,id,locked,probabilities.probabilityA,probabilities.probabilityB,probabilities.pick==='a'?1:2,JSON.stringify(probabilities.drivers),probabilities.notes,snapshot.input_snapshot_key,JSON.stringify(snapshot));
  const replacement=forecast(ratingA,null),replacementSnapshot=predictionSnapshot({a:fighterA,b:{name:'Replacement Fighter',slug:'replacement-fighter'},ratingA,ratingB:null,probabilities:replacement,snapshotKey:snapshot.input_snapshot_key,sourceMaxDate:'2026-08-29',lockedAt:locked});
  prediction.run(5,5,locked,replacement.probabilityA,replacement.probabilityB,1,'[]',replacement.notes,snapshot.input_snapshot_key,JSON.stringify(replacementSnapshot));

  // Frozen Predictor 0.1 rows remain available to prove archive compatibility and
  // keep the legacy direct-index forecast route covered while production uses 0.2.
  const v01=predictV01Matchup(ratingA,ratingB);
  const legacyProbabilities={...v01,pick:Math.abs(v01.probabilityA-.5)<1e-10?null:v01.probabilityA>.5?'a':'b',modelUsed:'predictor_v01'};
  const legacySnapshot=predictionSnapshot({a:fighterA,b:fighterB,ratingA,ratingB,probabilities:legacyProbabilities,snapshotKey:'0.3.0:legacy-fixture',sourceMaxDate:'2026-08-29',lockedAt:locked,modelVersion:'0.1.0',cmrVersion:'0.3.0'});
  const legacyPrediction=db.prepare('INSERT INTO predictions(id,bout_id,model_version_id,locked_at,fighter_a_probability,fighter_b_probability,picked_fighter_id,top_factors_json,notes,input_snapshot_key,input_snapshot_json) VALUES(?,?,103,?,?,?,?,?,?,?,?)');
  for(const [id,boutId] of [[7,1],[8,2],[9,3],[10,4]])legacyPrediction.run(id,boutId,locked,legacyProbabilities.probabilityA,legacyProbabilities.probabilityB,legacyProbabilities.pick==='a'?1:2,JSON.stringify(legacyProbabilities.drivers),'Frozen Predictor 0.1 legacy fixture.',legacySnapshot.input_snapshot_key,JSON.stringify(legacySnapshot));

  const legacyA=1/(1+Math.exp(-ELO_SLOPE*(ratingA.eloRaw-ratingB.eloRaw)));
  db.prepare("INSERT INTO predictions(id,bout_id,model_version_id,locked_at,fighter_a_probability,fighter_b_probability,picked_fighter_id,input_snapshot_key,notes) VALUES(6,2,101,?,?,?,?,?,'Result-based Elo probability; sample strength is separate from win chance.')").run(locked,legacyA,1-legacyA,1,legacySnapshot.input_snapshot_key);
  const archived=db.prepare(`INSERT INTO ratings_history(fighter_id,model_version_id,as_of_date,snapshot_key,weight_class,cmr,competitive_rating,technical_rating,resume_rating,striking_offense,striking_defense,wrestling_offense,wrestling_defense,grappling,pace,finishing,strength_of_schedule,recent_form,confidence,sample_bouts,sample_minutes,components_json) VALUES(?,102,'2026-08-29',?,'Bantamweight',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for(const [id,r] of [[1,ratingA],[2,ratingB]])archived.run(id,legacySnapshot.input_snapshot_key,r.cmr,r.eloRaw,r.technical,r.resume,r.strikingOffense,r.strikingDefense,r.wrestlingOffense,r.wrestlingDefense,r.grappling,r.pace,r.finishing,r.strengthOfSchedule,r.recentForm,r.confidence,r.bouts,r.minutes,JSON.stringify(r.components));
  db.exec("INSERT INTO contributors(id,slug,display_name,bio) VALUES(1,'cagemetrix-desk','CageMetrix Desk','Preview contributor'),(2,'guest-analyst','Guest Analyst','Independent perspective')");
  const key=db.prepare('INSERT INTO contributor_keys(id,contributor_id,token_hash) VALUES(?,?,?)');
  key.run('test-key',1,createHash('sha256').update(token).digest('hex'));key.run('second-key',2,createHash('sha256').update(secondToken).digest('hex'));
  return {snapshot:JSON.parse(JSON.stringify(snapshot)),legacySnapshot:JSON.parse(JSON.stringify(legacySnapshot)),probabilities,legacyProbabilities,locked};
}
export function d1(db){return {prepare(sql){const s=db.prepare(sql);let bindings=[];return {bind(...v){bindings=v;return this;},async all(){return {results:s.all(...bindings)};},async first(){return s.get(...bindings)||null;},async run(){return {meta:s.run(...bindings)};}};},async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};}
