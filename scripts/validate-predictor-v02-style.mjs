import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseDelimited } from './lib/csv.mjs';
import { buildRatings as buildRatings03 } from './lib/model_v03.mjs';
import { buildObservations, buildRatings as buildRatings04 } from './lib/model_v04.mjs';
import { buildStyleProfiles, neutralStyle } from './lib/style_v02.mjs';
import { FEATURE_NAMES, FEATURE_SETS, PREDICTOR_V02_VERSION, featureVector, fitLogistic, predict, modelCoefficients } from './lib/predictor_v02.mjs';
import { featureVector as featureVector01, predictFrozenVector, RETROSPECTIVE_BENCHMARK as V01_BENCHMARK } from './lib/predictor_v01.mjs';
import { STATS_URL, hash } from './lib/dataset.mjs';

const LAMBDAS = [0.01, 0.05, 0.1, 0.25, 0.5, 1.0];
const CV_YEARS = [2020, 2021, 2022];
const NEAR_BEST_LOGLOSS = 0.001;

function metrics(rows, key) {
  if (!rows.length) return { bouts: 0, accuracy: null, brier: null, log_loss: null };
  const n = rows.length;
  return {
    bouts: n,
    accuracy: rows.reduce((s,r)=>s+(r[key]===0.5?0.5:Number((r[key]>0.5)===Boolean(r.won))),0)/n,
    brier: rows.reduce((s,r)=>s+(r[key]-r.won)**2,0)/n,
    log_loss: -rows.reduce((s,r)=>s+Math.log(Math.max(1e-12,r.won?r[key]:1-r[key])),0)/n
  };
}

function calibration(rows,key) {
  const buckets=Array.from({length:10},(_,i)=>({low:i/10,high:(i+1)/10,n:0,predicted:0,actual:0}));
  for(const r of rows){const p=Math.max(0,Math.min(.999999,r[key]));const b=buckets[Math.min(9,Math.floor(p*10))];b.n++;b.predicted+=p;b.actual+=r.won;}
  return buckets.filter(b=>b.n).map(b=>({range:`${Math.round(b.low*100)}-${Math.round(b.high*100)}%`,bouts:b.n,mean_predicted:b.predicted/b.n,observed_win_rate:b.actual/b.n}));
}

function pairedBrierInterval(rows,aKey,bKey){const groups=new Map();for(const r of rows){if(!groups.has(r.date))groups.set(r.date,[]);groups.get(r.date).push(r);}const events=[...groups.values()];let seed=0xC02026;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};const diffs=[];for(let i=0;i<1500;i++){let sum=0,n=0;for(let j=0;j<events.length;j++){const sampled=events[Math.floor(random()*events.length)];for(const r of sampled){sum+=(r[aKey]-r.won)**2-(r[bKey]-r.won)**2;n++;}}diffs.push(sum/Math.max(1,n));}diffs.sort((a,b)=>a-b);return[diffs[37],diffs[1461]];}

async function sourceText(args){const value=k=>args[args.indexOf(k)+1];if(args.includes('--stats'))return readFileSync(value('--stats'),'utf8');const response=await fetch(STATS_URL,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`Could not fetch pinned stats source (${response.status})`);return response.text();}

function historicalRows(pairs,start='2018-01-01'){
  const dates=[...new Set(pairs.map(p=>p.red.eventDate))].filter(d=>d>=start).sort();const rows=[];
  for(const [index,date] of dates.entries()){
    const prior=pairs.filter(p=>p.red.eventDate<date);
    const ratings03=new Map(buildRatings03(prior).ratings.map(r=>[r.fighterId,r]));
    const ratings04=new Map(buildRatings04(prior).ratings.map(r=>[r.fighterId,r]));
    const styles=buildStyleProfiles(prior);
    for(const pair of pairs.filter(p=>p.red.eventDate===date&&!p.red.noContest&&p.red.won!==0.5)){
      const a03=ratings03.get(pair.red.fighterId),b03=ratings03.get(pair.blue.fighterId),a04=ratings04.get(pair.red.fighterId),b04=ratings04.get(pair.blue.fighterId);
      if(!a03||!b03||!a04||!b04)continue;
      const sa=styles.get(pair.red.fighterId)||neutralStyle(),sb=styles.get(pair.blue.fighterId)||neutralStyle();
      rows.push({date,a:pair.red.fighterId,b:pair.blue.fighterId,won:pair.red.won,min_bouts:Math.min(a04.bouts,b04.bouts),x:featureVector(a04,b04,sa,sb),v01_p:predictFrozenVector(featureVector01(a03,b03))});
    }
    if(index%50===0)console.log(`Predictor 0.2 style history: ${index+1}/${dates.length} event dates (${date})`);
  }
  return rows;
}

function rollingScore(rows,featureIndexes,lambda){
  const pooled=[];const folds=[];
  for(const year of CV_YEARS){const start=`${year}-01-01`,end=`${year+1}-01-01`;const train=rows.filter(r=>r.date<start),validation=rows.filter(r=>r.date>=start&&r.date<end);if(!train.length||!validation.length)continue;const model=fitLogistic(train,{featureIndexes,lambda,iterations:700});const scored=validation.map(r=>({...r,p:predict(model,r)}));pooled.push(...scored);folds.push({year,train_bouts:train.length,...metrics(scored,'p')});}
  return {pooled:metrics(pooled,'p'),folds};
}

function selectArchitecture(rows){
  const trials=[];
  for(const [featureSet,featureIndexes] of Object.entries(FEATURE_SETS))for(const lambda of LAMBDAS){const cv=rollingScore(rows,featureIndexes,lambda);trials.push({feature_set:featureSet,feature_count:featureIndexes.length,lambda,...cv.pooled,folds:cv.folds});}
  trials.sort((a,b)=>a.log_loss-b.log_loss||a.brier-b.brier||b.accuracy-a.accuracy);
  const bestLogLoss=trials[0].log_loss;
  const nearBest=trials.filter(t=>t.log_loss<=bestLogLoss+NEAR_BEST_LOGLOSS).sort((a,b)=>a.feature_count-b.feature_count||a.log_loss-b.log_loss||b.lambda-a.lambda);
  return {selection_rule:`Rolling 2020-2022 temporal CV; among models within ${NEAR_BEST_LOGLOSS} log loss of best, prefer fewer features.`,selected:nearBest[0],best_raw:trials[0],trials};
}

const args=process.argv.slice(2);const source=await sourceText(args);const pairs=buildObservations(parseDelimited(source,';'));const rows=historicalRows(pairs);
const pre2023=rows.filter(r=>r.date<'2023-01-01'),test=rows.filter(r=>r.date>='2023-01-01');
const architecture=selectArchitecture(pre2023);const selectedIndexes=FEATURE_SETS[architecture.selected.feature_set];
const predictor=fitLogistic(pre2023,{featureIndexes:selectedIndexes,lambda:architecture.selected.lambda,iterations:1400});
const scored=test.map(r=>({...r,predictor_p:predict(predictor,r)})),established=scored.filter(r=>r.min_bouts>=5);
const predictorMetrics=metrics(scored,'predictor_p'),v01Metrics=metrics(scored,'v01_p');
const alignment={accuracy_delta:v01Metrics.accuracy-V01_BENCHMARK.accuracy,brier_delta:v01Metrics.brier-V01_BENCHMARK.brier,log_loss_delta:v01Metrics.log_loss-V01_BENCHMARK.log_loss};
if(Math.abs(alignment.brier_delta)>1e-10||Math.abs(alignment.log_loss_delta)>1e-10)throw new Error(`Predictor 0.1 baseline alignment failed: ${JSON.stringify(alignment)}`);

const report={
  predictor_version:PREDICTOR_V02_VERSION,rating_model_version:'0.4.0-candidate',source_sha256:hash(source),generated_at:new Date().toISOString(),
  design:'CMR 0.4 measures skill only when tested. Predictor 0.2 adds separate recency-weighted initiation style: significant-strike attempts, takedown attempts, and submission attempts, plus pressure-versus-defense and pressure×skill matchup interactions.',
  historical_holdout_status:'The 2023+ model-family window has already been observed in prior experiments. This fit never uses it for architecture, regularization or coefficients; prospective post-freeze fights remain the clean confirmation set.',
  feature_count_available:FEATURE_NAMES.length,feature_names:FEATURE_NAMES,
  style_features:['significant-strike attempts per minute','takedown attempts per 15 minutes','submission attempts per 15 minutes','pressure-vs-defense interactions','pressure × skill × opposing-defense interactions'],
  matched_bouts_since_2018:rows.length,final_train_bouts_2018_2022:pre2023.length,evaluation_bouts_2023_plus:test.length,
  architecture_selection:architecture,selected_feature_names:selectedIndexes.map(i=>FEATURE_NAMES[i]),
  results:{predictor_v02_style_candidate:predictorMetrics,frozen_predictor_v01_aligned:v01Metrics},
  established:{definition:'Both fighters have at least five prior rated bouts',predictor_v02_style_candidate:metrics(established,'predictor_p'),frozen_predictor_v01_aligned:metrics(established,'v01_p')},
  predictor_v02_minus_v01_brier_95_interval:pairedBrierInterval(scored,'predictor_p','v01_p'),calibration:calibration(scored,'predictor_p'),coefficients:modelCoefficients(predictor),baseline_alignment:alignment,
  comparison_to_production_v01:{production_v01:V01_BENCHMARK,candidate_accuracy_delta:predictorMetrics.accuracy-v01Metrics.accuracy,candidate_brier_delta:predictorMetrics.brier-v01Metrics.brier,candidate_log_loss_delta:predictorMetrics.log_loss-v01Metrics.log_loss},
  promotion_gate:{note:'Do not silently replace Predictor 0.1. Historical comparison is secondary because the model-family window has been seen; prospective review is required.',accuracy_not_worse_than_v01:predictorMetrics.accuracy>=v01Metrics.accuracy,brier_not_worse_than_v01:predictorMetrics.brier<=v01Metrics.brier,log_loss_not_worse_than_v01:predictorMetrics.log_loss<=v01Metrics.log_loss,prospective_confirmation_required:true}
};
mkdirSync('.cache',{recursive:true});writeFileSync('.cache/predictor-v02-style-validation.json',JSON.stringify(report,null,2)+'\n');writeFileSync('.cache/predictor-v02-style-predictions.json',JSON.stringify(scored));console.log(JSON.stringify(report,null,2));
