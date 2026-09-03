import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseDelimited} from './lib/csv.mjs';
import {buildObservations} from './lib/model_v03.mjs';
import {STATS_URL,DETAILS_URL} from './lib/dataset.mjs';
import {profileIndex,dateOnly} from './lib/predictor-context.mjs';
import {candidateHistory} from './lib/predictor-history.mjs';
import {CANDIDATE_VERSION,FEATURE_NAMES,EXPERIMENTS,fitCandidate,predictVector} from './lib/predictor_v02.mjs';
import {metrics,calibration,pairedBrierInterval,coverage,chronologicalSplit,chooseTrial} from './lib/predictor-evaluation.mjs';

const sha=text=>createHash('sha256').update(text).digest('hex');
const read=path=>readFileSync(path,'utf8');
const LAMBDAS=[0.001,0.01,0.1,0.5];
const codeFiles=['scripts/validate-predictor-v02.mjs','scripts/lib/predictor-context.mjs','scripts/lib/predictor-history.mjs','scripts/lib/predictor-evaluation.mjs','scripts/lib/predictor_v02.mjs','scripts/lib/predictor_v01.mjs','scripts/lib/forecast.mjs','scripts/lib/model_v03.mjs','scripts/lib/csv.mjs','scripts/lib/identity.mjs'];
export function sourceCodeHash(){return sha(codeFiles.map(file=>`${file}\n${read(new URL('../'+file,import.meta.url)).replaceAll('\r\n','\n')}`).join('\n'));}
export async function run(args) {
  const value=key=>{const i=args.indexOf(key);return i<0?null:args[i+1];};
  const statsPath=value('--stats'),detailsPath=value('--details'),observedOn=value('--profiles-observed-on');
  const end=value('--evaluation-end')||'2026-08-29',directory=value('--output')||'.cache/predictor-v02';
  if(!statsPath||!detailsPath||!dateOnly(observedOn)||!dateOnly(end))throw new Error('Provide --stats, --details and --profiles-observed-on YYYY-MM-DD; optionally --evaluation-end and --output');
  const stats=read(statsPath),details=read(detailsPath);
  const source={stats_sha256:sha(stats),details_sha256:sha(details),profiles_observed_on:observedOn,evaluation_end:end,
    stats_url:STATS_URL,details_url:DETAILS_URL,supplement:'scripts/data/recent-bouts.json',
    code_sha256:sourceCodeHash(),
    protocol_sha256:sha(read('docs/PREDICTOR-0.2-PROTOCOL.md').replaceAll('\r\n','\n'))};
  const expected=value('--expected-sources');
  if(expected){const pinned=JSON.parse(read(expected));for(const key of Object.keys(source))if(pinned[key]!==source[key])throw new Error(`Pinned provenance mismatch: ${key}`);}
  mkdirSync(directory,{recursive:true});
  const json=(file,data)=>writeFileSync(join(directory,file),JSON.stringify(data,null,2)+'\n');
  json('sources.json',source);
  const profiles=profileIndex(details,{url:DETAILS_URL,sha256:source.details_sha256,observed_on:observedOn});
  const cache=join(directory,'history.json'),cacheKey=sha(JSON.stringify(source));
  let rows;
  if(existsSync(cache)){const saved=JSON.parse(read(cache));if(saved.key===cacheKey&&saved.rows_sha256===sha(JSON.stringify(saved.rows)))rows=saved.rows;}
  if(!rows){rows=candidateHistory(buildObservations(parseDelimited(stats,';')),profiles,{end,progress:p=>console.log(`Pre-fight history: ${p.date} (${p.rows} rows)`)});writeFileSync(cache,JSON.stringify({key:cacheKey,rows_sha256:sha(JSON.stringify(rows)),rows}));}
  const {train,validation,finalTrain,test}=chronologicalSplit(rows);
  const trials=[];
  for(const experiment of Object.keys(EXPERIMENTS)){
    for(const lambda of LAMBDAS){const model=fitCandidate(train,experiment,lambda,{iterations:600});trials.push({experiment,lambda,metrics:metrics(validation.map(r=>({...r,candidate_p:predictVector(model,r.x)})))});}
    console.log(`Tuned ${experiment}: ${JSON.stringify(chooseTrial(trials.filter(t=>t.experiment===experiment)))}`);
  }
  const selected=chooseTrial(trials);
  // Persist selection before any test outcomes are scored. Test results never
  // flow into the experiment selection or final coefficient fit.
  json('selection.json',{selected,selection_period:'2022 only',trials,source});
  const models={},scoredByModel={},results={};
  for(const experiment of Object.keys(EXPERIMENTS)){
    const choice=chooseTrial(trials.filter(t=>t.experiment===experiment));
    const model=fitCandidate(finalTrain,experiment,choice.lambda);
    models[experiment]=model;
    const scored=test.map(r=>({...r,candidate_p:r.rated?predictVector(model,r.x):r.baseline_p}));
    scoredByModel[experiment]=scored;
    const rated=scored.filter(r=>r.rated);
    results[experiment]={groups:EXPERIMENTS[experiment],lambda:choice.lambda,validation:choice.metrics,
      rated:metrics(rated),all_bouts:metrics(scored),brier_difference_95_interval:pairedBrierInterval(rated)};
  }
  const chosen=scoredByModel[selected.experiment],rated=chosen.filter(r=>r.rated);
  const baseline=metrics(rated,'baseline_p'),candidate=metrics(rated),interval=results[selected.experiment].brier_difference_95_interval;
  const by=(getKey)=>Object.fromEntries([...new Set(rated.map(getKey))].sort().map(key=>{const group=rated.filter(r=>getKey(r)===key);return[key,{candidate:metrics(group),predictor_v01:metrics(group,'baseline_p'),small_sample:group.length<100}];}));
  const screening=candidate.brier<baseline.brier&&candidate.log_loss<baseline.log_loss&&interval.high<0;
  const report={candidate_version:CANDIDATE_VERSION,status:'offline_research_only',source,
    design:'Protocol-fixed chronological selection on 2022; fit 2018–2022; reused retrospective comparison 2023 onward. Current profiles are not point-in-time historical evidence.',
    selected_experiment:selected.experiment,feature_names:FEATURE_NAMES,
    samples:{tuning_train:train.length,tuning_validation:validation.length,final_train:finalTrain.length,evaluation_rated:rated.length,evaluation_all:test.length},
    coverage:{training:coverage(rows.filter(r=>r.date<'2023-01-01')),evaluation:coverage(test),evaluation_rated:coverage(rated),
      per_year:Object.fromEntries([...new Set(test.map(r=>r.date.slice(0,4)))].sort().map(year=>[year,coverage(test.filter(r=>r.date.startsWith(year)))]))},
    baseline:{rated:baseline,all_bouts:metrics(chosen,'baseline_p')},experiments:results,
    per_year:by(r=>r.date.slice(0,4)),per_division:by(r=>r.weight_class),
    calibration:{candidate:calibration(rated),predictor_v01:calibration(rated,'baseline_p')},
    promotion:{historical_screen_passed:screening,production_eligible:false,prospective_graded_bouts:0,
      reasons:['The 2023+ benchmark was previously examined for 0.1.','Profile fields lack historical observation dates.','Prospective locked as-of comparison has not run.'],
      decision:screening?'Consider a separate prospective shadow trial after provenance review.':'Keep 0.1 live; this candidate has not cleared the predefined historical screen.'}};
  const artifact={status:'offline_research_only',version:CANDIDATE_VERSION,training_end:'2022-12-31',selection_period:'2022',source,model:models[selected.experiment]};
  json('report.json',report);json('candidate.json',artifact);
  writeFileSync(join(directory,'predictions.jsonl'),chosen.map(r=>JSON.stringify({id:r.id,date:r.date,a:r.a,b:r.b,won:r.won,rated:r.rated,baseline_p:r.baseline_p,candidate_p:r.candidate_p,context:r.context,x:r.x})).join('\n')+'\n');
  console.log(JSON.stringify({selected:selected.experiment,samples:report.samples,baseline:report.baseline,candidate:results[selected.experiment],promotion:report.promotion},null,2));
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await run(process.argv.slice(2));
