import { FORECAST_PARAMETERS, ELO_SLOPE, forecast } from './forecast.mjs';
import { FEATURE_NAMES, FROZEN_RAW_COEFFICIENTS, featureVector, groupedDrivers } from './predictor_v01.mjs';
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
function preserveRating(rating) {
  if (!rating) return null;
  return {...Object.fromEntries(Object.keys(fields).map(key=>[key,rating[key] ?? null])),
    weightClass:rating.weightClass ?? null,components:rating.components ?? {}};
}
export function predictionSnapshot({a,b,ratingA,ratingB,probabilities,snapshotKey,sourceMaxDate,lockedAt,provenance='at_prediction',modelName='CageMetrix Win Probability'}) {
  const baseline=modelName==='CageMetrix Elo Baseline';
  const elo=baseline || probabilities.modelUsed==='elo_fallback';
  const vector=elo?[(ratingA?.eloRaw??1500)-(ratingB?.eloRaw??1500)]:featureVector(ratingA,ratingB);
  const coefficients=elo?[ELO_SLOPE]:FROZEN_RAW_COEFFICIENTS;
  return {schema_version:1,provenance,available:true,locked_at:lockedAt,input_snapshot_key:snapshotKey,
    source_max_date:sourceMaxDate,cmr_version:'0.3.0',model_name:modelName,model_version:'0.1.0',
    model_used:baseline?'elo_baseline':probabilities.modelUsed,
    fighters:{a:{name:a.name,slug:a.slug,rating:preserveRating(ratingA)},b:{name:b.name,slug:b.slug,rating:preserveRating(ratingB)}},
    probability_a:probabilities.probabilityA,probability_b:probabilities.probabilityB,
    features:vector.map((value,i)=>({name:elo?'elo_diff':FEATURE_NAMES[i],value,coefficient:coefficients[i],contribution:value*coefficients[i]})),
    drivers:elo?(vector[0]?[{label:'Elo competitive strength',contribution:vector[0]*ELO_SLOPE,side:vector[0]>0?'a':'b'}]:[]):groupedDrivers(vector,7),
    parameters:baseline?{slope:ELO_SLOPE,initial_elo:1500}:FORECAST_PARAMETERS};
}
export function recoverSnapshot(row,ratingA,ratingB,sourceMaxDate) {
  const unavailable=reason=>({schema_version:1,available:false,provenance:'unavailable',reason,
    input_snapshot_key:row.input_snapshot_key,locked_at:row.locked_at});
  if (!row.input_snapshot_key || !sourceMaxDate || !Number.isFinite(Date.parse(row.locked_at)) || sourceMaxDate>row.locked_at.slice(0,10)) return unavailable('The original pre-fight rating archive is unavailable. Current ratings are not substituted.');
  const baseline=row.model_name==='CageMetrix Elo Baseline';
  if (row.model_version!=='0.1.0' || !baseline && row.model_name!=='CageMetrix Win Probability')return unavailable('This model does not have a supported archived feature definition.');
  if ([ratingA,ratingB].some(r=>r&&Object.keys(fields).some(key=>!Number.isFinite(r[key]))))return unavailable('The archived rating is missing exact numeric model inputs.');
  // A missing rating is only an intentional neutral start if the saved record
  // explicitly identified that fallback. Missing archives never imply debutants.
  if ((!ratingA||!ratingB) && !/neutral.*Elo|debutants start at neutral Elo/i.test(row.notes||'')) return unavailable('One or both original fighter ratings are missing from the archive.');
  const prediction=baseline?(()=>{const p=1/(1+Math.exp(-ELO_SLOPE*((ratingA?.eloRaw??1500)-(ratingB?.eloRaw??1500))));return {probabilityA:p,probabilityB:1-p,modelUsed:'elo_baseline'};})():forecast(ratingA,ratingB);
  if (Math.abs(prediction.probabilityA-row.fighter_a_probability)>1e-12 || Math.abs(prediction.probabilityB-row.fighter_b_probability)>1e-12) return unavailable('Archived inputs do not reproduce the locked probability. No reconstructed stats are displayed.');
  const savedDrivers=JSON.parse(row.top_factors_json||'[]');
  if (!baseline && prediction.modelUsed==='predictor_v01' && (savedDrivers.length!==prediction.drivers.length || savedDrivers.some((d,i)=>d.label!==prediction.drivers[i].label || d.side!==prediction.drivers[i].side || Math.abs(d.contribution-prediction.drivers[i].contribution)>1e-12))) return unavailable('Archived drivers do not match the saved explanation.');
  const snapshot=predictionSnapshot({a:{name:row.fighter_a_name,slug:row.fighter_a_slug},b:{name:row.fighter_b_name,slug:row.fighter_b_slug},ratingA,ratingB,probabilities:prediction,snapshotKey:row.input_snapshot_key,sourceMaxDate,lockedAt:row.locked_at,provenance:'verified_archive',modelName:row.model_name});
  // Verification may tolerate JSON/SQLite floating-point round trips; display
  // the stored probabilities verbatim, never the verification calculation.
  snapshot.probability_a=row.fighter_a_probability;snapshot.probability_b=row.fighter_b_probability;
  return snapshot;
}
export function snapshotInsertSql(predictionId,snapshot,guard='1') {
  return `INSERT INTO prediction_snapshots(prediction_id,snapshot_json,provenance) SELECT ${predictionId},${q(JSON.stringify(snapshot))},${q(snapshot.provenance)} WHERE ${guard} ON CONFLICT(prediction_id) DO NOTHING;`;
}
