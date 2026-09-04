import {
  PREDICTOR_V02_VERSION,
  PREDICTOR_V02_TRAINING_END,
  PREDICTOR_V02_FEATURE_NAMES,
  PREDICTOR_V02_SCALES,
  PREDICTOR_V02_WEIGHTS,
  PREDICTOR_V02_PRIOR_OPTIONS,
  PREDICTOR_V02_BENCHMARK,
  predictV02Matchup,
  formatV02Drivers
} from './predictor_v02.mjs';

// Keep the public forecast model name stable so the existing Worker/API can
// switch versions without touching fight-day result plumbing.
export const FORECAST_NAME = 'CageMetrix Win Probability';
export const FORECAST_VERSION = PREDICTOR_V02_VERSION;
export const ELO_SLOPE = 0.006085080947128282;
export const FORECAST_PARAMETERS = Object.freeze({
  predictor_version: PREDICTOR_V02_VERSION,
  trained_through: PREDICTOR_V02_TRAINING_END,
  features: PREDICTOR_V02_FEATURE_NAMES,
  scales: PREDICTOR_V02_SCALES,
  standardized_weights: PREDICTOR_V02_WEIGHTS,
  warehouse_prior: PREDICTOR_V02_PRIOR_OPTIONS,
  regional_scope: 'pre-UFC completed fights only for fighters who reached the UFC; UFC technical evidence remains UFC-only',
  unrated_debutant_fallback: { type: 'elo', slope: ELO_SLOPE, initial_elo: 1500 },
  retrospective_benchmark: PREDICTOR_V02_BENCHMARK
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
      notes: 'Limited verified history. Predictor 0.2 has neither a UFC rating nor a verified pre-UFC warehouse prior for at least one fighter, so this matchup uses the frozen neutral-start Elo fallback.'
    };
  }

  const prediction = predictV02Matchup(a, b, a.warehouseSummary, b.warehouseSummary);
  const explanation = formatV02Drivers(prediction.drivers, names.a || a.name || 'Fighter A', names.b || b.name || 'Fighter B');
  const usedWarehouse = Boolean(a.warehouseSummary?.pre_ufc_bouts || b.warehouseSummary?.pre_ufc_bouts);
  return {
    probabilityA: prediction.probabilityA,
    probabilityB: prediction.probabilityB,
    pick: pickFor(prediction.probabilityA),
    sampleStrength,
    limitedHistory,
    drivers: prediction.drivers,
    modelUsed: 'predictor_v02',
    notes: `${limitedHistory ? 'Limited UFC sample. ' : ''}${usedWarehouse ? 'Verified pre-UFC résumé context is included. ' : ''}${explanation}`
  };
}

export function gradePrediction(probabilityA, winnerSide) {
  if (!['a', 'b'].includes(winnerSide) || probabilityA === 0.5) return null;
  return (probabilityA > 0.5 ? 'a' : 'b') === winnerSide;
}
