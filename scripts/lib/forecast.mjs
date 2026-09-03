import {
  PREDICTOR_VERSION,
  PREDICTOR_TRAINING_END,
  FEATURE_NAMES,
  FROZEN_RAW_COEFFICIENTS,
  RETROSPECTIVE_BENCHMARK,
  predictMatchup,
  formatDrivers
} from './predictor_v01.mjs';

// Keep the public forecast model key stable so the existing Worker/API can
// switch models without touching fight-day result plumbing. The former Elo
// model is renamed to CageMetrix Elo Baseline during forecast sync.
export const FORECAST_NAME = 'CageMetrix Win Probability';
export const FORECAST_VERSION = PREDICTOR_VERSION;
export const ELO_SLOPE = 0.006085080947128282;
export const FORECAST_PARAMETERS = Object.freeze({
  predictor_version: PREDICTOR_VERSION,
  trained_through: PREDICTOR_TRAINING_END,
  features: FEATURE_NAMES,
  raw_coefficients: FROZEN_RAW_COEFFICIENTS,
  unrated_debutant_fallback: { type: 'elo', slope: ELO_SLOPE, initial_elo: 1500 },
  retrospective_benchmark: RETROSPECTIVE_BENCHMARK
});

function pickFor(probabilityA) {
  return Math.abs(probabilityA - 0.5) < 1e-10 ? null : probabilityA > 0.5 ? 'a' : 'b';
}

function eloFallback(a, b) {
  const probabilityA = 1 / (1 + Math.exp(-ELO_SLOPE * ((a?.eloRaw ?? 1500) - (b?.eloRaw ?? 1500))));
  return {
    probabilityA,
    probabilityB: 1 - probabilityA,
    pick: pickFor(probabilityA),
    drivers: [],
    modelUsed: 'elo_fallback'
  };
}

export function forecast(a, b, names = {}) {
  const sampleStrength = Math.min(a?.confidence ?? 0, b?.confidence ?? 0);
  const limitedHistory = !a || !b || Math.min(a?.bouts ?? 0, b?.bouts ?? 0) < 5;
  if (!a || !b) {
    const fallback = eloFallback(a, b);
    return {
      ...fallback,
      sampleStrength,
      limitedHistory,
      notes: 'Limited UFC history. Predictor 0.1 cannot score an unrated UFC debutant, so this matchup uses the frozen neutral-start Elo fallback.'
    };
  }

  const prediction = predictMatchup(a, b);
  const explanation = formatDrivers(prediction.drivers, names.a || a.name || 'Fighter A', names.b || b.name || 'Fighter B');
  return {
    probabilityA: prediction.probabilityA,
    probabilityB: prediction.probabilityB,
    pick: pickFor(prediction.probabilityA),
    sampleStrength,
    limitedHistory,
    drivers: prediction.drivers,
    modelUsed: 'predictor_v01',
    notes: `${limitedHistory ? 'Limited UFC sample. ' : ''}${explanation}`
  };
}

export function gradePrediction(probabilityA, winnerSide) {
  if (!['a', 'b'].includes(winnerSide) || probabilityA === 0.5) return null;
  return (probabilityA > 0.5 ? 'a' : 'b') === winnerSide;
}
