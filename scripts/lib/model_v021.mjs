import {
  buildObservations,
  careerAggregates,
  canonicalWeightClass,
  buildRatings as buildRatingsV02
} from './model_v02.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export { buildObservations, careerAggregates, canonicalWeightClass };

function rankingReliability(minutes, bouts) {
  // A fight is an independent competitive observation even when it ends quickly.
  // Minutes still matter, especially for defensive/pace stability, but bout count
  // carries more weight for the confidence attached to the overall leaderboard.
  const minuteRel = 1 - Math.exp(-Math.max(0, minutes) / 45);
  const boutRel = 1 - Math.exp(-Math.max(0, bouts) / 5);
  return clamp(0.42 * minuteRel + 0.58 * boutRel, 0.08, 0.99);
}

export function buildRatings(fightPairs, aggregates, options = {}) {
  const result = buildRatingsV02(fightPairs, aggregates, options);

  const ratings = result.ratings.map(rating => {
    const reliability = rankingReliability(rating.minutes, rating.bouts);
    const performanceCmr = Number(rating.performanceCmr ?? rating.components?.performance_cmr ?? rating.cmr);

    // Do not throw away a dominant short-fight sample, but still pull uncertain
    // fighters toward neutral. Fewer than five bouts gets an additional penalty.
    const leaderboardRel = clamp(0.25 + 0.75 * reliability, 0.25, 0.995);
    const lowBoutPenalty = Math.max(0, 5 - rating.bouts) * 3.0;
    const uncertaintyPenalty = (1 - reliability) * 3.0 + lowBoutPenalty;
    const cmr = clamp(
      50 + (performanceCmr - 50) * leaderboardRel - uncertaintyPenalty,
      5,
      99
    );

    // Five fights are enough to leave the automatic provisional bucket only if
    // the combined evidence is also reasonably stable. This prevents a handful
    // of flash finishes from ranking like a veteran while not punishing a
    // ten-fight finisher solely for having little cage time.
    const provisional = rating.bouts < 5 || reliability < 0.55;
    const confidence = clamp(reliability * 100, 5, 99);

    return {
      ...rating,
      cmr,
      confidence,
      provisional,
      components: {
        ...(rating.components || {}),
        ranked_cmr: Number(cmr.toFixed(2)),
        provisional,
        sample_reliability: Number(reliability.toFixed(4)),
        uncertainty_penalty: Number(uncertaintyPenalty.toFixed(2)),
        reliability_method: '42pct_minutes_58pct_bouts',
        confidence_note: 'Overall ranking confidence treats each UFC bout as independent evidence; component ratings remain exposure-shrunk.'
      }
    };
  });

  return { ...result, ratings };
}
