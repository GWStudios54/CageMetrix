import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseDelimited } from './lib/csv.mjs';
import { buildRatings as buildRatings03 } from './lib/model_v03.mjs';
import { buildObservations, buildRatings as buildRatings04 } from './lib/model_v04.mjs';
import { buildStyleProfiles, neutralStyle } from './lib/style_v02.mjs';
import {
  FEATURE_NAMES,
  FEATURE_SETS,
  PREDICTOR_V02_VERSION,
  featureVector,
  fitLogistic,
  predict,
  modelCoefficients
} from './lib/predictor_v02.mjs';
import {
  featureVector as featureVector01,
  predictFrozenVector,
  RETROSPECTIVE_BENCHMARK as V01_BENCHMARK
} from './lib/predictor_v01.mjs';
import { STATS_URL, hash } from './lib/dataset.mjs';

const LAMBDAS = [0.001, 0.01, 0.1, 0.5, 1.0];

function metrics(rows, key) {
  if (!rows.length) return { bouts: 0, accuracy: null, brier: null, log_loss: null };
  const n = rows.length;
  return {
    bouts: n,
    accuracy: rows.reduce((sum, row) => sum + (row[key] === 0.5 ? 0.5 : Number((row[key] > 0.5) === Boolean(row.won))), 0) / n,
    brier: rows.reduce((sum, row) => sum + (row[key] - row.won) ** 2, 0) / n,
    log_loss: -rows.reduce((sum, row) => sum + Math.log(Math.max(1e-12, row.won ? row[key] : 1 - row[key])), 0) / n
  };
}

function calibration(rows, key) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ low: i / 10, high: (i + 1) / 10, n: 0, predicted: 0, actual: 0 }));
  for (const row of rows) {
    const p = Math.max(0, Math.min(0.999999, row[key]));
    const bucket = buckets[Math.min(9, Math.floor(p * 10))];
    bucket.n++;
    bucket.predicted += p;
    bucket.actual += row.won;
  }
  return buckets.filter(b => b.n).map(b => ({
    range: `${Math.round(b.low * 100)}-${Math.round(b.high * 100)}%`,
    bouts: b.n,
    mean_predicted: b.predicted / b.n,
    observed_win_rate: b.actual / b.n
  }));
}

function pairedBrierInterval(rows, aKey, bKey) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row);
  }
  const events = [...groups.values()];
  let seed = 0xC02026;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const diffs = [];
  for (let i = 0; i < 1500; i++) {
    let sum = 0;
    let n = 0;
    for (let j = 0; j < events.length; j++) {
      const sampled = events[Math.floor(random() * events.length)];
      for (const row of sampled) {
        sum += (row[aKey] - row.won) ** 2 - (row[bKey] - row.won) ** 2;
        n++;
      }
    }
    diffs.push(sum / Math.max(1, n));
  }
  diffs.sort((a, b) => a - b);
  return [diffs[37], diffs[1461]];
}

async function sourceText(args) {
  const value = key => args[args.indexOf(key) + 1];
  if (args.includes('--stats')) return readFileSync(value('--stats'), 'utf8');
  const response = await fetch(STATS_URL, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Could not fetch pinned stats source (${response.status})`);
  return response.text();
}

function historicalRows(pairs, start = '2018-01-01') {
  const dates = [...new Set(pairs.map(p => p.red.eventDate))].filter(date => date >= start).sort();
  const rows = [];
  for (const [index, date] of dates.entries()) {
    const prior = pairs.filter(p => p.red.eventDate < date);
    const ratings03 = new Map(buildRatings03(prior).ratings.map(r => [r.fighterId, r]));
    const ratings04 = new Map(buildRatings04(prior).ratings.map(r => [r.fighterId, r]));
    const styles = buildStyleProfiles(prior);
    for (const pair of pairs.filter(p => p.red.eventDate === date && !p.red.noContest && p.red.won !== 0.5)) {
      const a03 = ratings03.get(pair.red.fighterId);
      const b03 = ratings03.get(pair.blue.fighterId);
      const a04 = ratings04.get(pair.red.fighterId);
      const b04 = ratings04.get(pair.blue.fighterId);
      if (!a03 || !b03 || !a04 || !b04) continue;
      const sa = styles.get(pair.red.fighterId) || neutralStyle();
      const sb = styles.get(pair.blue.fighterId) || neutralStyle();
      rows.push({
        date,
        a: pair.red.fighterId,
        b: pair.blue.fighterId,
        won: pair.red.won,
        min_bouts: Math.min(a04.bouts, b04.bouts),
        x: featureVector(a04, b04, sa, sb),
        v01_p: predictFrozenVector(featureVector01(a03, b03))
      });
    }
    if (index % 50 === 0) console.log(`Predictor 0.2 style history: ${index + 1}/${dates.length} event dates (${date})`);
  }
  return rows;
}

function selectArchitecture(train, validation) {
  const trials = [];
  for (const [featureSet, featureIndexes] of Object.entries(FEATURE_SETS)) {
    for (const lambda of LAMBDAS) {
      const model = fitLogistic(train, { featureIndexes, lambda, iterations: 650 });
      const scored = validation.map(row => ({ ...row, p: predict(model, row) }));
      const m = metrics(scored, 'p');
      trials.push({ feature_set: featureSet, feature_count: featureIndexes.length, lambda, ...m });
    }
  }
  trials.sort((a, b) => a.log_loss - b.log_loss || a.brier - b.brier || b.accuracy - a.accuracy || a.feature_count - b.feature_count);
  return { selected: trials[0], trials };
}

const args = process.argv.slice(2);
const source = await sourceText(args);
const pairs = buildObservations(parseDelimited(source, ';'));
const rows = historicalRows(pairs);
const tuningTrain = rows.filter(row => row.date < '2022-01-01');
const tuningValidation = rows.filter(row => row.date >= '2022-01-01' && row.date < '2023-01-01');
const finalTrain = rows.filter(row => row.date < '2023-01-01');
const test = rows.filter(row => row.date >= '2023-01-01');

const architecture = selectArchitecture(tuningTrain, tuningValidation);
const selectedIndexes = FEATURE_SETS[architecture.selected.feature_set];
const predictor = fitLogistic(finalTrain, {
  featureIndexes: selectedIndexes,
  lambda: architecture.selected.lambda,
  iterations: 1200
});

const scored = test.map(row => ({ ...row, predictor_p: predict(predictor, row) }));
const established = scored.filter(row => row.min_bouts >= 5);
const predictorMetrics = metrics(scored, 'predictor_p');
const v01Metrics = metrics(scored, 'v01_p');
const alignment = {
  accuracy_delta: v01Metrics.accuracy - V01_BENCHMARK.accuracy,
  brier_delta: v01Metrics.brier - V01_BENCHMARK.brier,
  log_loss_delta: v01Metrics.log_loss - V01_BENCHMARK.log_loss
};

if (Math.abs(alignment.brier_delta) > 1e-10 || Math.abs(alignment.log_loss_delta) > 1e-10) {
  throw new Error(`Predictor 0.1 baseline alignment failed: ${JSON.stringify(alignment)}`);
}

const report = {
  predictor_version: PREDICTOR_V02_VERSION,
  rating_model_version: '0.4.0-candidate',
  source_sha256: hash(source),
  generated_at: new Date().toISOString(),
  design: 'CMR 0.4 skill ratings plus explicit historical style/pressure features. Style describes what a fighter tends to initiate; CMR describes how well the fighter performs when the skill is tested. Architecture and regularization are selected using 2022 only, then coefficients are fit on 2018-2022.',
  historical_holdout_status: 'The 2023+ window has been observed during earlier model-family experiments. It is excluded from architecture selection and coefficient fitting here, but final confirmation should be prospective on post-freeze fights.',
  feature_count_available: FEATURE_NAMES.length,
  feature_names: FEATURE_NAMES,
  style_features: [
    'significant-strike attempts per minute',
    'takedown attempts per 15 minutes',
    'historical control-time share',
    'submission attempts per 15 minutes',
    'pressure-vs-defense interactions',
    'pressure × skill × opposing-defense interactions'
  ],
  matched_bouts_since_2018: rows.length,
  final_train_bouts_2018_2022: finalTrain.length,
  evaluation_bouts_2023_plus: test.length,
  architecture_selection: architecture,
  selected_feature_names: selectedIndexes.map(i => FEATURE_NAMES[i]),
  results: {
    predictor_v02_style_candidate: predictorMetrics,
    frozen_predictor_v01_aligned: v01Metrics
  },
  established: {
    definition: 'Both fighters have at least five prior rated bouts',
    predictor_v02_style_candidate: metrics(established, 'predictor_p'),
    frozen_predictor_v01_aligned: metrics(established, 'v01_p')
  },
  predictor_v02_minus_v01_brier_95_interval: pairedBrierInterval(scored, 'predictor_p', 'v01_p'),
  calibration: calibration(scored, 'predictor_p'),
  coefficients: modelCoefficients(predictor),
  baseline_alignment: alignment,
  comparison_to_production_v01: {
    production_v01: V01_BENCHMARK,
    candidate_accuracy_delta: predictorMetrics.accuracy - v01Metrics.accuracy,
    candidate_brier_delta: predictorMetrics.brier - v01Metrics.brier,
    candidate_log_loss_delta: predictorMetrics.log_loss - v01Metrics.log_loss
  },
  promotion_gate: {
    note: 'Historical metrics are useful but the model-family holdout has been observed. Do not silently replace Predictor 0.1. Require at minimum non-worse historical probability metrics plus prospective review after freeze.',
    accuracy_not_worse_than_v01: predictorMetrics.accuracy >= v01Metrics.accuracy,
    brier_not_worse_than_v01: predictorMetrics.brier <= v01Metrics.brier,
    log_loss_not_worse_than_v01: predictorMetrics.log_loss <= v01Metrics.log_loss,
    prospective_confirmation_required: true
  }
};

mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/predictor-v02-style-validation.json', JSON.stringify(report, null, 2) + '\n');
writeFileSync('.cache/predictor-v02-style-predictions.json', JSON.stringify(scored));
console.log(JSON.stringify(report, null, 2));
