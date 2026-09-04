import { FEATURE_NAMES as BASE_FEATURE_NAMES, featureVector as baseFeatureVector } from './predictor_v01.mjs';
import { WAREHOUSE_FEATURE_NAMES, warehouseFeatureDiff } from './warehouse-prior.mjs';

export const PREDICTOR_V02_NAME = 'CageMetrix Matchup Predictor';
export const PREDICTOR_V02_VERSION = '0.2.0-candidate';
export const PREDICTOR_V02_TRAINING_END = '2022-12-31';
export const PREDICTOR_V02_FEATURE_NAMES = [...BASE_FEATURE_NAMES, ...WAREHOUSE_FEATURE_NAMES];

export function predictorV02FeatureVector(aRating, bRating, aWarehouseSummary, bWarehouseSummary) {
  return [
    ...baseFeatureVector(aRating, bRating),
    ...warehouseFeatureDiff(aWarehouseSummary, bWarehouseSummary)
  ];
}

export function coefficientsWithNames(model) {
  return model.featureIndexes.map((index, position) => ({
    feature: PREDICTOR_V02_FEATURE_NAMES[index] || `feature_${index}`,
    standardized_coefficient: model.weights[position],
    raw_coefficient: model.weights[position] / model.scales[position]
  })).sort((a, b) => Math.abs(b.standardized_coefficient) - Math.abs(a.standardized_coefficient));
}
