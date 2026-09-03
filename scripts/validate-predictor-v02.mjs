import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { FEATURE_NAMES, PREDICTOR_V02_VERSION, fitLogistic, predict, modelCoefficients, sigmoid } from './lib/predictor_v02.mjs';
import { RETROSPECTIVE_BENCHMARK as V01_BENCHMARK } from './lib/predictor_v01.mjs';

const FULL_FEATURES = FEATURE_NAMES.map((_, i) => i);
const LAMBDAS = [0.001, 0.01, 0.1, 0.5];

function probability(difference, slope) {
  return sigmoid(slope * difference);
}

function fitSlope(rows, key) {
  let low = 0;
  let high = 2;
  for (let i = 0; i < 70; i++) {
    const slope = (low + high) / 2;
    const gradient = rows.reduce((sum, row) => sum + row[key] * (probability(row[key], slope) - row.won), 0);
    if (gradient > 0) high = slope;
    else low = slope;
  }
  return (low + high) / 2;
}

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
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    low: i / 10,
    high: (i + 1) / 10,
    n: 0,
    predicted: 0,
    actual: 0
  }));
  for (const row of rows) {
    const p = Math.max(0, Math.min(0.999999, row[key]));
    const bucket = buckets[Math.min(9, Math.floor(p * 10))];
    bucket.n++;
    bucket.predicted += p;
    bucket.actual += row.won;
  }
  return buckets
    .filter(bucket => bucket.n)
    .map(bucket => ({
      range: `${Math.round(bucket.low * 100)}-${Math.round(bucket.high * 100)}%`,
      bouts: bucket.n,
      mean_predicted: bucket.predicted / bucket.n,
      observed_win_rate: bucket.actual / bucket.n
    }));
}

function pairedBrierInterval(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row);
  }
  const events = [...groups.values()];
  let seed = 0xC04F00D;
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
        sum += (row.predictor_p - row.won) ** 2 - (row.elo_p - row.won) ** 2;
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
    const model = fitLogistic(train, { featureIndexes: FULL_FEATURES, lambda, iterations: 600 });
    const scored = validation.map(row => ({ ...row, p: predict(model, row) }));
    const result = metrics(scored, 'p');
    trials.push({ lambda, brier: result.brier, log_loss: result.log_loss, accuracy: result.accuracy });
  }
  trials.sort((a, b) => a.log_loss - b.log_loss || a.brier - b.brier);
  return { lambda: trials[0].lambda, trials };
}

if (process.argv[1]?.endsWith('validate-predictor-v02.mjs')) {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  const historyPath = args.includes('--history') ? value('--history') : '.cache/cmr-v04-history.json';
  const history = JSON.parse(readFileSync(historyPath, 'utf8'));
  const rows = history.rows;

  const tuningTrain = rows.filter(row => row.date < '2022-01-01');
  const tuningValidation = rows.filter(row => row.date >= '2022-01-01' && row.date < '2023-01-01');
  const finalTrain = rows.filter(row => row.date < '2023-01-01');
  const test = rows.filter(row => row.date >= '2023-01-01');

  const tuning = chooseLambda(tuningTrain, tuningValidation);
  const predictor = fitLogistic(finalTrain, { featureIndexes: FULL_FEATURES, lambda: tuning.lambda, iterations: 1000 });
  const eloSlope = fitSlope(finalTrain, 'elo04');
  const cmrSlope = fitSlope(finalTrain, 'cmr04');

  const scored = test.map(row => ({
    ...row,
    predictor_p: predict(predictor, row),
    elo_p: probability(row.elo04, eloSlope),
    cmr_p: probability(row.cmr04, cmrSlope)
  }));
  const established = scored.filter(row => row.min_bouts >= 5);
  const predictorMetrics = metrics(scored, 'predictor_p');
  const eloMetrics = metrics(scored, 'elo_p');
  const cmrMetrics = metrics(scored, 'cmr_p');

  const report = {
    predictor_version: PREDICTOR_V02_VERSION,
    rating_model_version: '0.4.0-candidate',
    generated_at: new Date().toISOString(),
    source_sha256: history.source_sha256,
    design: 'Leakage-safe walk-forward CMR 0.4 feature generation. Hyperparameter selection uses 2022 only; final Predictor 0.2 candidate is fit on 2018-2022 and evaluated from 2023 onward. No 2023+ result is used to select features, lambda, or fit coefficients.',
    matched_bouts_since_2018: rows.length,
    final_train_bouts_2018_2022: finalTrain.length,
    evaluation_bouts_2023_plus: test.length,
    tuning,
    probability_slopes: { elo: eloSlope, cmr: cmrSlope },
    results: {
      predictor_v02_candidate: predictorMetrics,
      calibrated_elo_draw_aware: eloMetrics,
      calibrated_cmr_v04: cmrMetrics
    },
    established: {
      definition: 'Both fighters have at least five prior rated bouts',
      predictor_v02_candidate: metrics(established, 'predictor_p'),
      calibrated_elo_draw_aware: metrics(established, 'elo_p')
    },
    predictor_minus_elo_brier_95_interval: pairedBrierInterval(scored),
    calibration: calibration(scored, 'predictor_p'),
    coefficients: modelCoefficients(predictor),
    comparison_to_frozen_predictor_v01: {
      frozen_v01: V01_BENCHMARK,
      same_nominal_evaluation_window: V01_BENCHMARK.evaluation_start === '2023-01-01',
      candidate_accuracy_delta: predictorMetrics.accuracy - V01_BENCHMARK.accuracy,
      candidate_brier_delta: predictorMetrics.brier - V01_BENCHMARK.brier,
      candidate_log_loss_delta: predictorMetrics.log_loss - V01_BENCHMARK.log_loss
    },
    promotion_gate: {
      note: 'A candidate is not promoted automatically. Prefer lower Brier/log loss without a material accuracy collapse, then review calibration and behavior before freezing.',
      brier_not_worse_than_v01: predictorMetrics.brier <= V01_BENCHMARK.brier,
      log_loss_not_worse_than_v01: predictorMetrics.log_loss <= V01_BENCHMARK.log_loss,
      accuracy_within_one_point_of_v01: predictorMetrics.accuracy >= V01_BENCHMARK.accuracy - 0.01
    }
  };

  mkdirSync('.cache', { recursive: true });
  writeFileSync('.cache/predictor-v02-validation.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync('.cache/predictor-v02-predictions.json', JSON.stringify(scored));
  console.log(JSON.stringify(report, null, 2));
}
