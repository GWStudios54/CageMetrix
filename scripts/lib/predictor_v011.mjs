// Predictor 0.1.1 intentionally keeps the exact Predictor 0.1 feature
// architecture and training machinery. The only model-design change is that
// it is refit on leakage-safe CMR 0.4 ratings rather than reusing coefficients
// learned from CMR 0.3 distributions.
import {
  FEATURE_NAMES,
  featureVector,
  sigmoid,
  fitLogistic as fitV01Logistic,
  predict,
  modelCoefficients
} from './predictor_v01.mjs';

export const PREDICTOR_V011_NAME = 'CageMetrix Matchup Predictor';
export const PREDICTOR_V011_VERSION = '0.1.1-candidate';
export const PREDICTOR_V011_TRAINING_END = '2022-12-31';

export { FEATURE_NAMES, featureVector, sigmoid, predict, modelCoefficients };

export function fitLogistic(rows, options = {}) {
  return {
    ...fitV01Logistic(rows, options),
    version: PREDICTOR_V011_VERSION
  };
}
