import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  FEATURE_NAMES,
  PREDICTOR_V011_VERSION,
  fitLogistic,
  predict,
  modelCoefficients
} from './lib/predictor_v011.mjs';
import { RETROSPECTIVE_BENCHMARK as V01_BENCHMARK } from './lib/predictor_v01.mjs';

const FULL_FEATURES = FEATURE_NAMES.map((_, i) => i);
const LAMBDAS = [0.001, 0.01, 0.1, 0.5];

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
  return buckets.filter(bucket => bucket.n).map(bucket => ({
    range: `${Math.round(bucket.low * 100)}-${Math.round(bucket.high * 100)}%`,
    bouts: bucket.n,
    mean_predicted: bucket.predicted / bucket.n,
    observed_win_rate: bucket.actual / bucket.n
  }));
}

function pairedBrierInterval(rows, aKey, bKey) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row);
  }
  const events = [...groups.values()];
  let seed = 0x011C04;
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
    diffs.push(sum / n);
  }
  diffs.sort((a, b) => a - b);
  return [diffs[37], diffs[1461]];
}

function chooseLambda(train, validation) {
  const trials = [];
  for (const lambda of LAMBDAS) {
    const model = fitLogistic(train, { featureIndexes: FULL_FEATURES, lambda, iterations: 1800 });
    const scored = validation.map(row => ({ ...row, p: predict(model, row) }));
    const result = metrics(scored, 'p');
    trials.push({ lambda, brier: result.brier, log_loss: result.log_loss, accuracy: result.accuracy });
  }
  trials.sort((a, b) => a.log_loss - b.log_loss || a.brier - b.brier);
  return { lambda: trials[0].lambda, trials };
}

if (process.argv[1]?.endsWith('validate-predictor-v011.mjs')) {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  const historyPath = args.includes('--history') ? value('--history') : '.cache/cmr-v04-history.json';
  const history = JSON.parse(readFileSync(historyPath, 'utf8'));
  const rows = history.rows.map(row => ({ ...row, x: row.x_v01_cmr04 }));
  if (rows.some(row => !Array.isArray(row.x) || row.x.length !== FEATURE_NAMES.length)) {
    throw new Error('CMR 0.4 history is missing aligned Predictor 0.1 feature vectors');
  }

  const tuningTrain = rows.filter(row => row.date < '2022-01-01');
  const tuningValidation = rows.filter(row => row.date >= '2022-01-01' && row.date < '2023-01-01');
  const finalTrain = rows.filter(row => row.date < '2023-01-01');
  const test = rows.filter(row => row.date >= '2023-01-01');

  const tuning = chooseLambda(tuningTrain, tuningValidation);
  const predictor = fitLogistic(finalTrain, { featureIndexes: FULL_FEATURES, lambda: tuning.lambda, iterations: 2500 });
  const scored = test.map(row => ({
    ...row,
    predictor_v011_p: predict(predictor, row),
    predictor_v01_p: row.v01_p_cmr03
  }));
  const established = scored.filter(row => row.min_bouts >= 5);
  const result011 = metrics(scored, 'predictor_v011_p');
  const alignedV01 = metrics(scored, 'predictor_v01_p');

  const report = {
    predictor_version: PREDICTOR_V011_VERSION,
    rating_model_version: '0.4.0-candidate',
    generated_at: new Date().toISOString(),
    source_sha256: history.source_sha256,
    design: 'Predictor 0.1.1 preserves the exact 24 Predictor 0.1 features and interactions, but refits their coefficients on leakage-safe CMR 0.4 ratings. Lambda selection uses 2022 only; final coefficients use 2018-2022; 2023+ remains untouched holdout.',
    feature_count: FEATURE_NAMES.length,
    feature_names: FEATURE_NAMES,
    matched_bouts_since_2018: rows.length,
    final_train_bouts_2018_2022: finalTrain.length,
    evaluation_bouts_2023_plus: test.length,
    tuning,
    results: {
      predictor_v011_candidate: result011,
      frozen_predictor_v01_aligned: alignedV01
    },
    established: {
      definition: 'Both fighters have at least five prior rated bouts',
      predictor_v011_candidate: metrics(established, 'predictor_v011_p'),
      frozen_predictor_v01_aligned: metrics(established, 'predictor_v01_p')
    },
    predictor_v011_minus_v01_brier_95_interval: pairedBrierInterval(scored, 'predictor_v011_p', 'predictor_v01_p'),
    calibration: calibration(scored, 'predictor_v011_p'),
    coefficients: modelCoefficients(predictor),
    comparison_to_published_predictor_v01: {
      published_v01: V01_BENCHMARK,
      aligned_v01: alignedV01,
      candidate_accuracy_delta: result011.accuracy - alignedV01.accuracy,
      candidate_brier_delta: result011.brier - alignedV01.brier,
      candidate_log_loss_delta: result011.log_loss - alignedV01.log_loss
    },
    promotion_gate: {
      note: 'Do not promote automatically. A 0.1.1 candidate should preserve the 0.1 architecture while matching or improving the frozen 0.1 holdout record after the CMR 0.4 input correction.',
      accuracy_not_worse_than_v01: result011.accuracy >= alignedV01.accuracy,
      brier_not_worse_than_v01: result011.brier <= alignedV01.brier,
      log_loss_not_worse_than_v01: result011.log_loss <= alignedV01.log_loss
    }
  };

  mkdirSync('.cache', { recursive: true });
  writeFileSync('.cache/predictor-v011-validation.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync('.cache/predictor-v011-predictions.json', JSON.stringify(scored));
  console.log(JSON.stringify(report, null, 2));
}
