import { displayName, parseClock, parseDate, parsePair } from './csv.mjs';
import { fighterIdentity, assertIdentityConsistency } from './identity.mjs';

export const CMR_V04_VERSION = '0.4.0-candidate';

const MS_PER_YEAR = 31557600000;
const STRIKE_PRIOR_ATTEMPTS = 120;
const TD_PRIOR_ATTEMPTS = 12;
const CONTROL_PRIOR_SECONDS = 120;
const GRAPPLE_PRIOR_UNITS = 6;
const TRANSFER_WEIGHT = 0.8;

const TECHNICAL_WEIGHTS = Object.freeze({
  strikingOffense: 0.28,
  strikingDefense: 0.24,
  wrestlingOffense: 0.16,
  wrestlingDefense: 0.16,
  grappling: 0.10,
  finishing: 0.06
});

const CMR_WEIGHTS = Object.freeze({
  technical: 0.56,
  resume: 0.24,
  strengthOfSchedule: 0.10,
  recentForm: 0.10
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const key = (id, division) => `${id}::${division}`;
const safeDiv = (a, b, fallback = 0) => b > 0 ? a / b : fallback;
const yearsBetween = (later, earlier) => Math.max(0, (later - earlier) / MS_PER_YEAR);

function weightedMean(items, fallback = 0) {
  let sum = 0;
  let weight = 0;
  for (const [value, w] of items) {
    if (!Number.isFinite(value) || !Number.isFinite(w) || w <= 0) continue;
    sum += value * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : fallback;
}

function distribution(values) {
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return { mean: 0, sd: 1 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1);
  return { mean, sd: Math.sqrt(variance) || 1 };
}

function scoreFrom(value, dist) {
  return clamp(50 + 15 * ((value - dist.mean) / dist.sd), 5, 99);
}

function shrinkScore(score, reliability) {
  return 50 + (score - 50) * clamp(reliability, 0, 0.99);
}

function evidenceReliability(evidence, scale) {
  return clamp(1 - Math.exp(-Math.max(0, evidence) / scale), 0, 0.99);
}

function logit(probability) {
  const p = clamp(probability, 0.0025, 0.9975);
  return Math.log(p / (1 - p));
}

function smoothedRate(successes, attempts) {
  if (!(attempts > 0)) return null;
  return (Math.max(0, successes) + 0.5) / (attempts + 1);
}

function leaveOneOutRate(agg, numeratorField, denominatorField, currentNumerator, currentDenominator, priorRate, priorAttempts) {
  const numerator = Math.max(0, Number(agg?.[numeratorField] || 0) - Math.max(0, currentNumerator || 0));
  const denominator = Math.max(0, Number(agg?.[denominatorField] || 0) - Math.max(0, currentDenominator || 0));
  return (numerator + priorRate * priorAttempts) / (denominator + priorAttempts);
}

function opportunityWeight(evidence, reference) {
  if (!(evidence > 0)) return 0;
  return clamp(Math.sqrt(evidence / reference), 0.18, 1.6);
}

function scheduledRoundMinutes(timeFormat) {
  const m = String(timeFormat || '').match(/\(([^)]+)\)/);
  return m ? m[1].split('-').map(x => Number(x.trim())).filter(Number.isFinite) : [];
}

function fightDurationSeconds(row) {
  const round = Math.max(1, Number(row.round) || 1);
  const roundLengths = scheduledRoundMinutes(row.time_format);
  let seconds = 0;
  for (let r = 1; r < round; r++) seconds += (roundLengths[r - 1] || 5) * 60;
  seconds += parseClock(row.time);
  return Math.max(30, seconds || 300);
}

export function canonicalWeightClass(value) {
  const raw = String(value || '').replace(/Interim\s+/gi, ' ').replace(/Title\s+Bout/gi, ' ').replace(/\s+Bout$/i, ' ').trim();
  const s = raw.toLowerCase();
  if (!s) return 'Unknown';
  if (s.includes('catch')) return 'Catch Weight';
  if (s.includes("women's strawweight") || s.includes('womens strawweight')) return "Women's Strawweight";
  if (s.includes("women's flyweight") || s.includes('womens flyweight')) return "Women's Flyweight";
  if (s.includes("women's bantamweight") || s.includes('womens bantamweight')) return "Women's Bantamweight";
  if (s.includes("women's featherweight") || s.includes('womens featherweight')) return "Women's Featherweight";
  if (s.includes('light heavyweight')) return 'Light Heavyweight';
  if (s.includes('heavyweight')) return 'Heavyweight';
  if (s.includes('middleweight')) return 'Middleweight';
  if (s.includes('welterweight')) return 'Welterweight';
  if (s.includes('lightweight')) return 'Lightweight';
  if (s.includes('featherweight')) return 'Featherweight';
  if (s.includes('bantamweight')) return 'Bantamweight';
  if (s.includes('flyweight')) return 'Flyweight';
  if (s.includes('strawweight')) return 'Strawweight';
  if (s.includes('open weight') || s.includes('openweight')) return 'Open Weight';
  return raw
    .replace(/^UFC\s+/i, '')
    .replace(/^Road to UFC\s+\d*\s*/i, '')
    .replace(/^Ultimate Fighter\s+\d*\s*/i, '')
    .replace(/\s+Tournament$/i, '')
    .trim() || 'Unknown';
}

function outcomeValue(row, side) {
  if (row.fight_outcome === 'draw') return 0.5;
  if (row.fight_outcome === 'red_win') return side === 'red' ? 1 : 0;
  if (row.fight_outcome === 'blue_win') return side === 'blue' ? 1 : 0;
  return 0.5;
}

function finishType(row) {
  const method = String(row.method || '');
  return {
    finish: /^(KO\/TKO|TKO - Doctor's Stoppage|Submission)$/i.test(method),
    ko: /^(KO\/TKO|TKO - Doctor's Stoppage)$/i.test(method),
    submission: /^Submission$/i.test(method)
  };
}

export function buildObservations(rows) {
  const pairs = rows.map((r, index) => {
    const durationSec = fightDurationSeconds(r);
    const durationMin = durationSec / 60;
    const [rSigL, rSigA] = parsePair(r.red_fighter_sig_str);
    const [bSigL, bSigA] = parsePair(r.blue_fighter_sig_str);
    const [rTdL, rTdA] = parsePair(r.red_fighter_TD);
    const [bTdL, bTdA] = parsePair(r.blue_fighter_TD);
    const eventDate = parseDate(r.event_date);
    const weightClass = canonicalWeightClass(r.bout_type);
    if (!eventDate) throw new Error(`Invalid bout date: ${r.event_date}`);
    if (!['red_win', 'blue_win', 'draw', 'no_contest'].includes(r.fight_outcome)) throw new Error(`Unknown bout outcome: ${r.fight_outcome}`);
    const redIdentity = fighterIdentity(r, 'red');
    const blueIdentity = fighterIdentity(r, 'blue');
    const redSub = Number(r.red_fighter_sub_att) || 0;
    const blueSub = Number(r.blue_fighter_sub_att) || 0;
    const redKd = Number(r.red_fighter_KD) || 0;
    const blueKd = Number(r.blue_fighter_KD) || 0;
    const redCtrl = parseClock(r.red_fighter_ctrl);
    const blueCtrl = parseClock(r.blue_fighter_ctrl);
    const type = finishType(r);
    const common = {
      index, eventDate, weightClass, durationSec, durationMin,
      noContest: r.fight_outcome === 'no_contest',
      finish: type.finish, koFinish: type.ko, submissionFinish: type.submission, row: r
    };
    return {
      red: {
        ...common, identity: redIdentity, fighterId: redIdentity.id, opponentId: blueIdentity.id,
        side: 'red', name: displayName(r.red_fighter_name), opponent: displayName(r.blue_fighter_name),
        won: outcomeValue(r, 'red'),
        sigL: rSigL, sigA: rSigA, sigAbs: bSigL, sigAbsA: bSigA,
        tdL: rTdL, tdA: rTdA, tdAllowed: bTdL, tdFaced: bTdA,
        sub: redSub, subFaced: blueSub, kd: redKd, kdFaced: blueKd,
        ctrlSec: redCtrl, oppCtrlSec: blueCtrl
      },
      blue: {
        ...common, identity: blueIdentity, fighterId: blueIdentity.id, opponentId: redIdentity.id,
        side: 'blue', name: displayName(r.blue_fighter_name), opponent: displayName(r.red_fighter_name),
        won: outcomeValue(r, 'blue'),
        sigL: bSigL, sigA: bSigA, sigAbs: rSigL, sigAbsA: rSigA,
        tdL: bTdL, tdA: bTdA, tdAllowed: rTdL, tdFaced: rTdA,
        sub: blueSub, subFaced: redSub, kd: blueKd, kdFaced: redKd,
        ctrlSec: blueCtrl, oppCtrlSec: redCtrl
      }
    };
  });
  assertIdentityConsistency(pairs);
  return pairs;
}

export function careerAggregates(fightPairs) {
  const map = new Map();
  const add = obs => {
    let a = map.get(obs.fighterId);
    if (!a) {
      a = { fighterId: obs.fighterId, identity: obs.identity, name: obs.name, bouts: 0, minutes: 0, lastFight: null, weightClass: obs.weightClass };
      map.set(obs.fighterId, a);
    }
    a.bouts += 1;
    a.minutes += obs.durationMin;
    if (!a.lastFight || obs.eventDate > a.lastFight) {
      a.lastFight = obs.eventDate;
      a.weightClass = obs.weightClass;
    }
  };
  for (const { red, blue } of fightPairs) {
    if (!red.noContest) add(red);
    if (!blue.noContest) add(blue);
  }
  return map;
}

function grapplingUnits(obs) {
  return (obs.ctrlSec + obs.oppCtrlSec) / 60
    + 0.5 * (obs.tdA + obs.tdFaced)
    + 0.75 * (obs.sub + obs.subFaced);
}

function divisionOpponentAggregates(fightPairs) {
  const map = new Map();
  const add = obs => {
    const k = key(obs.fighterId, obs.weightClass);
    let a = map.get(k);
    if (!a) {
      a = {
        minutes: 0,
        sigL: 0, sigA: 0, sigAbs: 0, sigAbsA: 0,
        tdL: 0, tdA: 0, tdAllowed: 0, tdFaced: 0,
        ctrlSec: 0, oppCtrlSec: 0, sub: 0, subFaced: 0,
        kd: 0, kdFaced: 0, grappleUnits: 0
      };
    }
    a.minutes += obs.durationMin;
    a.sigL += obs.sigL; a.sigA += obs.sigA; a.sigAbs += obs.sigAbs; a.sigAbsA += obs.sigAbsA;
    a.tdL += obs.tdL; a.tdA += obs.tdA; a.tdAllowed += obs.tdAllowed; a.tdFaced += obs.tdFaced;
    a.ctrlSec += obs.ctrlSec; a.oppCtrlSec += obs.oppCtrlSec;
    a.sub += obs.sub; a.subFaced += obs.subFaced; a.kd += obs.kd; a.kdFaced += obs.kdFaced;
    a.grappleUnits += grapplingUnits(obs);
    map.set(k, a);
  };
  for (const { red, blue } of fightPairs) { add(red); add(blue); }
  return map;
}

function divisionPriors(fightPairs) {
  const by = new Map();
  const add = obs => {
    const d = by.get(obs.weightClass) || {
      minutes: 0,
      sigL: 0, sigA: 0, sigAbs: 0, sigAbsA: 0,
      tdL: 0, tdA: 0, tdAllowed: 0, tdFaced: 0,
      ctrlSec: 0, oppCtrlSec: 0, sub: 0, subFaced: 0,
      kd: 0, grappleUnits: 0
    };
    d.minutes += obs.durationMin;
    d.sigL += obs.sigL; d.sigA += obs.sigA; d.sigAbs += obs.sigAbs; d.sigAbsA += obs.sigAbsA;
    d.tdL += obs.tdL; d.tdA += obs.tdA; d.tdAllowed += obs.tdAllowed; d.tdFaced += obs.tdFaced;
    d.ctrlSec += obs.ctrlSec; d.oppCtrlSec += obs.oppCtrlSec;
    d.sub += obs.sub; d.subFaced += obs.subFaced; d.kd += obs.kd;
    d.grappleUnits += grapplingUnits(obs);
    by.set(obs.weightClass, d);
  };
  for (const { red, blue } of fightPairs) { add(red); add(blue); }
  for (const [division, d] of by) {
    by.set(division, {
      sigOffAcc: safeDiv(d.sigL, d.sigA, 0.45),
      sigAllowAcc: safeDiv(d.sigAbs, d.sigAbsA, 0.45),
      tdOffAcc: safeDiv(d.tdL, d.tdA, 0.35),
      tdAllowAcc: safeDiv(d.tdAllowed, d.tdFaced, 0.35),
      controlShare: safeDiv(d.ctrlSec, d.ctrlSec + d.oppCtrlSec, 0.5),
      subPerGrappleUnit: safeDiv(d.sub, d.grappleUnits, 0),
      kdPerSigLanded: safeDiv(d.kd, d.sigL, 0),
      sigAttemptsPerMin: safeDiv(d.sigA, d.minutes, 0),
      tdAttemptsPer15: safeDiv(d.tdA * 15, d.minutes, 0)
    });
  }
  return by;
}

function computeElo(fightPairs) {
  const current = new Map();
  const opponentPre = new Map();
  const fighterPre = new Map();
  const ordered = [...fightPairs].filter(p => p.red.eventDate).sort((a, b) => a.red.eventDate.localeCompare(b.red.eventDate) || a.red.index - b.red.index);
  for (const pair of ordered) {
    if (pair.red.noContest) continue;
    const a = pair.red.fighterId;
    const b = pair.blue.fighterId;
    const ra = current.get(a) ?? 1500;
    const rb = current.get(b) ?? 1500;
    opponentPre.set(`${pair.red.index}:red`, rb);
    opponentPre.set(`${pair.blue.index}:blue`, ra);
    fighterPre.set(`${pair.red.index}:red`, ra);
    fighterPre.set(`${pair.blue.index}:blue`, rb);
    const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
    const kFactor = 28;
    current.set(a, ra + kFactor * (pair.red.won - expectedA));
    current.set(b, rb + kFactor * (pair.blue.won - (1 - expectedA)));
  }
  return { current, opponentPre, fighterPre };
}

function yearsBefore(dateString, years) {
  if (!dateString || !years) return null;
  const date = new Date(`${dateString}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf())) return null;
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function buildTransferScopes(fightPairs, aggregates, lookbackYears) {
  if (!(lookbackYears > 0)) return new Map();
  const byFighter = new Map();
  const add = obs => {
    if (!obs.eventDate) return;
    if (!byFighter.has(obs.fighterId)) byFighter.set(obs.fighterId, []);
    byFighter.get(obs.fighterId).push(obs);
  };
  for (const { red, blue } of fightPairs) { add(red); add(blue); }

  const scopes = new Map();
  for (const [fighterId, observations] of byFighter) {
    const currentDivision = aggregates.get(fighterId)?.weightClass;
    if (!currentDivision) continue;
    const ordered = observations.filter(obs => obs.eventDate).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.index - b.index);
    if (!ordered.length) continue;
    let end = ordered.length - 1;
    while (end >= 0 && ordered[end].weightClass !== currentDivision) end -= 1;
    if (end < 0) continue;
    let start = end;
    while (start > 0 && ordered[start - 1].weightClass === currentDivision) start -= 1;
    if (start === 0) continue;
    const previousDivision = ordered[start - 1].weightClass;
    const currentDebutDate = ordered[start].eventDate;
    const cutoffDate = yearsBefore(currentDebutDate, lookbackYears);
    if (!previousDivision || !currentDebutDate || !cutoffDate) continue;
    scopes.set(fighterId, { currentDivision, previousDivision, currentDebutDate, cutoffDate, lookbackYears });
  }
  return scopes;
}

function currentFightControlExpected(oppAgg, obs, priorControlShare) {
  const opponentOwn = Math.max(0, Number(oppAgg?.ctrlSec || 0) - obs.oppCtrlSec);
  const opponentsControl = Math.max(0, Number(oppAgg?.oppCtrlSec || 0) - obs.ctrlSec);
  const priorOpponentsControlShare = 1 - priorControlShare;
  return (opponentsControl + priorOpponentsControlShare * CONTROL_PRIOR_SECONDS)
    / (opponentOwn + opponentsControl + CONTROL_PRIOR_SECONDS);
}

function currentFightSubAllowedExpected(oppAgg, obs, priorSubRate) {
  const remainingUnits = Math.max(0, Number(oppAgg?.grappleUnits || 0) - grapplingUnits(obs));
  const subFaced = Math.max(0, Number(oppAgg?.subFaced || 0) - obs.sub);
  return (subFaced + priorSubRate * GRAPPLE_PRIOR_UNITS) / (remainingUnits + GRAPPLE_PRIOR_UNITS);
}

function componentScore(raw, dist, reliability) {
  if (!Number.isFinite(raw) || !(reliability > 0)) return { rawScore: 50, score: 50 };
  const rawScore = scoreFrom(raw, dist);
  return { rawScore, score: shrinkScore(rawScore, reliability) };
}

export function buildRatings(fightPairs, aggs, options = {}) {
  if (options.asOfDate) fightPairs = fightPairs.filter(p => p.red.eventDate <= options.asOfDate);
  fightPairs = fightPairs.filter(p => !p.red.noContest);
  aggs = careerAggregates(fightPairs);
  const priors = divisionPriors(fightPairs);
  const divisionAggs = divisionOpponentAggregates(fightPairs);
  const { current: elo, opponentPre, fighterPre } = computeElo(fightPairs);
  const sourceMaxDate = fightPairs.map(p => p.red.eventDate).filter(Boolean).sort().at(-1);
  const maxDate = sourceMaxDate ? new Date(`${sourceMaxDate}T00:00:00Z`) : new Date();
  const previousDivisionLookbackYears = options.previousDivisionLookbackYears ?? 2;
  const transferScopes = buildTransferScopes(fightPairs, aggs, previousDivisionLookbackYears);
  const perf = new Map();

  for (const pair of fightPairs) {
    for (const obs of [pair.red, pair.blue]) {
      const fighterCareer = aggs.get(obs.fighterId);
      if (!fighterCareer) continue;
      const currentDivision = fighterCareer.weightClass;
      const transferScope = transferScopes.get(obs.fighterId);
      const isCurrentDivision = obs.weightClass === currentDivision;
      const isTransferred = Boolean(
        transferScope
        && obs.weightClass === transferScope.previousDivision
        && obs.eventDate >= transferScope.cutoffDate
        && obs.eventDate < transferScope.currentDebutDate
      );
      if (!isCurrentDivision && !isTransferred) continue;

      const oppAgg = divisionAggs.get(key(obs.opponentId, obs.weightClass));
      const prior = priors.get(obs.weightClass);
      if (!oppAgg || !prior) continue;

      const years = obs.eventDate ? yearsBetween(maxDate, new Date(`${obs.eventDate}T00:00:00Z`)) : 10;
      const recency = Math.exp(-years / 3.5);
      const transferWeight = isTransferred ? TRANSFER_WEIGHT : 1;
      const baseWeight = recency * transferWeight;
      const opponentElo = opponentPre.get(`${obs.index}:${obs.side}`) ?? 1500;
      const ownPreElo = fighterPre.get(`${obs.index}:${obs.side}`) ?? 1500;

      const sigOff = obs.sigA > 0
        ? logit(smoothedRate(obs.sigL, obs.sigA)) - logit(leaveOneOutRate(oppAgg, 'sigAbs', 'sigAbsA', obs.sigL, obs.sigA, prior.sigAllowAcc, STRIKE_PRIOR_ATTEMPTS))
        : null;
      const sigDef = obs.sigAbsA > 0
        ? logit(leaveOneOutRate(oppAgg, 'sigL', 'sigA', obs.sigAbs, obs.sigAbsA, prior.sigOffAcc, STRIKE_PRIOR_ATTEMPTS)) - logit(smoothedRate(obs.sigAbs, obs.sigAbsA))
        : null;
      const tdOff = obs.tdA > 0
        ? logit(smoothedRate(obs.tdL, obs.tdA)) - logit(leaveOneOutRate(oppAgg, 'tdAllowed', 'tdFaced', obs.tdL, obs.tdA, prior.tdAllowAcc, TD_PRIOR_ATTEMPTS))
        : null;
      const tdDef = obs.tdFaced > 0
        ? logit(leaveOneOutRate(oppAgg, 'tdL', 'tdA', obs.tdAllowed, obs.tdFaced, prior.tdOffAcc, TD_PRIOR_ATTEMPTS)) - logit(smoothedRate(obs.tdAllowed, obs.tdFaced))
        : null;

      const gUnits = grapplingUnits(obs);
      let grappling = null;
      let subThreat = null;
      if (gUnits > 0) {
        const actualControlShare = (obs.ctrlSec + CONTROL_PRIOR_SECONDS / 4)
          / (obs.ctrlSec + obs.oppCtrlSec + CONTROL_PRIOR_SECONDS / 2);
        const expectedControlShare = currentFightControlExpected(oppAgg, obs, prior.controlShare);
        const controlEdge = logit(actualControlShare) - logit(expectedControlShare);
        const actualSubRate = (obs.sub + 0.1) / (gUnits + 1);
        const expectedSubRate = currentFightSubAllowedExpected(oppAgg, obs, prior.subPerGrappleUnit);
        const subEdge = Math.log((actualSubRate + 0.02) / (expectedSubRate + 0.02));
        grappling = 0.75 * controlEdge + 0.25 * subEdge;
        subThreat = obs.sub / Math.max(1, gUnits);
      }

      const kdThreat = obs.sigL > 0 ? obs.kd / obs.sigL : null;
      const paceActivity = safeDiv(obs.sigA, obs.durationMin, 0)
        + 0.5 * safeDiv(obs.tdA * 15, obs.durationMin, 0);

      let p = perf.get(obs.fighterId);
      if (!p) {
        p = {
          name: obs.name,
          fighterId: obs.fighterId,
          identity: obs.identity,
          weightClass: currentDivision,
          lastFight: fighterCareer.lastFight,
          bouts: 0,
          minutes: 0,
          currentDivisionBouts: 0,
          currentDivisionMinutes: 0,
          transferredBouts: 0,
          transferredMinutes: 0,
          transferScope: transferScope || null,
          sigOff: [], sigDef: [], tdOff: [], tdDef: [], grappling: [],
          kdThreat: [], subThreat: [], pace: [], sos: [], results: [],
          evidence: {
            sigOff: 0, sigDef: 0, tdOff: 0, tdDef: 0, grappling: 0,
            kd: 0, sub: 0, paceMinutes: 0, sosBouts: 0
          }
        };
      }

      p.bouts += 1;
      p.minutes += obs.durationMin;
      if (isTransferred) {
        p.transferredBouts += 1;
        p.transferredMinutes += obs.durationMin;
      } else {
        p.currentDivisionBouts += 1;
        p.currentDivisionMinutes += obs.durationMin;
      }

      if (sigOff !== null) {
        p.sigOff.push([sigOff, baseWeight * opportunityWeight(obs.sigA, 60)]);
        p.evidence.sigOff += obs.sigA * baseWeight;
      }
      if (sigDef !== null) {
        p.sigDef.push([sigDef, baseWeight * opportunityWeight(obs.sigAbsA, 60)]);
        p.evidence.sigDef += obs.sigAbsA * baseWeight;
      }
      if (tdOff !== null) {
        p.tdOff.push([tdOff, baseWeight * opportunityWeight(obs.tdA, 4)]);
        p.evidence.tdOff += obs.tdA * baseWeight;
      }
      if (tdDef !== null) {
        p.tdDef.push([tdDef, baseWeight * opportunityWeight(obs.tdFaced, 4)]);
        p.evidence.tdDef += obs.tdFaced * baseWeight;
      }
      if (grappling !== null) {
        p.grappling.push([grappling, baseWeight * opportunityWeight(gUnits, 4)]);
        p.evidence.grappling += gUnits * baseWeight;
      }
      if (kdThreat !== null) {
        p.kdThreat.push([kdThreat, baseWeight * opportunityWeight(obs.sigL, 30)]);
        p.evidence.kd += obs.sigL * baseWeight;
      }
      if (subThreat !== null) {
        p.subThreat.push([subThreat, baseWeight * opportunityWeight(gUnits, 4)]);
        p.evidence.sub += gUnits * baseWeight;
      }
      p.pace.push([paceActivity, baseWeight * opportunityWeight(obs.durationMin, 15)]);
      p.evidence.paceMinutes += obs.durationMin * baseWeight;
      p.sos.push([opponentElo, baseWeight]);
      p.evidence.sosBouts += baseWeight;

      const expectedResult = 1 / (1 + 10 ** ((opponentElo - ownPreElo) / 400));
      const recentWeight = Math.exp(-years / 1.5) * transferWeight;
      p.results.push({
        date: obs.eventDate,
        won: obs.won,
        expected: expectedResult,
        residual: obs.won - expectedResult,
        weight: recentWeight,
        opponentElo,
        weightClass: obs.weightClass,
        transferred: isTransferred
      });
      perf.set(obs.fighterId, p);
    }
  }

  const rows = [...perf.values()].map(p => ({
    ...p,
    sigOffRaw: weightedMean(p.sigOff, 0),
    sigDefRaw: weightedMean(p.sigDef, 0),
    tdOffRaw: weightedMean(p.tdOff, 0),
    tdDefRaw: weightedMean(p.tdDef, 0),
    grapplingRaw: weightedMean(p.grappling, 0),
    kdThreatRaw: weightedMean(p.kdThreat, 0),
    subThreatRaw: weightedMean(p.subThreat, 0),
    paceRaw: weightedMean(p.pace, 0),
    sosRaw: weightedMean(p.sos, 1500),
    eloRaw: elo.get(p.fighterId) ?? 1500
  }));

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.weightClass)) groups.set(row.weightClass, []);
    groups.get(row.weightClass).push(row);
  }

  const ratings = [];
  for (const group of groups.values()) {
    const d = {
      sigOff: distribution(group.filter(x => x.evidence.sigOff > 0).map(x => x.sigOffRaw)),
      sigDef: distribution(group.filter(x => x.evidence.sigDef > 0).map(x => x.sigDefRaw)),
      tdOff: distribution(group.filter(x => x.evidence.tdOff > 0).map(x => x.tdOffRaw)),
      tdDef: distribution(group.filter(x => x.evidence.tdDef > 0).map(x => x.tdDefRaw)),
      grappling: distribution(group.filter(x => x.evidence.grappling > 0).map(x => x.grapplingRaw)),
      kdThreat: distribution(group.filter(x => x.evidence.kd > 0).map(x => x.kdThreatRaw)),
      subThreat: distribution(group.filter(x => x.evidence.sub > 0).map(x => x.subThreatRaw)),
      pace: distribution(group.map(x => x.paceRaw)),
      sos: distribution(group.map(x => x.sosRaw)),
      elo: distribution(group.map(x => x.eloRaw))
    };

    for (const row of group) {
      const rel = {
        strikingOffense: evidenceReliability(row.evidence.sigOff, 240),
        strikingDefense: evidenceReliability(row.evidence.sigDef, 240),
        wrestlingOffense: evidenceReliability(row.evidence.tdOff, 18),
        wrestlingDefense: evidenceReliability(row.evidence.tdDef, 18),
        grappling: evidenceReliability(row.evidence.grappling, 18),
        kdThreat: evidenceReliability(row.evidence.kd, 180),
        subThreat: evidenceReliability(row.evidence.sub, 18),
        pace: evidenceReliability(row.evidence.paceMinutes, 55),
        strengthOfSchedule: evidenceReliability(row.evidence.sosBouts, 6),
        resume: evidenceReliability(row.bouts, 8)
      };

      const sigOff = componentScore(row.sigOffRaw, d.sigOff, rel.strikingOffense);
      const sigDef = componentScore(row.sigDefRaw, d.sigDef, rel.strikingDefense);
      const tdOff = componentScore(row.tdOffRaw, d.tdOff, rel.wrestlingOffense);
      const tdDef = componentScore(row.tdDefRaw, d.tdDef, rel.wrestlingDefense);
      const grapple = componentScore(row.grapplingRaw, d.grappling, rel.grappling);
      const pace = componentScore(row.paceRaw, d.pace, rel.pace);
      const sos = componentScore(row.sosRaw, d.sos, rel.strengthOfSchedule);
      const resume = componentScore(row.eloRaw, d.elo, rel.resume);

      const kdRaw = row.evidence.kd > 0 ? scoreFrom(row.kdThreatRaw, d.kdThreat) : 50;
      const subRaw = row.evidence.sub > 0 ? scoreFrom(row.subThreatRaw, d.subThreat) : 50;
      const finishReliability = clamp(0.65 * rel.kdThreat + 0.35 * rel.subThreat, 0, 0.99);
      const finishingRawScore = 0.65 * kdRaw + 0.35 * subRaw;
      const finishing = shrinkScore(finishingRawScore, finishReliability);

      const technicalPerformance =
        TECHNICAL_WEIGHTS.strikingOffense * sigOff.rawScore
        + TECHNICAL_WEIGHTS.strikingDefense * sigDef.rawScore
        + TECHNICAL_WEIGHTS.wrestlingOffense * tdOff.rawScore
        + TECHNICAL_WEIGHTS.wrestlingDefense * tdDef.rawScore
        + TECHNICAL_WEIGHTS.grappling * grapple.rawScore
        + TECHNICAL_WEIGHTS.finishing * finishingRawScore;

      const technical =
        TECHNICAL_WEIGHTS.strikingOffense * sigOff.score
        + TECHNICAL_WEIGHTS.strikingDefense * sigDef.score
        + TECHNICAL_WEIGHTS.wrestlingOffense * tdOff.score
        + TECHNICAL_WEIGHTS.wrestlingDefense * tdDef.score
        + TECHNICAL_WEIGHTS.grappling * grapple.score
        + TECHNICAL_WEIGHTS.finishing * finishing;

      const relevantRecent = row.results.filter(x => x.weight > 0);
      const recentResidual = weightedMean(relevantRecent.map(x => [x.residual, x.weight]), 0);
      const recentEvidence = relevantRecent.reduce((sum, x) => sum + x.weight, 0);
      const recentReliability = evidenceReliability(recentEvidence, 2.75);
      const recentRawScore = clamp(50 + recentResidual * 55, 5, 99);
      const recentForm = shrinkScore(recentRawScore, recentReliability);

      const technicalReliability =
        TECHNICAL_WEIGHTS.strikingOffense * rel.strikingOffense
        + TECHNICAL_WEIGHTS.strikingDefense * rel.strikingDefense
        + TECHNICAL_WEIGHTS.wrestlingOffense * rel.wrestlingOffense
        + TECHNICAL_WEIGHTS.wrestlingDefense * rel.wrestlingDefense
        + TECHNICAL_WEIGHTS.grappling * rel.grappling
        + TECHNICAL_WEIGHTS.finishing * finishReliability;

      const cmrBase =
        CMR_WEIGHTS.technical * technical
        + CMR_WEIGHTS.resume * resume.score
        + CMR_WEIGHTS.strengthOfSchedule * sos.score
        + CMR_WEIGHTS.recentForm * recentForm;

      const performanceCmr =
        CMR_WEIGHTS.technical * technicalPerformance
        + CMR_WEIGHTS.resume * resume.rawScore
        + CMR_WEIGHTS.strengthOfSchedule * sos.rawScore
        + CMR_WEIGHTS.recentForm * recentRawScore;

      const confidence = 100 * clamp(
        CMR_WEIGHTS.technical * technicalReliability
        + CMR_WEIGHTS.resume * rel.resume
        + CMR_WEIGHTS.strengthOfSchedule * rel.strengthOfSchedule
        + CMR_WEIGHTS.recentForm * recentReliability,
        0,
        0.99
      );

      const transfer = row.transferScope && row.transferredBouts > 0 ? row.transferScope : null;
      const provisional = confidence < 55 || row.bouts < 3;

      ratings.push({
        ...row,
        strikingOffense: sigOff.score,
        strikingDefense: sigDef.score,
        wrestlingOffense: tdOff.score,
        wrestlingDefense: tdDef.score,
        grappling: grapple.score,
        pace: pace.score,
        finishing,
        strengthOfSchedule: sos.score,
        resume: resume.score,
        technical,
        recentForm,
        confidence,
        cmr: clamp(cmrBase, 5, 99),
        performanceCmr: clamp(performanceCmr, 5, 99),
        provisional,
        reliabilities: {
          strikingOffense: rel.strikingOffense,
          strikingDefense: rel.strikingDefense,
          wrestlingOffense: rel.wrestlingOffense,
          wrestlingDefense: rel.wrestlingDefense,
          grappling: rel.grappling,
          finishing: finishReliability,
          pace: rel.pace,
          strengthOfSchedule: rel.strengthOfSchedule,
          resume: rel.resume,
          recentForm: recentReliability,
          technical: technicalReliability
        },
        components: {
          version: CMR_V04_VERSION,
          opportunity_rule: 'No opportunity means no skill evidence; metric-specific evidence shrinks unknown skills toward 50.',
          td_offense_attempts_effective: Number(row.evidence.tdOff.toFixed(3)),
          td_defense_attempts_faced_effective: Number(row.evidence.tdDef.toFixed(3)),
          striking_offense_attempts_effective: Number(row.evidence.sigOff.toFixed(3)),
          striking_defense_attempts_faced_effective: Number(row.evidence.sigDef.toFixed(3)),
          grappling_units_effective: Number(row.evidence.grappling.toFixed(3)),
          own_pace_activity_raw: Number(row.paceRaw.toFixed(4)),
          cmr_base: Number(cmrBase.toFixed(6)),
          performance_cmr: Number(performanceCmr.toFixed(2)),
          ranked_cmr: Number(clamp(cmrBase, 5, 99).toFixed(2)),
          component_reliability: Object.fromEntries(Object.entries({
            striking_offense: rel.strikingOffense,
            striking_defense: rel.strikingDefense,
            wrestling_offense: rel.wrestlingOffense,
            wrestling_defense: rel.wrestlingDefense,
            grappling: rel.grappling,
            finishing: finishReliability,
            pace: rel.pace,
            strength_of_schedule: rel.strengthOfSchedule,
            resume: rel.resume,
            recent_form: recentReliability,
            technical: technicalReliability
          }).map(([k, v]) => [k, Number(v.toFixed(4))])),
          top_level_weights: CMR_WEIGHTS,
          technical_weights: TECHNICAL_WEIGHTS,
          sample_scope: transfer ? 'current_division_plus_previous_division_2y_discounted' : 'current_division_only',
          transfer_weight: transfer ? TRANSFER_WEIGHT : 0,
          current_division_bouts: row.currentDivisionBouts,
          current_division_minutes: Number(row.currentDivisionMinutes.toFixed(3)),
          transferred_bouts: row.transferredBouts,
          transferred_minutes: Number(row.transferredMinutes.toFixed(3)),
          previous_division: transfer?.previousDivision ?? null,
          current_division_debut: transfer?.currentDebutDate ?? null,
          transfer_cutoff: transfer?.cutoffDate ?? null,
          recent: relevantRecent
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 5)
            .map(x => ({
              date: x.date,
              result: x.won === 1 ? 'W' : x.won === 0 ? 'L' : 'D',
              expected_result: Number(x.expected.toFixed(3)),
              residual: Number(x.residual.toFixed(3)),
              weight: Number(x.weight.toFixed(3)),
              opponent_elo: Math.round(x.opponentElo),
              weight_class: x.weightClass,
              transferred: Boolean(x.transferred)
            }))
        }
      });
    }
  }

  return { ratings, sourceMaxDate };
}
