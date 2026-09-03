import { readFileSync } from 'node:fs';
import { parseDelimited } from './lib/csv.mjs';
import { buildObservations, buildRatings } from './lib/model_v04.mjs';
import { featureVector, predictFrozenVector, RETROSPECTIVE_BENCHMARK } from './lib/predictor_v01.mjs';

function metrics(rows) {
  const n = rows.length;
  return {
    bouts: n,
    accuracy: rows.reduce((sum, row) => sum + Number((row.p > 0.5) === Boolean(row.won)), 0) / n,
    brier: rows.reduce((sum, row) => sum + (row.p - row.won) ** 2, 0) / n,
    log_loss: -rows.reduce((sum, row) => sum + Math.log(Math.max(1e-12, row.won ? row.p : 1 - row.p)), 0) / n
  };
}

const args = process.argv.slice(2);
const statsIndex = args.indexOf('--stats');
if (statsIndex < 0 || !args[statsIndex + 1]) throw new Error('Provide --stats with the merged production stats CSV');
const pairs = buildObservations(parseDelimited(readFileSync(args[statsIndex + 1], 'utf8'), ';'));
const dates = [...new Set(pairs.map(pair => pair.red.eventDate))].filter(date => date >= '2018-01-01').sort();
const rows = [];
for (const [index, date] of dates.entries()) {
  const prior = pairs.filter(pair => pair.red.eventDate < date);
  const ratings = new Map(buildRatings(prior).ratings.map(rating => [rating.fighterId, rating]));
  for (const pair of pairs.filter(pair => pair.red.eventDate === date && !pair.red.noContest && pair.red.won !== 0.5)) {
    const a = ratings.get(pair.red.fighterId);
    const b = ratings.get(pair.blue.fighterId);
    if (!a || !b) continue;
    rows.push({
      date,
      won: pair.red.won,
      min_bouts: Math.min(a.bouts, b.bouts),
      p: predictFrozenVector(featureVector(a, b))
    });
  }
  if (index % 50 === 0) console.log(`Frozen Predictor 0.1 on CMR 0.4: ${index + 1}/${dates.length} event dates (${date})`);
}

const test = rows.filter(row => row.date >= '2023-01-01');
const established = test.filter(row => row.min_bouts >= 5);
const hybrid = metrics(test);
const report = {
  design: 'Frozen Predictor 0.1 coefficients and feature transforms applied without retraining to leakage-safe CMR 0.4 ratings. This intentionally measures raw compatibility/distribution shift, not a fitted new model.',
  evaluation_bouts_2023_plus: test.length,
  frozen_predictor_v01_on_cmr_v04: hybrid,
  established_5_plus: metrics(established),
  published_predictor_v01_on_cmr_v03: RETROSPECTIVE_BENCHMARK,
  delta_vs_published_v01: {
    accuracy: hybrid.accuracy - RETROSPECTIVE_BENCHMARK.accuracy,
    brier: hybrid.brier - RETROSPECTIVE_BENCHMARK.brier,
    log_loss: hybrid.log_loss - RETROSPECTIVE_BENCHMARK.log_loss
  }
};
console.log(JSON.stringify(report, null, 2));
