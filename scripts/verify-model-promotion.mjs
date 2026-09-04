import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREDICTOR_V02_FEATURE_NAMES,
  PREDICTOR_V02_LAMBDA,
  PREDICTOR_V02_PRIOR_OPTIONS,
  PREDICTOR_V02_SCALES,
  PREDICTOR_V02_VERSION,
  PREDICTOR_V02_WEIGHTS
} from './lib/predictor_v02.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const benchmark = read('.cache/warehouse-model-benchmark.json');
const common = read('.cache/predictor-v02-common-validation.json');
const fit = read('.cache/predictor-v02-fit.json');
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`);

assert.equal(PREDICTOR_V02_VERSION, '0.2.1');
assert.equal(benchmark.candidate_predictor_version, '0.2.1');
assert.equal(benchmark.baseline_cmr_version, '0.3.1');
assert.equal(benchmark.candidate_cmr_version, '0.3.2-warehouse-candidate');
assert.equal(benchmark.cmr.promotion_recommended, true);
assert.equal(benchmark.predictor.promotion_recommended, true);
assert.deepEqual(benchmark.cmr.selected_prior, PREDICTOR_V02_PRIOR_OPTIONS);
assert.equal(benchmark.predictor.selected_lambda, PREDICTOR_V02_LAMBDA);
assert.equal(benchmark.predictor.feature_count_v02, 33);
assert.ok(benchmark.predictor.common_holdout.bouts >= 1400);

const baseline = benchmark.predictor.common_holdout.predictor_v01;
const candidate = benchmark.predictor.common_holdout.predictor_v02;
assert.ok(candidate.brier < baseline.brier, 'Predictor Brier score did not improve');
assert.ok(candidate.log_loss < baseline.log_loss, 'Predictor log loss did not improve');
assert.ok(candidate.accuracy >= baseline.accuracy - 0.005, 'Predictor accuracy materially regressed');
const cmrBaseline = benchmark.cmr.common_holdout.baseline;
const cmrCandidate = benchmark.cmr.common_holdout.warehouse_candidate;
assert.ok(cmrCandidate.brier < cmrBaseline.brier, 'CMR Brier score did not improve');
assert.ok(cmrCandidate.log_loss < cmrBaseline.log_loss, 'CMR log loss did not improve');

assert.equal(common.promotion_recommended, true);
assert.equal(common.common_holdout.bouts, benchmark.predictor.common_holdout.bouts);
close(common.common_holdout.predictor_v01.brier, baseline.brier, 'common baseline Brier');
close(common.common_holdout.predictor_v02.brier, candidate.brier, 'common candidate Brier');
close(common.common_holdout.predictor_v02.log_loss, candidate.log_loss, 'common candidate log loss');

assert.equal(fit.version, PREDICTOR_V02_VERSION);
assert.equal(fit.lambda, PREDICTOR_V02_LAMBDA);
assert.deepEqual(fit.rating_prior, PREDICTOR_V02_PRIOR_OPTIONS);
assert.deepEqual(fit.feature_names, PREDICTOR_V02_FEATURE_NAMES);
assert.equal(fit.scales.length, 33);
assert.equal(fit.weights.length, 33);
fit.scales.forEach((value, index) => close(PREDICTOR_V02_SCALES[index], value, `scale ${index}`));
fit.weights.forEach((value, index) => close(PREDICTOR_V02_WEIGHTS[index], value, `weight ${index}`));

console.log(JSON.stringify({
  common_holdout_bouts: candidate.bouts,
  predictor_v01: baseline,
  predictor_v02_1: candidate,
  cmr_0_3_1: cmrBaseline,
  cmr_0_3_2: cmrCandidate,
  lambda: fit.lambda,
  features: fit.feature_names.length,
  warehouse_bouts: benchmark.warehouse.pre_ufc_bouts
}, null, 2));
