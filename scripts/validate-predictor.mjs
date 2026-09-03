import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseDelimited } from './lib/csv.mjs';
import { buildObservations, buildRatings } from './lib/model_v03.mjs';
import { hash, MODEL_VERSION } from './lib/dataset.mjs';
import { FEATURE_NAMES, PREDICTOR_VERSION, FROZEN_RAW_COEFFICIENTS, featureVector, fitLogistic, predict, modelCoefficients, sigmoid } from './lib/predictor_v01.mjs';

const ELO_FEATURE = 0;
const CMR_FEATURE = 1;
const BASIC_FEATURES = [ELO_FEATURE, CMR_FEATURE];
const FULL_FEATURES = FEATURE_NAMES.map((_, i) => i);
const LAMBDAS = [0.001, 0.01, 0.1, 0.5];

function probability(difference, slope) { return sigmoid(slope * difference); }
function fitSlope(rows, key) {
  let low = 0, high = 2;
  for (let i = 0; i < 70; i++) {
    const slope = (low + high) / 2;
    const gradient = rows.reduce((sum, r) => sum + r[key] * (probability(r[key], slope) - r.won), 0);
    if (gradient > 0) high = slope; else low = slope;
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
  const buckets = Array.from({ length: 10 }, (_, i) => ({ low: i / 10, high: (i + 1) / 10, n: 0, predicted: 0, actual: 0 }));
  for (const row of rows) {
    const p = Math.max(0, Math.min(0.999999, row[key]));
    const bucket = buckets[Math.min(9, Math.floor(p * 10))];
    bucket.n++; bucket.predicted += p; bucket.actual += row.won;
  }
  return buckets.filter(b => b.n).map(b => ({ range: `${Math.round(b.low * 100)}-${Math.round(b.high * 100)}%`, bouts: b.n, mean_predicted: b.predicted / b.n, observed_win_rate: b.actual / b.n }));
}
function pairedBrierInterval(rows) {
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.date)) groups.set(row.date, []); groups.get(row.date).push(row); }
  const events = [...groups.values()];
  let seed = 0xC0FFEE;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const diffs = [];
  for (let i = 0; i < 1000; i++) {
    let sum = 0, n = 0;
    for (let j = 0; j < events.length; j++) for (const row of events[Math.floor(random() * events.length)]) { sum += (row.predictor_p - row.won) ** 2 - (row.elo_p - row.won) ** 2; n++; }
    diffs.push(sum / n);
  }
  diffs.sort((a, b) => a - b);
  return [diffs[25], diffs[974]];
}

export function historicalPredictorRows(pairs, start = '2018-01-01') {
  const dates = [...new Set(pairs.map(p => p.red.eventDate))].filter(d => d >= start).sort();
  const rows = [];
  let eligible = 0;
  for (const [index, date] of dates.entries()) {
    const prior = pairs.filter(p => p.red.eventDate < date);
    const ratings = new Map(buildRatings(prior).ratings.map(r => [r.fighterId, r]));
    for (const pair of pairs.filter(p => p.red.eventDate === date && !p.red.noContest && p.red.won !== 0.5)) {
      eligible++;
      const a = ratings.get(pair.red.fighterId), b = ratings.get(pair.blue.fighterId);
      if (!a || !b) continue;
      rows.push({ date, a: pair.red.fighterId, b: pair.blue.fighterId, won: pair.red.won, elo: a.eloRaw - b.eloRaw, cmr: a.cmr - b.cmr, min_bouts: Math.min(a.bouts, b.bouts), x: featureVector(a, b) });
    }
    if (index % 50 === 0) console.log(`Predictor history: ${index + 1}/${dates.length} event dates (${date})`);
  }
  return { rows, eligible };
}

function chooseLambda(train, validation, featureIndexes) {
  const trials = [];
  for (const lambda of LAMBDAS) {
    const model = fitLogistic(train, { featureIndexes, lambda, iterations: 600 });
    const scored = validation.map(row => ({ ...row, p: predict(model, row) }));
    const result = metrics(scored, 'p');
    trials.push({ lambda, brier: result.brier, log_loss: result.log_loss, accuracy: result.accuracy });
  }
  trials.sort((a, b) => a.log_loss - b.log_loss || a.brier - b.brier);
  return { lambda: trials[0].lambda, trials };
}

if (process.argv[1]?.endsWith('validate-predictor.mjs')) {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  if (!args.includes('--stats')) throw new Error('Provide --stats with the pinned merged source CSV');
  const source = readFileSync(value('--stats'), 'utf8');
  const pairs = buildObservations(parseDelimited(source, ';'));
  const { rows, eligible } = historicalPredictorRows(pairs);
  const tuningTrain = rows.filter(r => r.date < '2022-01-01');
  const tuningValidation = rows.filter(r => r.date >= '2022-01-01' && r.date < '2023-01-01');
  const finalTrain = rows.filter(r => r.date < '2023-01-01');
  const test = rows.filter(r => r.date >= '2023-01-01');
  const fullTuning = chooseLambda(tuningTrain, tuningValidation, FULL_FEATURES);
  const basicTuning = chooseLambda(tuningTrain, tuningValidation, BASIC_FEATURES);
  const predictor = fitLogistic(finalTrain, { featureIndexes: FULL_FEATURES, lambda: fullTuning.lambda, iterations: 900 });
  const basic = fitLogistic(finalTrain, { featureIndexes: BASIC_FEATURES, lambda: basicTuning.lambda, iterations: 900 });
  const eloSlope = fitSlope(finalTrain, 'elo'), cmrSlope = fitSlope(finalTrain, 'cmr');
  const scored = test.map(row => ({ ...row, predictor_p: predict(predictor, row), elo_cmr_p: predict(basic, row), elo_p: probability(row.elo, eloSlope), cmr_p: probability(row.cmr, cmrSlope) }));
  const established = scored.filter(r => r.min_bouts >= 5);
  const years = [...new Set(scored.map(r => r.date.slice(0, 4)))];
  const fittedRaw = modelCoefficients(predictor).sort((a,b)=>FEATURE_NAMES.indexOf(a.feature)-FEATURE_NAMES.indexOf(b.feature)).map(x=>x.raw_coefficient);
  const frozenDelta = Math.max(...fittedRaw.map((value,i)=>Math.abs(value-FROZEN_RAW_COEFFICIENTS[i])));
  const report = {
    predictor_version: PREDICTOR_VERSION,
    rating_model_version: MODEL_VERSION,
    source_sha256: hash(source),
    generated_at: new Date().toISOString(),
    source_max_date: pairs.map(p => p.red.eventDate).sort().at(-1),
    design: 'Leakage-safe walk-forward feature generation. Hyperparameter selection uses 2022 only; final model fit on 2018-2022 and evaluated from 2023 onward.',
    decisive_bouts_since_2018: eligible,
    matched_bouts_since_2018: rows.length,
    final_train_bouts_2018_2022: finalTrain.length,
    evaluation_bouts_2023_plus: test.length,
    tuning: { full: fullTuning, elo_plus_cmr: basicTuning },
    frozen_coefficient_max_abs_delta: frozenDelta,
    results: { predictor_v01: metrics(scored, 'predictor_p'), elo_plus_cmr: metrics(scored, 'elo_cmr_p'), calibrated_elo: metrics(scored, 'elo_p'), calibrated_cmr: metrics(scored, 'cmr_p') },
    established: { definition: 'Both fighters have at least five prior rated bouts', predictor_v01: metrics(established, 'predictor_p'), calibrated_elo: metrics(established, 'elo_p') },
    predictor_minus_elo_brier_95_interval: pairedBrierInterval(scored),
    calibration: calibration(scored, 'predictor_p'),
    coefficients: modelCoefficients(predictor),
    per_year: Object.fromEntries(years.map(year => { const subset = scored.filter(r => r.date.startsWith(year)); return [year, { predictor_v01: metrics(subset, 'predictor_p'), calibrated_elo: metrics(subset, 'elo_p') }]; }))
  };
  const output = args.includes('--output') ? value('--output') : '.cache/predictor-validation.json';
  mkdirSync(output.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  writeFileSync('.cache/predictor-predictions.json', JSON.stringify(scored));
  console.log(JSON.stringify(report, null, 2));
}
