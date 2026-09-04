import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseDelimited } from './lib/csv.mjs';
import { buildObservations, buildRatings } from './lib/model_v03.mjs';
import { MODEL_VERSION, STATS_URL } from './lib/dataset.mjs';
import {
  FEATURE_NAMES as BASE_FEATURE_NAMES,
  featureVector as baseFeatureVector,
  fitLogistic,
  predict,
  predictFrozenVector,
  sigmoid
} from './lib/predictor_v01.mjs';
import {
  applyWarehousePrior,
  normalizeFighterName,
  warehousePrior
} from './lib/warehouse-prior.mjs';
import {
  PREDICTOR_V02_FEATURE_NAMES,
  PREDICTOR_V02_VERSION,
  coefficientsWithNames,
  predictorV02FeatureVector
} from './lib/predictor_v02.mjs';

const DB = 'cagemetrix';
const CMR_CANDIDATE_VERSION = '0.3.1-warehouse-candidate';
const START_DATE = '2018-01-01';
const TUNE_DATE = '2022-01-01';
const TEST_DATE = '2023-01-01';
const LAMBDAS = [0.003, 0.01, 0.03, 0.1];
const PRIOR_OPTIONS = [
  { maxWeight: 0.35, decayBouts: 2 },
  { maxWeight: 0.35, decayBouts: 3 },
  { maxWeight: 0.50, decayBouts: 2 },
  { maxWeight: 0.50, decayBouts: 3 },
  { maxWeight: 0.50, decayBouts: 4 },
  { maxWeight: 0.65, decayBouts: 3 },
  { maxWeight: 0.65, decayBouts: 4 }
];

const finite = value => Number.isFinite(Number(value));

function wrangler(args) {
  return execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
}

function queryRows(statement) {
  const raw = wrangler(['d1', 'execute', DB, '--remote', '--command', statement, '--json']);
  const parsed = JSON.parse(raw);
  const parts = Array.isArray(parsed) ? parsed : [parsed];
  return parts.flatMap(part => part.results || []);
}

function pagedQuery(selectSql, pageSize = 400) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = queryRows(`${selectSql} LIMIT ${pageSize} OFFSET ${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function metrics(rows, key) {
  if (!rows.length) return { bouts: 0, accuracy: null, brier: null, log_loss: null };
  return {
    bouts: rows.length,
    accuracy: rows.reduce((sum, row) => sum + Number((row[key] >= 0.5) === Boolean(row.won)), 0) / rows.length,
    brier: rows.reduce((sum, row) => sum + (row[key] - row.won) ** 2, 0) / rows.length,
    log_loss: -rows.reduce((sum, row) => {
      const p = Math.max(1e-12, Math.min(1 - 1e-12, row[key]));
      return sum + Math.log(row.won ? p : 1 - p);
    }, 0) / rows.length
  };
}

function calibration(rows, key) {
  const buckets = Array.from({ length: 10 }, (_, index) => ({ low: index / 10, high: (index + 1) / 10, n: 0, predicted: 0, actual: 0 }));
  for (const row of rows) {
    const p = Math.max(0, Math.min(0.999999, row[key]));
    const bucket = buckets[Math.min(9, Math.floor(p * 10))];
    bucket.n += 1;
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

function probability(difference, slope) {
  return sigmoid(slope * difference);
}

function fitSlope(rows, key) {
  if (!rows.length) return 0;
  let low = 0;
  let high = 2;
  for (let iteration = 0; iteration < 70; iteration++) {
    const slope = (low + high) / 2;
    const gradient = rows.reduce((sum, row) => sum + row[key] * (probability(row[key], slope) - row.won), 0);
    if (gradient > 0) high = slope;
    else low = slope;
  }
  return (low + high) / 2;
}

function warehouseSummaryMap() {
  const rows = pagedQuery(`
    SELECT f.name AS fighter_name,h.*
    FROM ufc_fighter_history_summary h
    JOIN fighters f ON f.id=h.fighter_id
    WHERE h.pre_ufc_bouts > 0
    ORDER BY h.fighter_id
  `);
  const map = new Map();
  for (const row of rows) {
    const key = normalizeFighterName(row.fighter_name);
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return { rows, map };
}

function collectHistoricalRecords(pairs, summaries) {
  const allDates = [...new Set(pairs.map(pair => pair.red.eventDate))].sort();
  const evaluationDates = allDates.filter(date => date >= START_DATE);
  const byDate = new Map();
  for (const pair of pairs) {
    if (!byDate.has(pair.red.eventDate)) byDate.set(pair.red.eventDate, []);
    byDate.get(pair.red.eventDate).push(pair);
  }

  const prior = pairs.filter(pair => pair.red.eventDate < START_DATE);
  const records = [];
  let decisive = 0;
  for (const [index, date] of evaluationDates.entries()) {
    const ratings = new Map(buildRatings(prior).ratings.map(rating => [rating.fighterId, rating]));
    const eventPairs = byDate.get(date) || [];
    for (const pair of eventPairs) {
      if (pair.red.noContest || pair.red.won === 0.5) continue;
      decisive += 1;
      const baseA = ratings.get(pair.red.fighterId) || null;
      const baseB = ratings.get(pair.blue.fighterId) || null;
      const summaryA = summaries.get(normalizeFighterName(pair.red.name)) || null;
      const summaryB = summaries.get(normalizeFighterName(pair.blue.name)) || null;
      records.push({
        date,
        won: pair.red.won,
        fighterA: pair.red.name,
        fighterB: pair.blue.name,
        baseA,
        baseB,
        summaryA,
        summaryB,
        baseEligible: Boolean(baseA && baseB)
      });
    }
    prior.push(...eventPairs);
    if (index % 50 === 0) console.log(`Warehouse model history: ${index + 1}/${evaluationDates.length} event dates (${date})`);
  }
  return { records, decisive };
}

function cmrRows(records, options) {
  const rows = [];
  for (const record of records) {
    const a = applyWarehousePrior(record.baseA, record.summaryA, options);
    const b = applyWarehousePrior(record.baseB, record.summaryB, options);
    if (!a || !b) continue;
    rows.push({
      ...record,
      cmr_diff: a.cmr - b.cmr,
      base_cmr_diff: record.baseEligible ? record.baseA.cmr - record.baseB.cmr : null
    });
  }
  return rows;
}

function scoreCmr(rows, key, slope, outputKey) {
  return rows.map(row => ({ ...row, [outputKey]: probability(row[key], slope) }));
}

function choosePriorOptions(records) {
  const trials = [];
  for (const options of PRIOR_OPTIONS) {
    const rows = cmrRows(records, options);
    const train = rows.filter(row => row.date < TUNE_DATE);
    const validation = rows.filter(row => row.date >= TUNE_DATE && row.date < TEST_DATE);
    const slope = fitSlope(train, 'cmr_diff');
    const scored = scoreCmr(validation, 'cmr_diff', slope, 'p');
    const result = metrics(scored, 'p');
    trials.push({ ...options, train_bouts: train.length, validation_bouts: validation.length, slope, ...result });
  }
  trials.sort((a, b) => a.log_loss - b.log_loss || a.brier - b.brier);
  return { selected: { maxWeight: trials[0].maxWeight, decayBouts: trials[0].decayBouts }, trials };
}

function predictorRows(records, options) {
  const rows = [];
  for (const record of records) {
    const a = applyWarehousePrior(record.baseA, record.summaryA, options);
    const b = applyWarehousePrior(record.baseB, record.summaryB, options);
    if (!a || !b) continue;
    const x = predictorV02FeatureVector(a, b, record.summaryA, record.summaryB);
    let v01p = null;
    if (record.baseEligible) {
      v01p = predictFrozenVector(baseFeatureVector(record.baseA, record.baseB));
    }
    rows.push({ ...record, x, v01_p: v01p, min_ufc_bouts: Math.min(a.bouts || 0, b.bouts || 0) });
  }
  return rows;
}

function chooseLambda(train, validation) {
  const featureIndexes = PREDICTOR_V02_FEATURE_NAMES.map((_, index) => index);
  const trials = [];
  for (const lambda of LAMBDAS) {
    const model = fitLogistic(train, { featureIndexes, lambda, iterations: 500 });
    const scored = validation.map(row => ({ ...row, p: predict(model, row) }));
    const result = metrics(scored, 'p');
    trials.push({ lambda, ...result });
  }
  trials.sort((a, b) => a.log_loss - b.log_loss || a.brier - b.brier);
  return { lambda: trials[0].lambda, trials };
}

function summarizeWarehouse(rows) {
  const priors = rows.map(row => warehousePrior(row)).filter(prior => prior.available);
  return {
    fighters_with_pre_ufc_history: rows.length,
    pre_ufc_bouts: rows.reduce((sum, row) => sum + Number(row.pre_ufc_bouts || 0), 0),
    major_org_pre_ufc_bouts: rows.reduce((sum, row) => sum + Number(row.pre_ufc_major_org_bouts || 0), 0),
    median_prior_score: priors.length ? priors.map(prior => prior.score).sort((a, b) => a - b)[Math.floor(priors.length / 2)] : null,
    mean_prior_reliability: priors.length ? priors.reduce((sum, prior) => sum + prior.reliability, 0) / priors.length : null
  };
}

async function main() {
  const response = await fetch(STATS_URL);
  if (!response.ok) throw new Error(`UFC stats download failed (${response.status})`);
  const source = await response.text();
  const pairs = buildObservations(parseDelimited(source, ';').filter(row => row.red_fighter_name && row.blue_fighter_name && row.event_date));

  const warehouse = warehouseSummaryMap();
  if (warehouse.rows.length < 100) throw new Error(`Warehouse UFC history coverage is too small to benchmark: ${warehouse.rows.length}`);
  console.log(`Loaded ${warehouse.rows.length} UFC fighters with pre-UFC warehouse summaries.`);

  const { records, decisive } = collectHistoricalRecords(pairs, warehouse.map);
  const priorTuning = choosePriorOptions(records);
  const selectedPrior = priorTuning.selected;
  console.log('Selected CMR warehouse-prior parameters:', selectedPrior);

  const candidateCmrRows = cmrRows(records, selectedPrior);
  const baselineCmrRows = candidateCmrRows.filter(row => row.baseEligible);
  const candidateFinalTrain = candidateCmrRows.filter(row => row.date < TEST_DATE);
  const candidateTest = candidateCmrRows.filter(row => row.date >= TEST_DATE);
  const baselineFinalTrain = baselineCmrRows.filter(row => row.date < TEST_DATE);
  const baselineTest = baselineCmrRows.filter(row => row.date >= TEST_DATE);
  const candidateSlope = fitSlope(candidateFinalTrain, 'cmr_diff');
  const baselineSlope = fitSlope(baselineFinalTrain, 'base_cmr_diff');
  const scoredCandidate = scoreCmr(candidateTest, 'cmr_diff', candidateSlope, 'warehouse_cmr_p');
  const scoredBaseline = scoreCmr(baselineTest, 'base_cmr_diff', baselineSlope, 'base_cmr_p');
  const baselineByKey = new Map(scoredBaseline.map(row => [`${row.date}|${row.fighterA}|${row.fighterB}`, row.base_cmr_p]));
  const cmrCommon = scoredCandidate
    .map(row => ({ ...row, base_cmr_p: baselineByKey.get(`${row.date}|${row.fighterA}|${row.fighterB}`) }))
    .filter(row => finite(row.base_cmr_p));

  const pRows = predictorRows(records, selectedPrior);
  const tuningTrain = pRows.filter(row => row.date < TUNE_DATE);
  const tuningValidation = pRows.filter(row => row.date >= TUNE_DATE && row.date < TEST_DATE);
  const finalTrain = pRows.filter(row => row.date < TEST_DATE);
  const test = pRows.filter(row => row.date >= TEST_DATE);
  const lambdaTuning = chooseLambda(tuningTrain, tuningValidation);
  const featureIndexes = PREDICTOR_V02_FEATURE_NAMES.map((_, index) => index);
  const predictor = fitLogistic(finalTrain, { featureIndexes, lambda: lambdaTuning.lambda, iterations: 900 });
  const scoredPredictor = test.map(row => ({ ...row, v02_p: predict(predictor, row) }));
  const predictorCommon = scoredPredictor.filter(row => finite(row.v01_p));

  const cmrCommonCandidate = metrics(cmrCommon, 'warehouse_cmr_p');
  const cmrCommonBaseline = metrics(cmrCommon, 'base_cmr_p');
  const predictorCommonCandidate = metrics(predictorCommon, 'v02_p');
  const predictorCommonBaseline = metrics(predictorCommon, 'v01_p');
  const predictorExpanded = metrics(scoredPredictor, 'v02_p');

  const report = {
    generated_at: new Date().toISOString(),
    source_max_date: pairs.map(pair => pair.red.eventDate).sort().at(-1),
    baseline_cmr_version: MODEL_VERSION,
    candidate_cmr_version: CMR_CANDIDATE_VERSION,
    baseline_predictor_version: '0.1.0',
    candidate_predictor_version: PREDICTOR_V02_VERSION,
    design: 'Leakage-safe UFC walk-forward. Warehouse data is restricted to fights completed before each fighter first entered the UFC. Regional evidence creates a shrunk entry prior and explicit Predictor features; UFC technical evidence remains UFC-only. CMR prior strength and Predictor regularization are selected on pre-2023 data only; 2023+ remains holdout.',
    warehouse: summarizeWarehouse(warehouse.rows),
    decisive_ufc_bouts_since_2018: decisive,
    cmr: {
      prior_tuning: priorTuning,
      selected_prior: selectedPrior,
      baseline_probability_slope: baselineSlope,
      candidate_probability_slope: candidateSlope,
      expanded_holdout: metrics(scoredCandidate, 'warehouse_cmr_p'),
      common_holdout: {
        bouts: cmrCommon.length,
        baseline: cmrCommonBaseline,
        warehouse_candidate: cmrCommonCandidate
      },
      added_holdout_coverage_bouts: scoredCandidate.length - cmrCommon.length,
      promotion_recommended: Boolean(
        cmrCommonCandidate.brier < cmrCommonBaseline.brier &&
        cmrCommonCandidate.log_loss < cmrCommonBaseline.log_loss
      )
    },
    predictor: {
      feature_count: PREDICTOR_V02_FEATURE_NAMES.length,
      base_feature_count: BASE_FEATURE_NAMES.length,
      features: PREDICTOR_V02_FEATURE_NAMES,
      lambda_tuning: lambdaTuning,
      selected_lambda: lambdaTuning.lambda,
      final_train_bouts_2018_2022: finalTrain.length,
      expanded_holdout: predictorExpanded,
      common_holdout: {
        bouts: predictorCommon.length,
        predictor_v01: predictorCommonBaseline,
        predictor_v02: predictorCommonCandidate
      },
      added_holdout_coverage_bouts: scoredPredictor.length - predictorCommon.length,
      calibration: calibration(scoredPredictor, 'v02_p'),
      coefficients: coefficientsWithNames(predictor),
      promotion_recommended: Boolean(
        predictorCommonCandidate.brier < predictorCommonBaseline.brier &&
        predictorCommonCandidate.log_loss < predictorCommonBaseline.log_loss &&
        predictorCommonCandidate.accuracy >= predictorCommonBaseline.accuracy - 0.005
      )
    }
  };

  mkdirSync('.cache', { recursive: true });
  writeFileSync('.cache/warehouse-model-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync('.cache/predictor-v02-fit.json', JSON.stringify({
    version: PREDICTOR_V02_VERSION,
    rating_prior: selectedPrior,
    lambda: lambdaTuning.lambda,
    feature_names: PREDICTOR_V02_FEATURE_NAMES,
    feature_indexes: predictor.featureIndexes,
    scales: predictor.scales,
    weights: predictor.weights,
    coefficients: coefficientsWithNames(predictor),
    training_end: '2022-12-31'
  }, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
