import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseDelimited } from './lib/csv.mjs';
import { buildObservations, buildRatings } from './lib/model_v03.mjs';
import { STATS_URL } from './lib/dataset.mjs';
import {
  featureVector as baseFeatureVector,
  fitLogistic,
  predict,
  predictFrozenVector
} from './lib/predictor_v01.mjs';
import { applyWarehousePrior, normalizeFighterName } from './lib/warehouse-prior.mjs';
import { PREDICTOR_V02_FEATURE_NAMES, predictorV02FeatureVector } from './lib/predictor_v02.mjs';

const DB = 'cagemetrix';
const START_DATE = '2018-01-01';
const TUNE_DATE = '2022-01-01';
const TEST_DATE = '2023-01-01';
const PRIOR_OPTIONS = { maxWeight: 0.65, decayBouts: 4 };
const LAMBDAS = [0.003, 0.01, 0.03, 0.1];

function wrangler(args) {
  return execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
}

function queryRows(statement) {
  const parsed = JSON.parse(wrangler(['d1', 'execute', DB, '--remote', '--command', statement, '--json']));
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

function warehouseMap() {
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
  return map;
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
    const ratings = new Map(buildRatings(prior).ratings.map(rating => [rating.fighterId, rating]));
    const eventPairs = byDate.get(date) || [];
    for (const pair of eventPairs) {
      if (pair.red.noContest || pair.red.won === 0.5) continue;
      const baseA = ratings.get(pair.red.fighterId) || null;
      const baseB = ratings.get(pair.blue.fighterId) || null;
      const summaryA = summaries.get(normalizeFighterName(pair.red.name)) || null;
      const summaryB = summaries.get(normalizeFighterName(pair.blue.name)) || null;
      const a = applyWarehousePrior(baseA, summaryA, PRIOR_OPTIONS);
      const b = applyWarehousePrior(baseB, summaryB, PRIOR_OPTIONS);
      if (!a || !b) continue;
      const baseEligible = Boolean(baseA && baseB);
      records.push({
        date,
        won: pair.red.won,
        baseEligible,
        v01p: baseEligible ? predictFrozenVector(baseFeatureVector(baseA, baseB)) : null,
        x: predictorV02FeatureVector(a, b, summaryA, summaryB)
      });
    }
    prior.push(...eventPairs);
  }
  return records;
}

function metrics(rows, key) {
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

function tuneLambda(train, validation) {
  const featureIndexes = PREDICTOR_V02_FEATURE_NAMES.map((_, index) => index);
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
  const pairs = buildObservations(
    parseDelimited(await response.text(), ';').filter(row => row.red_fighter_name && row.blue_fighter_name && row.event_date)
  );
  const rows = historicalRecords(pairs, warehouseMap());
  const tune = tuneLambda(
    rows.filter(row => row.date < TUNE_DATE),
    rows.filter(row => row.date >= TUNE_DATE && row.date < TEST_DATE)
  );
  const featureIndexes = PREDICTOR_V02_FEATURE_NAMES.map((_, index) => index);
  const model = fitLogistic(rows.filter(row => row.date < TEST_DATE), {
    featureIndexes,
    lambda: tune.lambda,
    iterations: 900
  });
  const test = rows.filter(row => row.date >= TEST_DATE);
  const common = test
    .filter(row => row.baseEligible && Number.isFinite(row.v01p))
    .map(row => ({ ...row, v02p: predict(model, row) }));
  const expanded = test.map(row => ({ ...row, v02p: predict(model, row) }));
  const baseline = metrics(common, 'v01p');
  const candidate = metrics(common, 'v02p');
  const report = {
    generated_at: new Date().toISOString(),
    design: 'Corrected Predictor comparison: only holdout bouts where Predictor 0.1 had two real pre-fight UFC ratings are included in the common set. Null baseline predictions are excluded, never coerced to zero.',
    selected_lambda: tune.lambda,
    lambda_tuning: tune.trials,
    train_bouts: rows.filter(row => row.date < TEST_DATE).length,
    holdout_bouts_expanded: expanded.length,
    common_holdout: {
      bouts: common.length,
      predictor_v01: baseline,
      predictor_v02: candidate
    },
    expanded_predictor_v02: metrics(expanded, 'v02p'),
    promotion_recommended: Boolean(
      candidate.brier < baseline.brier &&
      candidate.log_loss < baseline.log_loss &&
      candidate.accuracy >= baseline.accuracy - 0.005
    ),
    model: {
      feature_names: PREDICTOR_V02_FEATURE_NAMES,
      feature_indexes: model.featureIndexes,
      scales: model.scales,
      weights: model.weights,
      lambda: model.lambda
    }
  };
  mkdirSync('.cache', { recursive: true });
  writeFileSync('.cache/predictor-v02-common-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
