import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseDelimited } from './lib/csv.mjs';
import { buildRatings as buildRatings03 } from './lib/model_v03.mjs';
import { buildObservations, buildRatings as buildRatings04, CMR_V04_VERSION } from './lib/model_v04.mjs';
import { featureVector as featureVectorV01, predictFrozenVector as predictFrozenV01 } from './lib/predictor_v01.mjs';
import { featureVector as featureVectorV02 } from './lib/predictor_v02.mjs';
import { hash, STATS_URL } from './lib/dataset.mjs';

export function probability(difference, slope) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, slope * difference))));
}

export function fitSlope(rows, key) {
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

function pairedBrierInterval(rows, aKey, bKey) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.date)) groups.set(row.date, []);
    groups.get(row.date).push(row);
  }
  const events = [...groups.values()];
  let seed = 0x40C0FFEE;
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

function quantile(values, q) {
  const xs = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const index = (xs.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (index - lo);
}

function pearson(a, b) {
  if (!a.length || a.length !== b.length) return null;
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
}

async function sourceText(args) {
  const value = key => args[args.indexOf(key) + 1];
  if (args.includes('--stats')) return readFileSync(value('--stats'), 'utf8');
  const response = await fetch(STATS_URL, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Could not fetch pinned stats source (${response.status})`);
  return response.text();
}

export function historicalRows(pairs, start = '2018-01-01') {
  const dates = [...new Set(pairs.map(p => p.red.eventDate))].filter(date => date >= start).sort();
  const rows = [];
  let eligible = 0;
  for (const [index, date] of dates.entries()) {
    const prior = pairs.filter(p => p.red.eventDate < date);
    const ratings03 = new Map(buildRatings03(prior).ratings.map(r => [r.fighterId, r]));
    const ratings04 = new Map(buildRatings04(prior).ratings.map(r => [r.fighterId, r]));
    for (const pair of pairs.filter(p => p.red.eventDate === date && !p.red.noContest && p.red.won !== 0.5)) {
      eligible++;
      const a03 = ratings03.get(pair.red.fighterId);
      const b03 = ratings03.get(pair.blue.fighterId);
      const a04 = ratings04.get(pair.red.fighterId);
      const b04 = ratings04.get(pair.blue.fighterId);
      if (!a03 || !b03 || !a04 || !b04) continue;
      const xV01Cmr03 = featureVectorV01(a03, b03);
      rows.push({
        date,
        a: pair.red.fighterId,
        b: pair.blue.fighterId,
        won: pair.red.won,
        cmr03: a03.cmr - b03.cmr,
        elo03: a03.eloRaw - b03.eloRaw,
        cmr04: a04.cmr - b04.cmr,
        elo04: a04.eloRaw - b04.eloRaw,
        min_bouts: Math.min(a04.bouts, b04.bouts),
        x: featureVectorV02(a04, b04),
        x_v01_cmr04: featureVectorV01(a04, b04),
        v01_p_cmr03: predictFrozenV01(xV01Cmr03)
      });
    }
    if (index % 50 === 0) console.log(`CMR 0.4 history: ${index + 1}/${dates.length} event dates (${date})`);
  }
  return { rows, eligible };
}

if (process.argv[1]?.endsWith('validate-cmr-v04.mjs')) {
  const args = process.argv.slice(2);
  const source = await sourceText(args);
  const pairs = buildObservations(parseDelimited(source, ';'));
  const { rows, eligible } = historicalRows(pairs);
  const train = rows.filter(row => row.date < '2023-01-01');
  const test = rows.filter(row => row.date >= '2023-01-01');

  const slopes = {
    cmr03: fitSlope(train, 'cmr03'),
    elo03: fitSlope(train, 'elo03'),
    cmr04: fitSlope(train, 'cmr04'),
    elo04: fitSlope(train, 'elo04')
  };

  const scored = test.map(row => ({
    ...row,
    cmr03_p: probability(row.cmr03, slopes.cmr03),
    elo03_p: probability(row.elo03, slopes.elo03),
    cmr04_p: probability(row.cmr04, slopes.cmr04),
    elo04_p: probability(row.elo04, slopes.elo04)
  }));

  const full03 = new Map(buildRatings03(pairs).ratings.map(r => [r.fighterId, r]));
  const full04 = buildRatings04(pairs).ratings;
  const pairedCurrent = full04.map(r => [r, full03.get(r.fighterId)]).filter(([, old]) => old);
  const cmr04Values = full04.map(r => r.cmr);
  const cmr03Values = pairedCurrent.map(([, old]) => old.cmr);
  const paired04Values = pairedCurrent.map(([r]) => r.cmr);
  const currentChanges = pairedCurrent.map(([r, old]) => Math.abs(r.cmr - old.cmr));

  const reconstructionDeltas = full04.map(r => Math.abs(r.cmr - (
    0.56 * r.technical
    + 0.24 * r.resume
    + 0.10 * r.strengthOfSchedule
    + 0.10 * r.recentForm
  )));
  const reconstructionMax = Math.max(...reconstructionDeltas, 0);
  // Use the exact, unrounded reliability values for this invariant. The serialized
  // effective-attempt counters are rounded for audit readability, so tiny but real
  // recency-weighted evidence can legitimately display as 0.000.
  const zeroOpportunityViolations = full04.filter(r =>
    (r.reliabilities.wrestlingOffense === 0 && Math.abs(r.wrestlingOffense - 50) > 1e-9)
    || (r.reliabilities.wrestlingDefense === 0 && Math.abs(r.wrestlingDefense - 50) > 1e-9)
    || (r.reliabilities.strikingOffense === 0 && Math.abs(r.strikingOffense - 50) > 1e-9)
    || (r.reliabilities.strikingDefense === 0 && Math.abs(r.strikingDefense - 50) > 1e-9)
  );

  if (reconstructionMax > 1e-8) throw new Error(`CMR reconstruction invariant failed: ${reconstructionMax}`);
  if (zeroOpportunityViolations.length) throw new Error(`Zero-opportunity invariant failed for ${zeroOpportunityViolations.length} fighters`);

  const report = {
    candidate_version: CMR_V04_VERSION,
    production_baseline: 'CMR 0.3.0',
    source_sha256: hash(source),
    generated_at: new Date().toISOString(),
    source_max_date: pairs.map(p => p.red.eventDate).sort().at(-1),
    design: 'Leakage-safe walk-forward comparison. CMR 0.4 uses opportunity-aware skill evidence, metric-specific reliability, own-action pace, draw-aware Elo, calendar-decayed recent form, discounted division transfer, and a directly reconstructable final CMR.',
    decisive_bouts_since_2018: eligible,
    matched_bouts_since_2018: rows.length,
    train_bouts_2018_2022: train.length,
    evaluation_bouts_2023_plus: test.length,
    probability_slopes: slopes,
    results: {
      cmr_v03: metrics(scored, 'cmr03_p'),
      cmr_v04: metrics(scored, 'cmr04_p'),
      elo_v03: metrics(scored, 'elo03_p'),
      elo_v04_draw_aware: metrics(scored, 'elo04_p')
    },
    established: {
      definition: 'Both fighters have at least five prior rated bouts',
      cmr_v03: metrics(scored.filter(r => r.min_bouts >= 5), 'cmr03_p'),
      cmr_v04: metrics(scored.filter(r => r.min_bouts >= 5), 'cmr04_p')
    },
    cmr_v04_minus_v03_brier_95_interval: pairedBrierInterval(scored, 'cmr04_p', 'cmr03_p'),
    current_rating_distribution: {
      fighters: full04.length,
      p10: quantile(cmr04Values, 0.10),
      median: quantile(cmr04Values, 0.50),
      p90: quantile(cmr04Values, 0.90),
      max: Math.max(...cmr04Values),
      mean_absolute_change_from_v03: currentChanges.reduce((sum, x) => sum + x, 0) / Math.max(1, currentChanges.length),
      correlation_with_v03: pearson(paired04Values, cmr03Values)
    },
    invariants: {
      cmr_reconstruction_max_abs_delta: reconstructionMax,
      zero_opportunity_non_neutral_violations: zeroOpportunityViolations.length
    }
  };

  mkdirSync('.cache', { recursive: true });
  writeFileSync('.cache/cmr-v04-history.json', JSON.stringify({ rows, eligible, source_sha256: hash(source) }));
  writeFileSync('.cache/cmr-v04-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
