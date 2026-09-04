const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizeFighterName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeWarehouseSummary(row) {
  if (!row) return null;
  const bouts = Math.max(0, finite(row.pre_ufc_bouts));
  const wins = Math.max(0, finite(row.pre_ufc_wins));
  const losses = Math.max(0, finite(row.pre_ufc_losses));
  const draws = Math.max(0, finite(row.pre_ufc_draws));
  const noContests = Math.max(0, finite(row.pre_ufc_no_contests));
  const finishes = Math.max(0, finite(row.pre_ufc_finishes));
  const majorOrgBouts = Math.max(0, finite(row.pre_ufc_major_org_bouts));
  const decisive = wins + losses;
  const winRate = decisive > 0 ? (wins + 1.5) / (decisive + 3) : 0.5;
  const finishRate = wins > 0 ? clamp(finishes / wins, 0, 1) : 0;
  const majorShare = bouts > 0 ? clamp(majorOrgBouts / bouts, 0, 1) : 0;
  const experience = bouts > 0 ? 1 - Math.exp(-bouts / 8) : 0;
  const layoffDays = Math.max(0, finite(row.days_from_last_pre_ufc_to_debut));
  return {
    ...row,
    bouts,
    wins,
    losses,
    draws,
    noContests,
    finishes,
    majorOrgBouts,
    decisive,
    winRate,
    finishRate,
    majorShare,
    experience,
    layoffDays
  };
}

export function warehousePrior(summaryInput) {
  const summary = normalizeWarehouseSummary(summaryInput);
  if (!summary || summary.bouts <= 0) {
    return {
      available: false,
      score: 50,
      resume: 50,
      schedule: 50,
      form: 50,
      reliability: 0,
      ...normalizeWarehouseSummary(summaryInput)
    };
  }

  // Regional records are useful evidence, but they are deliberately shrunk toward
  // neutral because a 10-0 regional record is not equivalent to a 10-0 UFC record.
  const layoffPenalty = summary.layoffDays > 540
    ? clamp(Math.log1p((summary.layoffDays - 365) / 365) * 1.7, 0, 4)
    : 0;
  const score = clamp(
    50
      + 22 * (summary.winRate - 0.5)
      + 5 * (summary.finishRate - 0.45)
      + 7 * summary.majorShare
      + 3 * summary.experience
      - layoffPenalty,
    35,
    78
  );
  const resume = clamp(
    50
      + 24 * (summary.winRate - 0.5)
      + 8 * summary.majorShare
      + 4 * summary.experience,
    35,
    82
  );
  const schedule = clamp(50 + 15 * summary.majorShare + 2 * Math.log1p(summary.bouts), 40, 75);
  const form = clamp(50 + 28 * (summary.winRate - 0.5) + 3 * (summary.finishRate - 0.45), 35, 70);
  const reliability = clamp(
    (1 - Math.exp(-summary.bouts / 7)) * (0.55 + 0.45 * summary.majorShare),
    0.05,
    0.88
  );

  return { available: true, score, resume, schedule, form, reliability, ...summary };
}

function neutralRating(prior) {
  const effective = (value) => 50 + (value - 50) * prior.reliability;
  return {
    eloRaw: 1500,
    cmr: effective(prior.score),
    technical: 50,
    resume: effective(prior.resume),
    strikingOffense: 50,
    strikingDefense: 50,
    wrestlingOffense: 50,
    wrestlingDefense: 50,
    grappling: 50,
    pace: 50,
    finishing: 50,
    strengthOfSchedule: effective(prior.schedule),
    recentForm: effective(prior.form),
    confidence: prior.reliability * 35,
    bouts: 0,
    minutes: 0,
    warehousePriorOnly: true
  };
}

export function applyWarehousePrior(baseRating, summaryInput, options = {}) {
  const prior = warehousePrior(summaryInput);
  if (!prior.available) return baseRating || null;
  if (!baseRating) {
    return {
      ...neutralRating(prior),
      warehousePrior: prior,
      warehousePriorWeight: prior.reliability
    };
  }

  const maxWeight = options.maxWeight ?? 0.65;
  const decayBouts = options.decayBouts ?? 3;
  const ufcBouts = Math.max(0, finite(baseRating.bouts));
  const weight = clamp(prior.reliability * Math.exp(-ufcBouts / Math.max(0.5, decayBouts)), 0, maxWeight);
  const blend = (base, regional, multiplier = 1) => {
    const w = clamp(weight * multiplier, 0, 0.9);
    return finite(base, 50) * (1 - w) + regional * w;
  };

  return {
    ...baseRating,
    cmr: blend(baseRating.cmr, prior.score, 1),
    resume: blend(baseRating.resume, prior.resume, 0.75),
    strengthOfSchedule: blend(baseRating.strengthOfSchedule, prior.schedule, 0.65),
    recentForm: blend(baseRating.recentForm, prior.form, 0.45),
    // Technical fields and UFC evidence confidence remain UFC-only.
    warehousePrior: prior,
    warehousePriorWeight: weight,
    warehousePriorOnly: false
  };
}

export const WAREHOUSE_FEATURE_NAMES = [
  'pre_ufc_coverage_diff',
  'log_pre_ufc_bouts_diff',
  'pre_ufc_win_rate_edge',
  'pre_ufc_finish_rate_diff',
  'pre_ufc_major_org_share_diff',
  'pre_ufc_experience_diff',
  'pre_ufc_debut_layoff_log_diff',
  'pre_ufc_prior_score_diff',
  'pre_ufc_prior_reliability_diff'
];

export function warehousePredictorFeatures(summaryInput) {
  const prior = warehousePrior(summaryInput);
  const layoffLog = prior.available ? Math.log1p(prior.layoffDays) / Math.log(1001) : 0;
  return [
    prior.available ? 1 : 0,
    prior.available ? Math.log1p(prior.bouts) : 0,
    prior.available ? (prior.winRate - 0.5) * 2 : 0,
    prior.available ? prior.finishRate : 0,
    prior.available ? prior.majorShare : 0,
    prior.available ? prior.experience : 0,
    layoffLog,
    prior.available ? (prior.score - 50) / 20 : 0,
    prior.reliability
  ];
}

export function warehouseFeatureDiff(a, b) {
  const av = warehousePredictorFeatures(a);
  const bv = warehousePredictorFeatures(b);
  return av.map((value, index) => value - bv[index]);
}
