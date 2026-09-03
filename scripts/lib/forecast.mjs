export const FORECAST_NAME = 'CageMetrix Win Probability';
export const FORECAST_VERSION = '0.1.0';
// Learned on 2018–2022 only; held fixed for the 2023+ retrospective evaluation.
export const ELO_SLOPE = 0.006085080947128282;
export function forecast(a, b) {
  const probabilityA = 1 / (1 + Math.exp(-ELO_SLOPE * ((a?.eloRaw ?? 1500) - (b?.eloRaw ?? 1500))));
  return { probabilityA, probabilityB: 1 - probabilityA,
    pick: Math.abs(probabilityA - .5) < 1e-10 ? null : probabilityA > .5 ? 'a' : 'b',
    sampleStrength: Math.min(a?.confidence ?? 0, b?.confidence ?? 0),
    limitedHistory: !a || !b || Math.min(a.bouts, b.bouts) < 5 };
}
export function gradePrediction(probabilityA, winnerSide) {
  if (!['a','b'].includes(winnerSide) || probabilityA === .5) return null;
  return (probabilityA > .5 ? 'a' : 'b') === winnerSide;
}
