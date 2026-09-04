import { FORECAST_PARAMETERS, FORECAST_VERSION, ELO_SLOPE } from './forecast.mjs';
import {
  FEATURE_NAMES,
  FROZEN_RAW_COEFFICIENTS,
  featureVector,
  groupedDrivers,
  predictMatchup as predictV01Matchup
} from './predictor_v01.mjs';
import {
  PREDICTOR_V02_FEATURE_NAMES,
  PREDICTOR_V02_SCALES,
  PREDICTOR_V02_WEIGHTS,
  predictorV02FeatureVector,
  groupedV02Drivers,
  predictV02Matchup
} from './predictor_v02.mjs';
import { q } from './dataset.mjs';

// Preserve every numeric input at full precision, including the CMR component
// evidence. Do not use rounded components.elo instead of competitive_rating.
const fields = {
  eloRaw:'competitive_rating', cmr:'cmr', technical:'technical_rating', resume:'resume_rating',
  strikingOffense:'striking_offense', strikingDefense:'striking_defense',
  wrestlingOffense:'wrestling_offense', wrestlingDefense:'wrestling_defense',
  grappling:'grappling', pace:'pace', finishing:'finishing', strengthOfSchedule:'strength_of_schedule',
  recentForm:'recent_form', confidence:'confidence', bouts:'sample_bouts', minutes:'sample_minutes'
};
export function ratingFromArchive(row) {
  if (!row) return null;
  return {...Object.fromEntries(Object.entries(fields).map(([key,column])=>[key,row[column]])),
    weightClass:row.weight_class,components:JSON.parse(row.components_json || '{}')};
}
function compactWarehouse(summary) {
  if(!summary)return null;
  return {
    pre_ufc_bouts:Number(summary.pre_ufc_bouts||0),
    pre_ufc_wins:Number(summary.pre_ufc_wins||0),
    pre_ufc_losses:Number(summary.pre_ufc_losses||0),
    pre_ufc_draws:Number(summary.pre_ufc_draws||0),
    pre_ufc_no_contests:Number(summary.pre_ufc_no_contests||0),
    pre_ufc_finishes:Number(summary.pre_ufc_finishes||0),
    pre_ufc_major_org_bouts:Number(summary.pre_ufc_major_org_bouts||0),
    days_from_last_pre_ufc_to_debut:Number(summary.days_from_last_pre_ufc_to_debut||0)
  };
}
function preserveRating(rating) {
  if (!rating) return null;
  return {...Object.fromEntries(Object.keys(fields).map(key=>[key,rating[key] ?? null])),
    weightClass:rating.weightClass ?? null,components:rating.components ?? {},warehouseSummary:compactWarehouse(rating.warehouseSummary)};
}
export function predictionSnapshot({a,b,ratingA,ratingB,probabilities,snapshotKey,sourceMaxDate,lockedAt,provenance='at_prediction',modelName='CageMetrix Win Probability',modelVersion=FORECAST_VERSION,cmrVersion=modelVersion==='0.2.1'?'0.3.2':modelVersion==='0.2.0'?'0.3.1':'0.3.0'}) {
  const baseline=modelName==='CageMetrix Elo Baseline';
  const elo=baseline || probabilities.modelUsed==='elo_fallback';
  const v02=!elo&&['0.2.0','0.2.1'].includes(modelVersion);
  const vector=elo
    ?[(ratingA?.eloRaw??1500)-(ratingB?.eloRaw??1500)]
    :v02
      ?predictorV02FeatureVector(ratingA,ratingB,ratingA?.warehouseSummary,ratingB?.warehouseSummary)
      :featureVector(ratingA,ratingB);
  const coefficients=elo
    ?[ELO_SLOPE]
    :v02
      ?PREDICTOR_V02_WEIGHTS.map((weight,index)=>weight/PREDICTOR_V02_SCALES[index])
      :FROZEN_RAW_COEFFICIENTS;
  const featureNames=v02?PREDICTOR_V02_FEATURE_NAMES:FEATURE_NAMES;
  const drivers=elo
    ?(vector[0]?[{label:'Elo competitive strength',contribution:vector[0]*ELO_SLOPE,side:vector[0]>0?'a':'b'}]:[])
    :v02?groupedV02Drivers(vector,7):groupedDrivers(vector,7);
  return {schema_version:v02?2:1,provenance,available:true,locked_at:lockedAt,input_snapshot_key:snapshotKey,
    source_max_date:sourceMaxDate,cmr_version:cmrVersion,model_name:modelName,model_version:modelVersion,
    model_used:baseline?'elo_baseline':probabilities.modelUsed,
    fighters:{a:{name:a.name,slug:a.slug,rating:preserveRating(ratingA)},b:{name:b.name,slug:b.slug,rating:preserveRating(ratingB)}},
    probability_a:probabilities.probabilityA,probability_b:probabilities.probabilityB,
    features:vector.map((value,i)=>({name:elo?'elo_diff':featureNames[i],value,coefficient:coefficients[i],contribution:value*coefficients[i]})),
    drivers,parameters:baseline?{slope:ELO_SLOPE,initial_elo:1500}:FORECAST_PARAMETERS};
}
export function recoverSnapshot(row,ratingA,ratingB,sourceMaxDate) {
  const unavailable=reason=>({schema_version:1,available:false,provenance:'unavailable',reason,
    input_snapshot_key:row.input_snapshot_key,locked_at:row.locked_at});
  if (!row.input_snapshot_key || !sourceMaxDate || !Number.isFinite(Date.parse(row.locked_at)) || sourceMaxDate>row.locked_at.slice(0,10)) return unavailable('The original pre-fight rating archive is unavailable. Current ratings are not substituted.');
  const baseline=row.model_name==='CageMetrix Elo Baseline';
  if (!['0.1.0','0.2.0','0.2.1'].includes(row.model_version) || !baseline && row.model_name!=='CageMetrix Win Probability')return unavailable('This model does not have a supported archived feature definition.');
  if ([ratingA,ratingB].some(r=>r&&Object.keys(fields).some(key=>!Number.isFinite(r[key]))))return unavailable('The archived rating is missing exact numeric model inputs.');
  // A missing rating is only an intentional neutral start if the saved record
  // explicitly identified that fallback. Missing archives never imply debutants.
  if ((!ratingA||!ratingB) && !/neutral.*Elo|debutants start at neutral Elo/i.test(row.notes||'')) return unavailable('One or both original fighter ratings are missing from the archive.');
  let prediction;
  if(baseline){
    const p=1/(1+Math.exp(-ELO_SLOPE*((ratingA?.eloRaw??1500)-(ratingB?.eloRaw??1500))));
    prediction={probabilityA:p,probabilityB:1-p,modelUsed:'elo_baseline',drivers:[]};
  }else if(row.model_version==='0.1.0'){
    const result=predictV01Matchup(ratingA,ratingB);
    prediction={...result,modelUsed:'predictor_v01'};
  }else{
    // Predictor 0.2.x requires the verified pre-UFC summary. New predictions
    // always store a complete snapshot, so absence here means reconstruction is
    // not sufficiently evidenced and must not substitute current warehouse data.
    return unavailable('The original Predictor 0.2 warehouse context is unavailable. The saved prediction is preserved without reconstructed inputs.');
  }
  if (Math.abs(prediction.probabilityA-row.fighter_a_probability)>1e-12 || Math.abs(prediction.probabilityB-row.fighter_b_probability)>1e-12) return unavailable('Archived inputs do not reproduce the locked probability. No reconstructed stats are displayed.');
  const savedDrivers=JSON.parse(row.top_factors_json||'[]');
  if (!baseline && row.model_version==='0.1.0' && (savedDrivers.length!==prediction.drivers.length || savedDrivers.some((d,i)=>d.label!==prediction.drivers[i].label || d.side!==prediction.drivers[i].side || Math.abs(d.contribution-prediction.drivers[i].contribution)>1e-12))) return unavailable('Archived drivers do not match the saved explanation.');
  const snapshot=predictionSnapshot({a:{name:row.fighter_a_name,slug:row.fighter_a_slug},b:{name:row.fighter_b_name,slug:row.fighter_b_slug},ratingA,ratingB,probabilities:prediction,snapshotKey:row.input_snapshot_key,sourceMaxDate,lockedAt:row.locked_at,provenance:'verified_archive',modelName:row.model_name,modelVersion:row.model_version,cmrVersion:'0.3.0'});
  // Verification may tolerate JSON/SQLite floating-point round trips; display
  // the stored probabilities verbatim, never the verification calculation.
  snapshot.probability_a=row.fighter_a_probability;snapshot.probability_b=row.fighter_b_probability;
  return snapshot;
}
export function snapshotInsertSql(predictionId,snapshot,guard='1') {
  return `INSERT INTO prediction_snapshots(prediction_id,snapshot_json,provenance) SELECT ${predictionId},${q(JSON.stringify(snapshot))},${q(snapshot.provenance)} WHERE ${guard} ON CONFLICT(prediction_id) DO NOTHING;`;
}
