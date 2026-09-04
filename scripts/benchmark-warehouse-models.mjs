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
const CMR_CANDIDATE_VERSION = '0.3.2-warehouse-candidate';
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

// Number(null) is 0, so Number.isFinite(Number(value)) incorrectly treated a
// missing Predictor 0.1 probability as a real 0% forecast. Keep the common
// comparison restricted to bouts where the baseline actually produced a value.
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

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
  return Array.from({ length: 10 }, (_, bucket) => {
    const lo = bucket / 10, hi = (bucket + 1) / 10;
    const selected = rows.filter(row => row[key] >= lo && (bucket === 9 ? row[key] <= hi : row[key] < hi));
    return {
      bucket: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
      n: selected.length,
      mean_probability: selected.length ? selected.reduce((s, row) => s + row[key], 0) / selected.length : null,
      observed_win_rate: selected.length ? selected.reduce((s, row) => s + row.won, 0) / selected.length : null
    };
  });
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
    if (key && !map.has(key)) map.set(key, row);
  }
  return { rows, map };
}

function historicalRecords(pairs, summaries) {
  const dates = [...new Set(pairs.map(pair => pair.red.eventDate))].sort();
  const byDate = new Map();
  for (const pair of pairs) {
    if (!byDate.has(pair.red.eventDate)) byDate.set(pair.red.eventDate, []);
    byDate.get(pair.red.eventDate).push(pair);
  }

  const prior = pairs.filter(pair => pair.red.eventDate < START_DATE);
  const records = [];
  for (const date of dates.filter(date => date >= START_DATE)) {
    const ratingRows = buildRatings(prior).ratings;
    const ratings = new Map(ratingRows.map(rating => [rating.fighterId, rating]));
    const eventPairs = byDate.get(date) || [];
    for (const pair of eventPairs) {
      if (pair.red.noContest || pair.red.won === 0.5) continue;
      const baseA = ratings.get(pair.red.fighterId) || null;
      const baseB = ratings.get(pair.blue.fighterId) || null;
      const summaryA = summaries.get(normalizeFighterName(pair.red.name)) || null;
      const summaryB = summaries.get(normalizeFighterName(pair.blue.name)) || null;
      records.push({
        date,
        won: pair.red.won,
        baseA,
        baseB,
        summaryA,
        summaryB,
        baseEligible: Boolean(baseA && baseB)
      });
    }
    prior.push(...eventPairs);
  }
  return records;
}

function scoreCmr(records, options) {
  const scored = [];
  for (const row of records) {
    const a = applyWarehousePrior(row.baseA, row.summaryA, options);
    const b = applyWarehousePrior(row.baseB, row.summaryB, options);
    if (!a || !b) continue;
    const probabilityA = sigmoid((a.cmr - b.cmr) / 12);
    scored.push({ ...row, probabilityA });
  }
  return scored;
}

function scoreBaselineCmr(records) {
  return records
    .filter(row => row.baseA && row.baseB)
    .map(row => ({ ...row, probabilityA: sigmoid((row.baseA.cmr - row.baseB.cmr) / 12) }));
}

function tunePrior(records) {
  const train = records.filter(row => row.date < TUNE_DATE);
  const validation = records.filter(row => row.date >= TUNE_DATE && row.date < TEST_DATE);
  const trials = PRIOR_OPTIONS.map(options => {
    const trainScored = scoreCmr(train, options);
    const validationScored = scoreCmr(validation, options);
    return {
      ...options,
      train_bouts: trainScored.length,
      validation: metrics(validationScored, 'probabilityA')
    };
  }).sort((a, b) => a.validation.log_loss - b.validation.log_loss || a.validation.brier - b.validation.brier);
  return { options: { maxWeight: trials[0].maxWeight, decayBouts: trials[0].decayBouts }, trials };
}

function predictorRows(records, priorOptions) {
  return records.map(row => {
    const a = applyWarehousePrior(row.baseA, row.summaryA, priorOptions);
    const b = applyWarehousePrior(row.baseB, row.summaryB, priorOptions);
    if (!a || !b) return null;
    return {
      ...row,
      x: predictorV02FeatureVector(a, b, row.summaryA, row.summaryB),
      v01_p: row.baseEligible ? predictFrozenVector(baseFeatureVector(row.baseA, row.baseB)) : null
    };
  }).filter(Boolean);
}

function tunePredictor(rows) {
  const featureIndexes = PREDICTOR_V02_FEATURE_NAMES.map((_, index) => index);
  const train = rows.filter(row => row.date < TUNE_DATE);
  const validation = rows.filter(row => row.date >= TUNE_DATE && row.date < TEST_DATE);
  const trials = LAMBDAS.map(lambda => {
    const model = fitLogistic(train, { featureIndexes, lambda, iterations: 500 });
    const scored = validation.map(row => ({ ...row, p: predict(model, row) }));
    return { lambda, ...metrics(scored, 'p') };
  }).sort((a, b) => a.log_loss - b.log_loss || a.brier - b.brier);
  return { lambda: trials[0].lambda, trials };
}

async function main() {
  const response = await fetch(STATS_URL);
  if (!response.ok) throw new Error(`UFC stats download failed (${response.status})`);
  const text = await response.text();
  const pairs = buildObservations(parseDelimited(text, ';').filter(row => row.red_fighter_name && row.blue_fighter_name && row.event_date));
  const warehouse = warehouseSummaryMap();
  const records = historicalRecords(pairs, warehouse.map);

  const cmrTune = tunePrior(records);
  const baselineCmr = scoreBaselineCmr(records.filter(row => row.date >= TEST_DATE));
  const candidateCmr = scoreCmr(records.filter(row => row.date >= TEST_DATE), cmrTune.options);
  const baselineByKey = new Map(baselineCmr.map(row => [`${row.date}|${row.baseA?.fighterId}|${row.baseB?.fighterId}`, row]));
  const candidateCommon = candidateCmr.filter(row => baselineByKey.has(`${row.date}|${row.baseA?.fighterId}|${row.baseB?.fighterId}`));
  const baselineCommon = candidateCommon.map(row => baselineByKey.get(`${row.date}|${row.baseA?.fighterId}|${row.baseB?.fighterId}`));

  const predictorData = predictorRows(records, cmrTune.options);
  const predictorTune = tunePredictor(predictorData);
  const featureIndexes = PREDICTOR_V02_FEATURE_NAMES.map((_, index) => index);
  const predictorModel = fitLogistic(
    predictorData.filter(row => row.date < TEST_DATE),
    { featureIndexes, lambda: predictorTune.lambda, iterations: 900 }
  );
  const predictorHoldout = predictorData.filter(row => row.date >= TEST_DATE);
  const scoredPredictor = predictorHoldout.map(row => ({
    ...row,
    v02_p: predict(predictorModel, row)
  }));
  const predictorCommon = scoredPredictor.filter(row => finite(row.v01_p));

  const report = {
    generated_at: new Date().toISOString(),
    design: {
      time_split: 'Leakage-safe walk-forward ratings; every fight uses only bouts earlier than its event date.',
      training: '2018-2021',
      hyperparameter_validation: '2022',
      final_predictor_training: '2018-2022',
      holdout: `2023 through ${pairs.map(pair => pair.red.eventDate).sort().at(-1)}`,
      warehouse_scope: 'Completed pre-UFC history only for CageMetrix UFC fighters. No regional technical stats are synthesized.'
    },
    source_max_date: pairs.map(pair => pair.red.eventDate).sort().at(-1),
    baseline_cmr_version: MODEL_VERSION,
    candidate_cmr_version: CMR_CANDIDATE_VERSION,
    baseline_predictor_version: '0.1.0',
    candidate_predictor_version: PREDICTOR_V02_VERSION,
    warehouse: {
      fighters_with_pre_ufc_history: warehouse.rows.length,
      pre_ufc_bouts: warehouse.rows.reduce((sum, row) => sum + Number(row.pre_ufc_bouts || 0), 0),
      major_org_pre_ufc_bouts: warehouse.rows.reduce((sum, row) => sum + Number(row.pre_ufc_major_org_bouts || 0), 0),
      median_prior_score: [...warehouse.map.values()].map(warehousePrior).map(p => p.score).sort((a, b) => a - b)[Math.floor(warehouse.rows.length / 2)] || null,
      mean_prior_reliability: warehouse.rows.length ? [...warehouse.map.values()].map(warehousePrior).reduce((sum, p) => sum + p.reliability, 0) / warehouse.rows.length : null
    },
    historical_records: records.length,
    cmr: {
      selected_prior: cmrTune.options,
      tuning: cmrTune.trials,
      expanded_holdout: metrics(candidateCmr, 'probabilityA'),
      common_holdout: {
        bouts: candidateCommon.length,
        baseline: metrics(baselineCommon, 'probabilityA'),
        warehouse_candidate: metrics(candidateCommon, 'probabilityA')
      },
      added_holdout_coverage: Math.max(0, candidateCmr.length - baselineCmr.length),
      promotion_recommended: Boolean(
        metrics(candidateCommon, 'probabilityA').brier < metrics(baselineCommon, 'probabilityA').brier &&
        metrics(candidateCommon, 'probabilityA').log_loss < metrics(baselineCommon, 'probabilityA').log_loss
      )
    },
    predictor: {
      feature_count_v01: BASE_FEATURE_NAMES.length,
      feature_count_v02: PREDICTOR_V02_FEATURE_NAMES.length,
      selected_lambda: predictorTune.lambda,
      lambda_tuning: predictorTune.trials,
      final_train_bouts_2018_2022: predictorData.filter(row => row.date < TEST_DATE).length,
      expanded_holdout: metrics(scoredPredictor, 'v02_p'),
      common_holdout: {
        bouts: predictorCommon.length,
        predictor_v01: metrics(predictorCommon, 'v01_p'),
        predictor_v02: metrics(predictorCommon, 'v02_p')
      },
      added_holdout_coverage: Math.max(0, scoredPredictor.length - predictorCommon.length),
      calibration: calibration(scoredPredictor, 'v02_p'),
      coefficients: coefficientsWithNames(predictorModel),
      promotion_recommended: Boolean(
        metrics(predictorCommon, 'v02_p').brier < metrics(predictorCommon, 'v01_p').brier &&
        metrics(predictorCommon, 'v02_p').log_loss < metrics(predictorCommon, 'v01_p').log_loss &&
        metrics(predictorCommon, 'v02_p').accuracy >= metrics(predictorCommon, 'v01_p').accuracy - 0.005
      )
    }
  };

  mkdirSync('.cache', { recursive: true });
  writeFileSync('.cache/warehouse-model-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync('.cache/predictor-v02-fit.json', JSON.stringify({
    version: PREDICTOR_V02_VERSION,
    rating_prior: cmrTune.options,
    lambda: predictorTune.lambda,
    feature_names: PREDICTOR_V02_FEATURE_NAMES,
    feature_indexes: predictorModel.featureIndexes,
    scales: predictorModel.scales,
    weights: predictorModel.weights,
    coefficients: coefficientsWithNames(predictorModel),
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
