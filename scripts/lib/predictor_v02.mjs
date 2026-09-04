import { FEATURE_NAMES as BASE_FEATURE_NAMES, featureVector as baseFeatureVector, sigmoid } from './predictor_v01.mjs';
import { WAREHOUSE_FEATURE_NAMES, warehouseFeatureDiff } from './warehouse-prior.mjs';

export const PREDICTOR_V02_NAME = 'CageMetrix Matchup Predictor';
export const PREDICTOR_V02_VERSION = '0.2.1';
export const PREDICTOR_V02_TRAINING_END = '2022-12-31';
export const PREDICTOR_V02_FEATURE_NAMES = [...BASE_FEATURE_NAMES, ...WAREHOUSE_FEATURE_NAMES];
export const PREDICTOR_V02_LAMBDA = 0.003;
export const PREDICTOR_V02_PRIOR_OPTIONS = Object.freeze({ maxWeight: 0.65, decayBouts: 4 });

// Frozen Predictor 0.2.1 fit from canonicalized warehouse history. The feature
// family remains identical to 0.2.0; only the cleaned training rows changed.
// Selection used pre-2023 data only and never the holdout or live record.
export const PREDICTOR_V02_SCALES = Object.freeze([
  34.15767569956592, 9.595901566133515, 3.648207607666957, 10.240550627010176,
  7.72760266423662, 8.92994369564486, 9.99496511456938, 8.189607430921008,
  7.931258407950418, 9.77237817249981, 8.063419820341426, 10.701015957424351,
  9.550346520396273, 32.66412888507315, 0.9708614303950132, 1.7901778525523315,
  4.7610024044932695, 7.199969636655826, 5.751911911532349, 5.204342451684798,
  3.4656434015806656, 6.305942403951658, 17.67155287529013, 31.67434624328475,
  0.5402962793734364, 1.3150000211187916, 0.35521489415378904, 0.5601713903912343,
  0.3324868579306676, 0.4081801185005727, 0.4610365775917432, 0.3619506319613263,
  0.2877625482032048
]);

export const PREDICTOR_V02_WEIGHTS = Object.freeze([
  0.3893261719052253, -0.017195544973797237, 0.044413240079098956, -0.07041636426175567,
  0.017199153944551276, -0.08354146571753107, 0.10850427093586726, 0.053269608471146895,
  0.07298336160450428, -0.01510669949280868, 0.007928859901782872, -0.024896836865807813,
  -0.038607616896960226, -0.03532507697597166, -0.17548291002613464, 0.4087249225475964,
  0.3044534771856643, -0.04423749081713244, -0.020716375590206566, 0.01763133178269109,
  0.09296417074639143, 0.18511640344061556, -0.20857123298489819, -0.30250695768408664,
  -0.043724177428916586, -0.299081642743434, -0.08961850343544293, -0.06759054543979533,
  -0.1762587333625429, -0.33196644823014776, 0.17548000678648426, 0.49670097980047717,
  0.39233793401514166
]);

export const PREDICTOR_V02_BENCHMARK = Object.freeze({
  evaluation_start: '2023-01-01',
  evaluation_end: '2026-06-27',
  common_holdout: {
    bouts: 1446,
    accuracy: 0.636237897648686,
    brier: 0.2269958701693995,
    log_loss: 0.6459295489657018,
    predictor_v01_accuracy: 0.627939142461964,
    predictor_v01_brier: 0.22873148797050935,
    predictor_v01_log_loss: 0.649529292177401
  },
  expanded_holdout: {
    bouts: 1705,
    accuracy: 0.632258064516129,
    brier: 0.2267866511099782,
    log_loss: 0.6451431610431188
  }
});

export function predictorV02FeatureVector(aRating, bRating, aWarehouseSummary, bWarehouseSummary) {
  return [
    ...baseFeatureVector(aRating, bRating),
    ...warehouseFeatureDiff(aWarehouseSummary, bWarehouseSummary)
  ];
}

export function predictV02Vector(x) {
  if (!Array.isArray(x) || x.length !== PREDICTOR_V02_FEATURE_NAMES.length) {
    throw new Error('Invalid Predictor 0.2 feature vector');
  }
  let score = 0;
  for (let i = 0; i < x.length; i++) {
    const value = Number.isFinite(Number(x[i])) ? Number(x[i]) : 0;
    score += PREDICTOR_V02_WEIGHTS[i] * value / PREDICTOR_V02_SCALES[i];
  }
  return sigmoid(score);
}

const DRIVER_GROUPS = [
  { label: 'competitive strength', indexes: [0, 1, 3] },
  { label: 'overall technical profile', indexes: [2, 22] },
  { label: 'striking matchup', indexes: [4, 5, 16] },
  { label: 'wrestling and grappling matchup', indexes: [6, 7, 8, 17, 18] },
  { label: 'pace and finishing profile', indexes: [9, 10, 19, 20] },
  { label: 'recent form and schedule', indexes: [11, 12, 21] },
  { label: 'UFC experience and evidence', indexes: [13, 14, 15, 23] },
  { label: 'pre-UFC resume', indexes: [24, 25, 26, 27, 28, 29, 30, 31, 32] }
];

export function groupedV02Drivers(x, limit = 3) {
  const contributions = x.map((value, i) => {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
    return PREDICTOR_V02_WEIGHTS[i] * numeric / PREDICTOR_V02_SCALES[i];
  });
  return DRIVER_GROUPS.map(group => ({
    label: group.label,
    contribution: group.indexes.reduce((sum, i) => sum + contributions[i], 0)
  }))
    .filter(item => Math.abs(item.contribution) > 1e-9)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, limit)
    .map(item => ({ ...item, side: item.contribution >= 0 ? 'a' : 'b' }));
}

export function predictV02Matchup(aRating, bRating, aWarehouseSummary, bWarehouseSummary) {
  const x = predictorV02FeatureVector(aRating, bRating, aWarehouseSummary, bWarehouseSummary);
  const probabilityA = predictV02Vector(x);
  return {
    probabilityA,
    probabilityB: 1 - probabilityA,
    featureVector: x,
    drivers: groupedV02Drivers(x)
  };
}

export function formatV02Drivers(drivers, fighterA = 'Fighter A', fighterB = 'Fighter B') {
  if (!drivers?.length) return 'The model sees very little separation in the measured matchup profile.';
  return `Main model edges: ${drivers.map(driver => `${driver.side === 'a' ? fighterA : fighterB} — ${driver.label}`).join('; ')}.`;
}

export function coefficientsWithNames(model = { featureIndexes: PREDICTOR_V02_FEATURE_NAMES.map((_, i) => i), weights: PREDICTOR_V02_WEIGHTS, scales: PREDICTOR_V02_SCALES }) {
  return model.featureIndexes.map((index, position) => ({
    feature: PREDICTOR_V02_FEATURE_NAMES[index] || `feature_${index}`,
    standardized_coefficient: model.weights[position],
    raw_coefficient: model.weights[position] / model.scales[position]
  })).sort((a, b) => Math.abs(b.standardized_coefficient) - Math.abs(a.standardized_coefficient));
}
