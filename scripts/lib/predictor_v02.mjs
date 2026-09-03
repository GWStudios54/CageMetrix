import {FEATURE_NAMES as BASE_FEATURES,featureVector,fitLogistic,sigmoid} from './predictor_v01.mjs';
import {forecast,ELO_SLOPE} from './forecast.mjs';
import {CONTEXT_FEATURE_NAMES,CONTEXT_GROUPS,contextVector,dateOnly,fighterContext} from './predictor-context.mjs';
import {createHash} from 'node:crypto';

export const CANDIDATE_VERSION='0.2.0-candidate.1';
export const FEATURE_NAMES=Object.freeze([...BASE_FEATURES,...CONTEXT_FEATURE_NAMES]);
export const EXPERIMENTS=Object.freeze({
  ratings_only:[], age:['age'], layoff:['layoff'], age_layoff:['age','layoff'],
  age_layoff_reach:['age','layoff','reach'],age_layoff_stance:['age','layoff','stance'],
  all_context:['age','layoff','reach','stance']
});
export function indexesFor(experiment) {
  if (!Object.hasOwn(EXPERIMENTS,experiment)) throw new Error('Unknown candidate experiment');
  const names=[...BASE_FEATURES,...EXPERIMENTS[experiment].flatMap(group=>CONTEXT_GROUPS[group])];
  return names.map(name=>FEATURE_NAMES.indexOf(name));
}
export function matchupVector(a,b,contextA,contextB,weightClass) {
  return [...featureVector(a,b),...contextVector(contextA,contextB,weightClass)];
}
function checkVector(x) {
  if (!Array.isArray(x) || x.length!==FEATURE_NAMES.length || !x.every(Number.isFinite)) throw new Error('Invalid Predictor 0.2 feature vector');
}
export function fitCandidate(rows,experiment,lambda,{iterations=900}={}) {
  if (!Number.isFinite(lambda) || lambda<=0) throw new Error('Positive regularization is required');
  for(const row of rows){checkVector(row.x);if(![0,1].includes(row.won))throw new Error('Training requires decisive outcomes');}
  // Reuse the audited symmetric optimizer, but store a distinct candidate
  // identity and coefficient schema. No production coefficients are mutated.
  const fitted=fitLogistic(rows,{featureIndexes:indexesFor(experiment),lambda,iterations});
  return {version:CANDIDATE_VERSION,experiment,feature_names:[...FEATURE_NAMES],lambda,
    coefficients:fitted.featureIndexes.map((index,j)=>({feature:FEATURE_NAMES[index],index,raw_coefficient:fitted.weights[j]/fitted.scales[j]}))};
}
export function checkModel(model) {
  if(model?.version!==CANDIDATE_VERSION || JSON.stringify(model.feature_names)!==JSON.stringify(FEATURE_NAMES))throw new Error('Unsupported candidate model schema');
  const indexes=indexesFor(model.experiment);
  if(model.coefficients?.length!==indexes.length)throw new Error('Incomplete candidate coefficients');
  for(const [j,c] of model.coefficients.entries())if(c.index!==indexes[j] || c.feature!==FEATURE_NAMES[c.index] || !Number.isFinite(c.raw_coefficient))throw new Error('Invalid candidate coefficient');
}
export function predictVector(model,x) {
  checkModel(model);checkVector(x);
  return sigmoid(model.coefficients.reduce((sum,c)=>sum+x[c.index]*c.raw_coefficient,0));
}
export function candidateSnapshot({model,a,b,contextA,contextB,weightClass,lockedAt,sourceHashes,ratingsThrough}) {
  checkModel(model);
  const lock=Date.parse(lockedAt);
  if(!Number.isFinite(lock) || contextA.event_date!==contextB.event_date || new Date(lock).toISOString().slice(0,10)>contextA.event_date)throw new Error('Invalid candidate lock or fight date');
  const lockDate=new Date(lock).toISOString().slice(0,10);
  if(!dateOnly(ratingsThrough)||ratingsThrough>=lockDate)throw new Error('Ratings must precede the candidate lock');
  if(contextA.policy!=='as_of'||contextB.policy!=='as_of')throw new Error('New candidate snapshots require as-of context');
  for(const context of [contextA,contextB]){
    if(!dateOnly(context.information_cutoff_date)||context.information_cutoff_date>lockDate)throw new Error('Context must be captured before the candidate lock');
    if(context.last_ufc_fight_date && context.last_ufc_fight_date>=lockDate)throw new Error('Future UFC activity cannot enter a snapshot');
    const hasProfile=context.age_years!=null||context.reach_cm!=null||context.stance!=null;
    if(hasProfile && (!dateOnly(context.profile_source?.observed_on)||context.profile_source.observed_on>=context.information_cutoff_date||context.historical_profile_assumption))throw new Error('Profile evidence must precede the candidate lock');
    const reconstructed=fighterContext({dob:context.dob,reach_cm:context.reach_cm,stance:context.stance,source:context.profile_source},context.last_ufc_fight_date,context.event_date,{policy:'as_of',informationCutoff:context.information_cutoff_date});
    for(const key of ['age_years','days_since_ufc_fight','reach_cm','stance'])if(reconstructed[key]!==context[key])throw new Error(`Inconsistent candidate context: ${key}`);
  }
  if(!/^[a-f0-9]{64}$/.test(sourceHashes?.stats)||!/^[a-f0-9]{64}$/.test(sourceHashes?.details))throw new Error('Snapshot source hashes are required');
  for(const context of [contextA,contextB])if(context.profile_source && context.profile_source.sha256!==sourceHashes.details)throw new Error('Context profile hash does not match the locked source');
  const baseline=forecast(a,b);
  const x=matchupVector(a,b,contextA,contextB,weightClass);
  const fallback=!a || !b;
  const probabilityA=fallback ? baseline.probabilityA : predictVector(model,x);
  const eloDifference=(a?.eloRaw??1500)-(b?.eloRaw??1500);
  const features=fallback ? [{feature:'elo_diff',value:eloDifference,raw_coefficient:ELO_SLOPE,contribution:eloDifference*ELO_SLOPE}] : model.coefficients.map(c=>({...c,value:x[c.index],contribution:x[c.index]*c.raw_coefficient}));
  // JSON detaches all nested input objects from subsequent caller mutations.
  return JSON.parse(JSON.stringify({schema_version:1,candidate_version:CANDIDATE_VERSION,research_only:true,
    model_sha256:createHash('sha256').update(JSON.stringify(model)).digest('hex'),model,
    locked_at:lockedAt,source_hashes:sourceHashes,ratings_through:ratingsThrough,event_date:contextA.event_date,weight_class:weightClass,
    fighters:{a:{rating:a||null,context:contextA},b:{rating:b||null,context:contextB}},
    model_used:fallback?'elo_fallback':'predictor_v02_candidate',probability_a:probabilityA,probability_b:1-probabilityA,
    baseline_probability_a:baseline.probabilityA,features,explanation:fallback?'Insufficient UFC rating history: unchanged Predictor 0.1 Elo fallback.':'Contributions are feature value × learned coefficient in log-odds, not causal effects or percentage-point changes.'}));
}
