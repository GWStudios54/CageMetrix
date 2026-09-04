import { FEATURE_NAMES as BASE_FEATURE_NAMES, featureVector as baseFeatureVector, sigmoid } from './predictor_v01.mjs';
import { WAREHOUSE_FEATURE_NAMES, warehouseFeatureDiff } from './warehouse-prior.mjs';

export const PREDICTOR_V02_NAME = 'CageMetrix Matchup Predictor';
export const PREDICTOR_V02_VERSION = '0.2.0';
export const PREDICTOR_V02_TRAINING_END = '2022-12-31';
export const PREDICTOR_V02_FEATURE_NAMES = [...BASE_FEATURE_NAMES, ...WAREHOUSE_FEATURE_NAMES];
export const PREDICTOR_V02_LAMBDA = 0.003;
export const PREDICTOR_V02_PRIOR_OPTIONS = Object.freeze({ maxWeight: 0.65, decayBouts: 4 });

// Frozen Predictor 0.2 fit selected only with pre-2023 data. These coefficients
// are never retuned against the 2023+ holdout or live prediction record.
export const PREDICTOR_V02_SCALES = Object.freeze([
  34.15767569956592, 9.65122462993745, 3.648207607666957, 10.259268662660567,
  7.72760266423662, 8.92994369564486, 9.99496511456938, 8.189607430921008,
  7.931258407950418, 9.77237817249981, 8.063419820341426, 10.778494542777826,
  9.569907869493596, 32.37672799910695, 0.9708614303950132, 1.7901778525523315,
  4.7610024044932695, 7.199969636655826, 5.751911911532349, 5.204342451684798,
  3.4656434015806656, 6.432389608319087, 17.529962244348678, 31.67434624328475,
  0.5402962793734364, 1.4032973749664377, 0.36884621913329907, 0.5607038337250558,
  0.3790360688494272, 0.43428349528245114, 0.4610365775917432, 0.39159680529540936,
  0.33542429908594135
]);

export const PREDICTOR_V02_WEIGHTS = Object.freeze([
  0.37791055033743687, 0.017090826689760426, 0.03884774881554984, -0.058483921307838985,
  0.014097994258645729, -0.08714928780122634, 0.10749326717831846, 0.05188545869285523,
  0.07270258259237923, -0.01791095392928448, 0.00382544814947375, -0.027266805251320348,
  -0.03550470488594205, -0.05846571788305317, -0.16799004505667978, 0.4410385881083462,
  0.30423657981601776, -0.04366515482515099, -0.01819570235695285, 0.017774131761526625,
  0.09464057697203687, 0.18404999964303773, -0.22808346956181544, -0.3154577493823653,
  -0.07235064067849749, -0.21758988615540853, -0.07863732189088822, -0.04453935835784002,
  -0.18094802768930285, -0.3222602036475897, 0.174462581582554, 0.4788783679661979,
  0.3343393139993159
]);

export const PREDICTOR_V02_BENCHMARK = Object.freeze({
  evaluation_start: '2023-01-01',
  evaluation_end: '2026-06-27',
  common_holdout: {
    bouts: 1446,
    accuracy: 0.6327800829875518,
    brier: 0.22720710158619148,
    log_loss: 0.6464051285949408,
    predictor_v01_accuracy: 0.627939142461964,
    predictor_v01_brier: 0.22873148797050935,
    predictor_v01_log_loss: 0.649529292177401
  },
  expanded_holdout: {
    bouts: 1705,
    accuracy: 0.6275659824046921,
    brier: 0.226929415564528,
    log_loss: 0.645470750922423
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
