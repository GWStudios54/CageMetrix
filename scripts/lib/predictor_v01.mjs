export const PREDICTOR_NAME = 'CageMetrix Matchup Predictor';
export const PREDICTOR_VERSION = '0.1.0';
export const PREDICTOR_TRAINING_END = '2022-12-31';

export const FEATURE_NAMES = [
  'elo_diff',
  'cmr_diff',
  'technical_diff',
  'resume_diff',
  'striking_offense_diff',
  'striking_defense_diff',
  'wrestling_offense_diff',
  'wrestling_defense_diff',
  'grappling_diff',
  'pace_diff',
  'finishing_diff',
  'strength_of_schedule_diff',
  'recent_form_diff',
  'confidence_diff',
  'log_bouts_diff',
  'log_minutes_diff',
  'striking_matchup_edge',
  'wrestling_matchup_edge',
  'grappling_matchup_edge',
  'finishing_matchup_edge',
  'pace_pressure_edge',
  'recent_schedule_edge',
  'technical_evidence_edge',
  'elo_evidence_edge'
];

// Frozen raw logistic coefficients from the leakage-safe Predictor 0.1 fit on
// 2018-2022 only. Do not retune these against the 2023+ holdout or live record.
export const FROZEN_RAW_COEFFICIENTS = [
  0.006585847961838451,
  0.004538778670981231,
  0.019687120088606222,
  -0.007476938667047409,
  0.008139214448719484,
  -0.0012525418677665138,
  0.006218167756174086,
  0.0004290681570942626,
  0.00802631041057519,
  -0.0031133607857195896,
  0.0007544618104108377,
  0.0001250719655611289,
  0.0019828269291698856,
  0.0004071422377693994,
  -0.36087148517259887,
  0.1683580312408404,
  0.044210576227987776,
  0.0007438152754224601,
  0.0015178222943143154,
  0.0006287134954300826,
  0.018710455486074223,
  0.017599401600670143,
  -0.004867452755617732,
  -0.0045803884493726115
];

export const RETROSPECTIVE_BENCHMARK = Object.freeze({
  evaluation_start: '2023-01-01',
  evaluation_end: '2026-08-29',
  bouts: 1516,
  accuracy: 0.6319261213720316,
  brier: 0.2282271114132056,
  log_loss: 0.6485401144929406,
  elo_accuracy: 0.5471635883905013,
  elo_brier: 0.2458832503865032,
  elo_log_loss: 0.6848227599490331
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = value => Number.isFinite(value) ? value : 0;
const centered = value => Number.isFinite(value) ? value : 50;

function normalizedRating(value) {
  if (!value) {
    return {
      eloRaw: 1500, cmr: 50, technical: 50, resume: 50,
      strikingOffense: 50, strikingDefense: 50,
      wrestlingOffense: 50, wrestlingDefense: 50,
      grappling: 50, pace: 50, finishing: 50,
      strengthOfSchedule: 50, recentForm: 50,
      confidence: 0, bouts: 0, minutes: 0
    };
  }
  return {
    ...value,
    eloRaw: Number.isFinite(value.eloRaw) ? value.eloRaw : 1500,
    cmr: centered(value.cmr),
    technical: centered(value.technical),
    resume: centered(value.resume),
    strikingOffense: centered(value.strikingOffense),
    strikingDefense: centered(value.strikingDefense),
    wrestlingOffense: centered(value.wrestlingOffense),
    wrestlingDefense: centered(value.wrestlingDefense),
    grappling: centered(value.grappling),
    pace: centered(value.pace),
    finishing: centered(value.finishing),
    strengthOfSchedule: centered(value.strengthOfSchedule),
    recentForm: centered(value.recentForm),
    confidence: finite(value.confidence),
    bouts: finite(value.bouts),
    minutes: finite(value.minutes)
  };
}

const diff = (a, b, key) => finite(a[key]) - finite(b[key]);

export function featureVector(aInput, bInput) {
  const a = normalizedRating(aInput);
  const b = normalizedRating(bInput);
  const strikeA = a.strikingOffense * (100 - b.strikingDefense) / 100;
  const strikeB = b.strikingOffense * (100 - a.strikingDefense) / 100;
  const wrestleA = a.wrestlingOffense * (100 - b.wrestlingDefense) / 100;
  const wrestleB = b.wrestlingOffense * (100 - a.wrestlingDefense) / 100;
  const grappleA = a.grappling * (100 - b.wrestlingDefense) / 100;
  const grappleB = b.grappling * (100 - a.wrestlingDefense) / 100;
  const defenseA = (a.strikingDefense + a.wrestlingDefense) / 2;
  const defenseB = (b.strikingDefense + b.wrestlingDefense) / 2;
  const finishA = a.finishing * (100 - defenseB) / 100;
  const finishB = b.finishing * (100 - defenseA) / 100;
  const paceA = a.pace * (100 - b.strikingDefense) / 100;
  const paceB = b.pace * (100 - a.strikingDefense) / 100;
  const recentScheduleA = a.recentForm * a.strengthOfSchedule / 100;
  const recentScheduleB = b.recentForm * b.strengthOfSchedule / 100;
  const technicalEvidenceA = a.technical * a.confidence / 100;
  const technicalEvidenceB = b.technical * b.confidence / 100;
  const eloEvidenceA = (a.eloRaw - 1500) * a.confidence / 100;
  const eloEvidenceB = (b.eloRaw - 1500) * b.confidence / 100;

  return [
    diff(a, b, 'eloRaw'),
    diff(a, b, 'cmr'),
    diff(a, b, 'technical'),
    diff(a, b, 'resume'),
    diff(a, b, 'strikingOffense'),
    diff(a, b, 'strikingDefense'),
    diff(a, b, 'wrestlingOffense'),
    diff(a, b, 'wrestlingDefense'),
    diff(a, b, 'grappling'),
    diff(a, b, 'pace'),
    diff(a, b, 'finishing'),
    diff(a, b, 'strengthOfSchedule'),
    diff(a, b, 'recentForm'),
    diff(a, b, 'confidence'),
    Math.log1p(Math.max(0, a.bouts)) - Math.log1p(Math.max(0, b.bouts)),
    Math.log1p(Math.max(0, a.minutes)) - Math.log1p(Math.max(0, b.minutes)),
    strikeA - strikeB,
    wrestleA - wrestleB,
    grappleA - grappleB,
    finishA - finishB,
    paceA - paceB,
    recentScheduleA - recentScheduleB,
    technicalEvidenceA - technicalEvidenceB,
    eloEvidenceA - eloEvidenceB
  ];
}

export function sigmoid(value) {
  const z = clamp(value, -30, 30);
  return 1 / (1 + Math.exp(-z));
}

export function predictFrozenVector(x) {
  if (!Array.isArray(x) || x.length !== FEATURE_NAMES.length) throw new Error('Invalid Predictor 0.1 feature vector');
  const score = x.reduce((sum, value, i) => sum + finite(value) * FROZEN_RAW_COEFFICIENTS[i], 0);
  return sigmoid(score);
}

const DRIVER_GROUPS = [
  { label: 'competitive strength', indexes: [0, 1, 3] },
  { label: 'overall technical profile', indexes: [2, 22] },
  { label: 'striking matchup', indexes: [4, 5, 16] },
  { label: 'wrestling and grappling matchup', indexes: [6, 7, 8, 17, 18] },
  { label: 'pace and finishing profile', indexes: [9, 10, 19, 20] },
  { label: 'recent form and schedule', indexes: [11, 12, 21] },
  { label: 'UFC experience and sample', indexes: [13, 14, 15, 23] }
];

export function groupedDrivers(x, limit = 3) {
  const contributions = x.map((value, i) => finite(value) * FROZEN_RAW_COEFFICIENTS[i]);
  return DRIVER_GROUPS.map(group => ({
    label: group.label,
    contribution: group.indexes.reduce((sum, i) => sum + contributions[i], 0)
  }))
    .filter(item => Math.abs(item.contribution) > 1e-9)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, limit)
    .map(item => ({ ...item, side: item.contribution >= 0 ? 'a' : 'b' }));
}

export function predictMatchup(a, b) {
  const x = featureVector(a, b);
  const probabilityA = predictFrozenVector(x);
  return {
    probabilityA,
    probabilityB: 1 - probabilityA,
    featureVector: x,
    drivers: groupedDrivers(x)
  };
}

export function formatDrivers(drivers, fighterA = 'Fighter A', fighterB = 'Fighter B') {
  if (!drivers?.length) return 'The model sees very little separation in the measured matchup profile.';
  return `Main model edges: ${drivers.map(driver => `${driver.side === 'a' ? fighterA : fighterB} — ${driver.label}`).join('; ')}.`;
}

function selectedVector(row, featureIndexes) {
  return featureIndexes.map(i => row.x[i]);
}

// Training utilities remain here so the frozen production coefficients can be
// reproduced and audited without changing the production predictor.
export function fitLogistic(rows, options = {}) {
  const featureIndexes = options.featureIndexes || FEATURE_NAMES.map((_, i) => i);
  const lambda = options.lambda ?? 0.01;
  const iterations = options.iterations ?? 2500;
  const learningRate = options.learningRate ?? 0.03;
  if (!rows.length) throw new Error('Cannot fit predictor without rows');

  const examples = [];
  for (const row of rows) {
    const x = selectedVector(row, featureIndexes);
    examples.push({ x, y: row.won });
    examples.push({ x: x.map(v => -v), y: 1 - row.won });
  }

  const scales = featureIndexes.map((_, j) => {
    const meanSquare = examples.reduce((sum, row) => sum + row.x[j] ** 2, 0) / examples.length;
    return Math.max(1e-6, Math.sqrt(meanSquare));
  });
  const xs = examples.map(row => row.x.map((value, j) => value / scales[j]));
  const ys = examples.map(row => row.y);
  const weights = new Array(featureIndexes.length).fill(0);
  const m = new Array(weights.length).fill(0);
  const v = new Array(weights.length).fill(0);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const epsilon = 1e-8;

  for (let step = 1; step <= iterations; step++) {
    const gradient = new Array(weights.length).fill(0);
    for (let i = 0; i < xs.length; i++) {
      let score = 0;
      for (let j = 0; j < weights.length; j++) score += weights[j] * xs[i][j];
      const error = sigmoid(score) - ys[i];
      for (let j = 0; j < weights.length; j++) gradient[j] += error * xs[i][j];
    }
    let maxUpdate = 0;
    for (let j = 0; j < weights.length; j++) {
      const g = gradient[j] / xs.length + lambda * weights[j];
      m[j] = beta1 * m[j] + (1 - beta1) * g;
      v[j] = beta2 * v[j] + (1 - beta2) * g * g;
      const mHat = m[j] / (1 - beta1 ** step);
      const vHat = v[j] / (1 - beta2 ** step);
      const update = learningRate * mHat / (Math.sqrt(vHat) + epsilon);
      weights[j] -= update;
      maxUpdate = Math.max(maxUpdate, Math.abs(update));
    }
    if (step > 250 && maxUpdate < 1e-8) break;
  }

  return { version: PREDICTOR_VERSION, featureIndexes, scales, weights, lambda };
}

export function predict(model, rowOrVector) {
  const x = Array.isArray(rowOrVector) ? rowOrVector : rowOrVector.x;
  let score = 0;
  for (let j = 0; j < model.featureIndexes.length; j++) {
    const index = model.featureIndexes[j];
    score += model.weights[j] * finite(x[index]) / model.scales[j];
  }
  return sigmoid(score);
}

export function modelCoefficients(model) {
  return model.featureIndexes.map((index, j) => ({
    feature: FEATURE_NAMES[index],
    standardized_coefficient: model.weights[j],
    raw_coefficient: model.weights[j] / model.scales[j]
  })).sort((a, b) => Math.abs(b.standardized_coefficient) - Math.abs(a.standardized_coefficient));
}
