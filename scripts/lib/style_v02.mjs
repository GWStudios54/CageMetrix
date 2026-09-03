const MS_PER_YEAR = 31557600000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const safeDiv = (a, b, fallback = 0) => b > 0 ? a / b : fallback;

function yearsBetween(later, earlier) {
  return Math.max(0, (later - earlier) / MS_PER_YEAR);
}

function reliability(minutes) {
  return clamp(1 - Math.exp(-Math.max(0, minutes) / 45), 0, 0.99);
}

export function buildStyleProfiles(fightPairs) {
  const eligible = fightPairs.filter(pair => !pair.red.noContest);
  const sourceMaxDate = eligible.map(pair => pair.red.eventDate).filter(Boolean).sort().at(-1);
  const maxDate = sourceMaxDate ? new Date(`${sourceMaxDate}T00:00:00Z`) : new Date();
  const map = new Map();

  const add = obs => {
    if (!obs?.fighterId || !obs.eventDate) return;
    const years = yearsBetween(maxDate, new Date(`${obs.eventDate}T00:00:00Z`));
    const recency = Math.exp(-years / 3.5);
    const minutes = Math.max(0.5, Number(obs.durationMin) || 0);
    const weightedMinutes = minutes * recency;
    let p = map.get(obs.fighterId);
    if (!p) {
      p = {
        fighterId: obs.fighterId,
        weightedMinutes: 0,
        sigAttempts: 0,
        tdAttempts: 0,
        controlSeconds: 0,
        submissionAttempts: 0
      };
    }
    p.weightedMinutes += weightedMinutes;
    p.sigAttempts += Math.max(0, obs.sigA || 0) * recency;
    p.tdAttempts += Math.max(0, obs.tdA || 0) * recency;
    p.controlSeconds += Math.max(0, obs.ctrlSec || 0) * recency;
    p.submissionAttempts += Math.max(0, obs.sub || 0) * recency;
    map.set(obs.fighterId, p);
  };

  for (const pair of eligible) {
    add(pair.red);
    add(pair.blue);
  }

  for (const [fighterId, p] of map) {
    const minutes = p.weightedMinutes;
    const sigAttemptsPerMin = safeDiv(p.sigAttempts, minutes, 0);
    const tdAttemptsPer15 = safeDiv(p.tdAttempts * 15, minutes, 0);
    const controlShare = safeDiv(p.controlSeconds, minutes * 60, 0);
    const subAttemptsPer15 = safeDiv(p.submissionAttempts * 15, minutes, 0);
    map.set(fighterId, {
      fighterId,
      sigAttemptsPerMin,
      tdAttemptsPer15,
      controlShare,
      subAttemptsPer15,
      reliability: reliability(minutes),
      weightedMinutes: minutes
    });
  }

  return map;
}

export function neutralStyle() {
  return {
    sigAttemptsPerMin: 0,
    tdAttemptsPer15: 0,
    controlShare: 0,
    subAttemptsPer15: 0,
    reliability: 0,
    weightedMinutes: 0
  };
}
