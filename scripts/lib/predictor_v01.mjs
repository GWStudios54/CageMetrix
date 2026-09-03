export const PREDICTOR_VERSION = '0.1.0-experimental';

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = value => Number.isFinite(value) ? value : 0;
const diff = (a, b, key) => finite(a[key]) - finite(b[key]);

export function featureVector(a, b) {
  const strikeA = finite(a.strikingOffense) * (100 - finite(b.strikingDefense)) / 100;
  const strikeB = finite(b.strikingOffense) * (100 - finite(a.strikingDefense)) / 100;
  const wrestleA = finite(a.wrestlingOffense) * (100 - finite(b.wrestlingDefense)) / 100;
  const wrestleB = finite(b.wrestlingOffense) * (100 - finite(a.wrestlingDefense)) / 100;
  const grappleA = finite(a.grappling) * (100 - finite(b.wrestlingDefense)) / 100;
  const grappleB = finite(b.grappling) * (100 - finite(a.wrestlingDefense)) / 100;
  const defenseA = (finite(a.strikingDefense) + finite(a.wrestlingDefense)) / 2;
  const defenseB = (finite(b.strikingDefense) + finite(b.wrestlingDefense)) / 2;
  const finishA = finite(a.finishing) * (100 - defenseB) / 100;
  const finishB = finite(b.finishing) * (100 - defenseA) / 100;
  const paceA = finite(a.pace) * (100 - finite(b.strikingDefense)) / 100;
  const paceB = finite(b.pace) * (100 - finite(a.strikingDefense)) / 100;
  const recentScheduleA = finite(a.recentForm) * finite(a.strengthOfSchedule) / 100;
  const recentScheduleB = finite(b.recentForm) * finite(b.strengthOfSchedule) / 100;
  const technicalEvidenceA = finite(a.technical) * finite(a.confidence) / 100;
  const technicalEvidenceB = finite(b.technical) * finite(b.confidence) / 100;
  const eloEvidenceA = (finite(a.eloRaw) - 1500) * finite(a.confidence) / 100;
  const eloEvidenceB = (finite(b.eloRaw) - 1500) * finite(b.confidence) / 100;

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
    Math.log1p(Math.max(0, finite(a.bouts))) - Math.log1p(Math.max(0, finite(b.bouts))),
    Math.log1p(Math.max(0, finite(a.minutes))) - Math.log1p(Math.max(0, finite(b.minutes))),
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

function selectedVector(row, featureIndexes) {
  return featureIndexes.map(i => row.x[i]);
}

export function fitLogistic(rows, options = {}) {
  const featureIndexes = options.featureIndexes || FEATURE_NAMES.map((_, i) => i);
  const lambda = options.lambda ?? 0.01;
  const iterations = options.iterations ?? 2500;
  const learningRate = options.learningRate ?? 0.03;
  if (!rows.length) throw new Error('Cannot fit predictor without rows');

  // Mirroring every matchup removes red/blue corner bias and makes the learned
  // probability exactly symmetric: P(A,B) = 1 - P(B,A).
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
