import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseDelimited } from './lib/csv.mjs';
import { buildObservations, buildRatings } from './lib/model_v03.mjs';
import { hash, MODEL_VERSION } from './lib/dataset.mjs';

export function probability(difference, slope) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, slope * difference)))); }
export function fitSlope(rows, key) {
  let low = 0, high = 2;
  for (let i = 0; i < 70; i++) {
    const slope = (low + high) / 2;
    const gradient = rows.reduce((sum, r) => sum + r[key] * (probability(r[key], slope) - r.won), 0);
    if (gradient > 0) high = slope; else low = slope;
  }
  return (low + high) / 2;
}
function metrics(rows, key) {
  const n = rows.length;
  return { bouts: n, accuracy: rows.reduce((s, r) => s + (r[key] === .5 ? .5 : Number((r[key] > .5) === Boolean(r.won))), 0) / n,
    brier: rows.reduce((s, r) => s + (r[key] - r.won) ** 2, 0) / n,
    log_loss: -rows.reduce((s, r) => s + Math.log(Math.max(1e-12, r.won ? r[key] : 1 - r[key])), 0) / n };
}
function pairedInterval(rows) {
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.date)) groups.set(r.date, []); groups.get(r.date).push(r); }
  const dates = [...groups.values()];
  let seed = 123456789;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const differences = [];
  for (let i = 0; i < 2000; i++) {
    let sum = 0, n = 0;
    for (let j = 0; j < dates.length; j++) for (const r of dates[Math.floor(random() * dates.length)]) { sum += (r.cmr_p - r.won) ** 2 - (r.elo_p - r.won) ** 2; n++; }
    differences.push(sum / n);
  }
  differences.sort((a,b) => a-b);
  return [differences[50], differences[1949]];
}

export function historicalRows(pairs, start = '2018-01-01') {
  const dates = [...new Set(pairs.map(p => p.red.eventDate))].filter(d => d >= start).sort();
  const rows = [];
  let eligible = 0;
  for (const [i, date] of dates.entries()) {
    // No bout on the evaluation date can enter population, opponent or Elo data.
    const prior = pairs.filter(p => p.red.eventDate < date);
    const ratings = new Map(buildRatings(prior).ratings.map(r => [r.fighterId, r]));
    for (const p of pairs.filter(p => p.red.eventDate === date && !p.red.noContest && p.red.won !== .5)) {
      eligible++;
      const a = ratings.get(p.red.fighterId), b = ratings.get(p.blue.fighterId);
      if (!a || !b) continue;
      rows.push({ date, a: p.red.fighterId, b: p.blue.fighterId, won: p.red.won, cmr: a.cmr - b.cmr, elo: a.eloRaw - b.eloRaw, min_bouts: Math.min(a.bouts, b.bouts) });
    }
    if (i % 50 === 0) console.log(`Historical validation: ${i + 1}/${dates.length} event dates (${date})`);
  }
  return { rows, eligible };
}

if (process.argv[1]?.endsWith('validate-model.mjs')) {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  const path = value('--stats');
  if (!args.includes('--stats')) throw new Error('Provide --stats with the pinned source CSV');
  const source = readFileSync(path, 'utf8');
  const pairs = buildObservations(parseDelimited(source, ';'));
  const { rows, eligible } = historicalRows(pairs);
  const train = rows.filter(r => r.date < '2023-01-01');
  const test = rows.filter(r => r.date >= '2023-01-01');
  const slopes = { cmr: fitSlope(train, 'cmr'), elo: fitSlope(train, 'elo') };
  const scored = test.map(r => ({ ...r, cmr_p: probability(r.cmr, slopes.cmr), elo_p: probability(r.elo, slopes.elo), standard_elo_p: probability(r.elo, Math.log(10) / 400) }));
  const report = { model_version: MODEL_VERSION, source_sha256: hash(source), generated_at: new Date().toISOString(),
    source_max_date: pairs.map(p => p.red.eventDate).sort().at(-1),
    design: 'Retrospective walk-forward: all inputs strictly before each event date. Probability slopes fit on 2018–2022 only; fixed CMR weights. Evaluation starts 2023-01-01. Both fighters need a prior rated bout. Ties receive half credit.',
    limitations: ['This uses the current corrected source, not archived as-published feeds.', 'The formulas existed before this retrospective evaluation; this is not a prospective prediction record.', 'Sample strength is an exposure index, not a probability.', 'Evaluation excludes unrated debutants; coverage is reported.'],
    total_decisive_bouts_since_2018: eligible, matched_bouts_since_2018: rows.length, train_bouts: train.length,
    evaluation_start: '2023-01-01', probability_slopes: slopes,
    results: { cmr: metrics(scored, 'cmr_p'), calibrated_elo: metrics(scored, 'elo_p'), standard_elo: metrics(scored, 'standard_elo_p') },
    established: { definition: 'Both fighters have at least five prior rated bouts', cmr: metrics(scored.filter(r => r.min_bouts >= 5), 'cmr_p'), elo: metrics(scored.filter(r => r.min_bouts >= 5), 'elo_p') },
    brier_difference_cmr_minus_elo_95_interval: pairedInterval(scored),
    per_year: Object.fromEntries([...new Set(scored.map(r => r.date.slice(0,4)))].map(year => [year, { cmr: metrics(scored.filter(r => r.date.startsWith(year)), 'cmr_p'), elo: metrics(scored.filter(r => r.date.startsWith(year)), 'elo_p') }])) };
  const output = args.includes('--output') ? value('--output') : 'public/model-validation.json';
  mkdirSync('.cache', { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  writeFileSync('.cache/validation-predictions.json', JSON.stringify(scored));
  console.log(JSON.stringify(report, null, 2));
}
