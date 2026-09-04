import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const d1row = path => {
  const value = read(path);
  return (Array.isArray(value) ? value : [value]).flatMap(part => part.results || [])[0];
};
const phase = process.argv[2];
const before = phase === 'smoke' ? null : d1row('.cache/promotion/before-model-counts.json');

if (phase === 'cmr') {
  const after = d1row('.cache/promotion/cmr-verification.json');
  assert.ok(after && Number(after.cmr_0_3_2_ratings) >= 2600, `CMR 0.3.2 coverage failed: ${JSON.stringify(after)}`);
  assert.ok(Number(after.warehouse_prior_ratings) >= 1000, 'CMR warehouse-prior coverage is incomplete');
  assert.ok(Number(after.cmr_0_3_1_ratings) >= Number(before.cmr_0_3_1_ratings), 'CMR 0.3.1 history was not preserved');
  assert.equal(Number(after.raw_warehouse_rows), Number(before.raw_warehouse_rows), 'Raw warehouse provenance changed during model promotion');
  assert.equal(after.state_model_version, '0.3.2');
  assert.match(after.rating_run_source_key || '', /^0\.3\.2:[a-f0-9]{64}$/);
  assert.match(after.rating_run_notes || '', /canonical-history/);
  assert.match(after.rating_run_notes || '', /warehouse fingerprint [a-f0-9]{64}/);
  assert.match(after.model_warehouse_fingerprint || '', /^[a-f0-9]{64}$/);
  assert.equal(after.model_warehouse_fingerprint, after.state_warehouse_fingerprint);
  console.log(JSON.stringify(after, null, 2));
} else if (phase === 'predictor') {
  const after = d1row('.cache/promotion/predictor-verification.json');
  assert.ok(after && Number(after.predictor_0_2_1_predictions) >= 1, `Predictor 0.2.1 forecast verification failed: ${JSON.stringify(after)}`);
  assert.ok(Number(after.scheduled_predictions) >= 1, 'No scheduled Predictor 0.2.1 forecasts were locked');
  assert.equal(Number(after.verified_new_snapshots), Number(after.predictor_0_2_1_predictions), 'A Predictor 0.2.1 forecast lacks its frozen 0.3.2 pre-fight snapshot');
  assert.ok(Number(after.predictor_0_2_0_predictions) >= Number(before.predictor_0_2_0_predictions), 'Predictor 0.2.0 predictions were not preserved');
  console.log(JSON.stringify(after, null, 2));
} else if (phase === 'smoke') {
  const health = read('.cache/promotion/health.json');
  const rankings = read('.cache/promotion/rankings.json');
  const forecasts = read('.cache/promotion/forecasts.json');
  const parnasse = read('.cache/promotion/parnasse.json');
  const arman = read('.cache/promotion/tsarukyan.json');
  assert.ok(health.ok && health.model_version === '0.3.2' && health.data?.model_version === '0.3.2', `Health did not cut over: ${JSON.stringify(health)}`);
  assert.equal(rankings.meta?.model_version, '0.3.2');
  assert.ok(rankings.data?.length > 0, 'Production rankings are empty');
  assert.equal(forecasts.meta?.model_version, '0.2.1');
  assert.ok(forecasts.data?.length > 0, 'Production forecasts are empty');
  const history = parnasse.pre_ufc_bouts || [];
  const keys = history.map(row => row.source_fight_id);
  assert.equal(history.length, 17, 'Parnasse does not have 17 canonical pre-UFC bouts');
  assert.equal(new Set(keys).size, 17, 'Parnasse pre-UFC profile contains duplicates');
  assert.equal(parnasse.show_pre_ufc_history, true);
  assert.equal(arman.history_scope, 'ufc');
  assert.equal(arman.show_pre_ufc_history, false);
  assert.equal((arman.pre_ufc_bouts || []).length, 0);
  console.log(JSON.stringify({cmr:health.model_version,predictor:forecasts.meta.model_version,forecast_rows:forecasts.data.length,parnasse_pre_ufc:history.length,arman_scope:arman.history_scope}, null, 2));
} else {
  throw new Error('Usage: node scripts/verify-production-model-state.mjs <cmr|predictor|smoke>');
}
