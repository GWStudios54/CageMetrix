import {
  buildObservations,
  careerAggregates,
  canonicalWeightClass,
  buildRatings as buildRatingsV021
} from './model_v021.mjs';

export { buildObservations, careerAggregates, canonicalWeightClass };

export function buildRatings(fightPairs, aggregates) {
  const result = buildRatingsV021(fightPairs, aggregates, {
    previousDivisionLookbackYears: 2
  });

  const ratings = result.ratings.map(rating => ({
    ...rating,
    components: {
      ...(rating.components || {}),
      division_transfer_policy: 'Immediately previous division is retained for the two years before the fighter’s debut in the current division.'
    }
  }));

  return { ...result, ratings };
}
