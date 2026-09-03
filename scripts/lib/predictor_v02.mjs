export const PREDICTOR_V02_NAME = 'CageMetrix Matchup Predictor';
export const PREDICTOR_V02_VERSION = '0.2.0-candidate';

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
  'finishing_diff',
  'strength_of_schedule_diff',
  'recent_form_diff',
  'pace_diff',
  'confidence_diff',
  'log_bouts_diff',
  'log_minutes_diff',
  'striking_matchup_edge',
  'wrestling_matchup_edge',
  'grappling_matchup_edge',
  'finishing_matchup_edge',
  'pace_pressure_edge',
  'recent_schedule_edge',
  'striking_evidence_edge',
  'wrestling_evidence_edge',
  'grappling_evidence_edge',
  'technical_evidence_edge',
  'elo_evidence_edge'
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = value => Number.isFinite(value) ? value : 0;
const centered = value => Number.isFinite(value) ? value : 50;

function rel(value, key) {
  const direct = value?.reliabilities?.[key];
  if (Number.isFinite(direct)) return clamp(direct, 0, 1);
  const snake = key.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
  const stored = value?.components?.component_reliability?.[snake];
  return Number.isFinite(stored) ? clamp(stored, 0, 1) : 0;
}

function normalizedRating(value) {
  if (!value) {
    return {
      eloRaw: 1500, cmr: 50, technical: 50, resume: 50,
      strikingOffense: 50, strikingDefense: 50,
      wrestlingOffense: 50, wrestlingDefense: 50,
      grappling: 50, finishing: 50, pace: 50,
      strengthOfSchedule: 50, recentForm: 50,
      confidence: 0, bouts: 0, minutes: 0,
      reliabilities: {}
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
    finishing: centered(value.finishing),
    pace: centered(value.pace),
    strengthOfSchedule: centered(value.strengthOfSchedule),
    recentForm: centered(value.recentForm),
    confidence: finite(value.confidence),
    bouts: finite(value.bouts),
    minutes: finite(value.minutes),
    reliabilities: value.reliabilities || {}
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

  const strikeEvidenceA = (
    a.strikingOffense * rel(a, 'strikingOffense')
    + a.strikingDefense * rel(a, 'strikingDefense')
  ) / 2;
  const strikeEvidenceB = (
    b.strikingOffense * rel(b, 'strikingOffense')
    + b.strikingDefense * rel(b, 'strikingDefense')
  ) / 2;
  const wrestleEvidenceA = (
    a.wrestlingOffense * rel(a, 'wrestlingOffense')
    + a.wrestlingDefense * rel(a, 'wrestlingDefense')
  ) / 2;
  const wrestleEvidenceB = (
    b.wrestlingOffense * rel(b, 'wrestlingOffense')
    + b.wrestlingDefense * rel(b, 'wrestlingDefense')
  ) / 2;
  const grappleEvidenceA = a.grappling * rel(a, 'grappling');
  const grappleEvidenceB = b.grappling * rel(b, 'grappling');
  const technicalEvidenceA = a.technical * rel(a, 'technical');
  const technicalEvidenceB = b.technical * rel(b, 'technical');
  const eloEvidenceA = (a.eloRaw - 1500) * rel(a, 'resume');
  const eloEvidenceB = (b.eloRaw - 1500) * rel(b, 'resume');

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
    diff(a, b, 'finishing'),
    diff(a, b, 'strengthOfSchedule'),
    diff(a, b, 'recentForm'),
    diff(a, b, 'pace'),
    diff(a, b, 'confidence'),
    Math.log1p(Math.max(0, a.bouts)) - Math.log1p(Math.max(0, b.bouts)),
    Math.log1p(Math.max(0, a.minutes)) - Math.log1p(Math.max(0, b.minutes)),
    strikeA - strikeB,
    wrestleA - wrestleB,
    grappleA - grappleB,
    finishA - finishB,
    paceA - paceB,
    recentScheduleA - recentScheduleB,
    strikeEvidenceA - strikeEvidenceB,
    wrestleEvidenceA - wrestleEvidenceB,
    grappleEvidenceA - grappleEvidenceB,
    technicalEvidenceA - technicalEvidenceB,
    eloEvidenceA - eloEvidenceB
  ];
}

export function sigmoid(value) {
  const z = clamp(value, -30, 30);
  return 1 / (1 + Math.exp(-z));
}

export function fitLogistic(rows, options = {}) {
  const featureIndexes = options.featureIndexes || FEATURE_NAMES.map((_, i) => i);
  const lambda = options.lambda ?? 0.01;
  const iterations = options.iterations ?? 900;
  const learningRate = options.learningRate ?? 0.03;
  if (!rows.length) throw new Error('Cannot fit predictor without rows');

  const examples = [];
  for (const row of rows) {
    const x = featureIndexes.map(i => row.x[i]);
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
    for (let j = 0; j < weights.length; j++) {
      const g = gradient[j] / xs.length + lambda * weights[j];
      m[j] = beta1 * m[j] + (1 - beta1) * g;
      v[j] = beta2 * v[j] + (1 - beta2) * g * g;
      const mHat = m[j] / (1 - beta1 ** step);
      const vHat = v[j] / (1 - beta2 ** step);
      weights[j] -= learningRate * mHat / (Math.sqrt(vHat) + epsilon);
    }
  }

  return { featureIndexes, scales, weights, lambda };
}

export function predict(model, rowOrVector) {
  const vector = Array.isArray(rowOrVector) ? rowOrVector : rowOrVector.x;
  let score = 0;
  for (let j = 0; j < model.featureIndexes.length; j++) {
    score += model.weights[j] * vector[model.featureIndexes[j]] / model.scales[j];
  }
  return sigmoid(score);
}

export function modelCoefficients(model) {
  return model.featureIndexes.map((featureIndex, j) => ({
    feature: FEATURE_NAMES[featureIndex],
    feature_index: featureIndex,
    standardized_coefficient: model.weights[j],
    scale: model.scales[j],
    raw_coefficient: model.weights[j] / model.scales[j]
  }));
}
