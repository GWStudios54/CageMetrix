import { displayName, parseClock, parseDate, parsePair } from './csv.mjs';

const PRIOR_MINUTES = 45;
const EPS = 0.25;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const key = (name, division) => `${name}::${division}`;

function weightedMean(items) {
  let sum = 0;
  let weight = 0;
  for (const [value, w] of items) {
    if (!Number.isFinite(value) || !Number.isFinite(w) || w <= 0) continue;
    sum += value * w;
    weight += w;
  }
  return weight ? sum / weight : 0;
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

function shrinkScore(score, reliability, center = 50) {
  return center + (score - center) * reliability;
}

function calibrateCmr(score) {
  return clamp(50 + 1.45 * (score - 50), 5, 99);
}

function sampleReliability(minutes, bouts) {
  const minuteRel = 1 - Math.exp(-Math.max(0, minutes) / 55);
  const boutRel = 1 - Math.exp(-Math.max(0, bouts) / 6);
  return clamp(0.62 * minuteRel + 0.38 * boutRel, 0.08, 0.985);
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

function isDecisive(row) {
  return row.fight_outcome === 'red_win' || row.fight_outcome === 'blue_win';
}

export function buildObservations(rows) {
  return rows.map((r, index) => {
    const durationSec = fightDurationSeconds(r);
    const durationMin = durationSec / 60;
    const [rSigL, rSigA] = parsePair(r.red_fighter_sig_str);
    const [bSigL, bSigA] = parsePair(r.blue_fighter_sig_str);
    const [rTdL, rTdA] = parsePair(r.red_fighter_TD);
    const [bTdL, bTdA] = parsePair(r.blue_fighter_TD);
    const eventDate = parseDate(r.event_date);
    const weightClass = canonicalWeightClass(r.bout_type);
    const finish = !String(r.method || '').toLowerCase().includes('decision');
    const common = { index, eventDate, weightClass, durationSec, durationMin, finish, row: r };
    return {
      red: {
        ...common,
        side: 'red', name: displayName(r.red_fighter_name), opponent: displayName(r.blue_fighter_name),
        won: r.fight_outcome === 'red_win' ? 1 : r.fight_outcome === 'blue_win' ? 0 : 0.5,
        sigL: rSigL, sigA: rSigA, sigAbs: bSigL, sigAbsA: bSigA,
        tdL: rTdL, tdA: rTdA, tdAllowed: bTdL, tdFaced: bTdA,
        sub: Number(r.red_fighter_sub_att) || 0,
        kd: Number(r.red_fighter_KD) || 0,
        ctrlSec: parseClock(r.red_fighter_ctrl)
      },
      blue: {
        ...common,
        side: 'blue', name: displayName(r.blue_fighter_name), opponent: displayName(r.red_fighter_name),
        won: r.fight_outcome === 'blue_win' ? 1 : r.fight_outcome === 'red_win' ? 0 : 0.5,
        sigL: bSigL, sigA: bSigA, sigAbs: rSigL, sigAbsA: rSigA,
        tdL: bTdL, tdA: bTdA, tdAllowed: rTdL, tdFaced: rTdA,
        sub: Number(r.blue_fighter_sub_att) || 0,
        kd: Number(r.blue_fighter_KD) || 0,
        ctrlSec: parseClock(r.blue_fighter_ctrl)
      }
    };
  });
}

export function careerAggregates(fightPairs) {
  const map = new Map();
  const add = obs => {
    let a = map.get(obs.name);
    if (!a) {
      a = { name: obs.name, bouts: 0, minutes: 0, sigL: 0, sigAbs: 0, tdL: 0, tdAllowed: 0, lastFight: null, weightClass: obs.weightClass };
      map.set(obs.name, a);
    }
    a.bouts += 1;
    a.minutes += obs.durationMin;
    a.sigL += obs.sigL;
    a.sigAbs += obs.sigAbs;
    a.tdL += obs.tdL;
    a.tdAllowed += obs.tdAllowed;
    if (!a.lastFight || (obs.eventDate && obs.eventDate > a.lastFight)) {
      a.lastFight = obs.eventDate;
      a.weightClass = obs.weightClass;
    }
  };
  for (const { red, blue } of fightPairs) { add(red); add(blue); }
  return map;
}

function divisionOpponentAggregates(fightPairs) {
  const map = new Map();
  const add = obs => {
    const k = key(obs.name, obs.weightClass);
    let a = map.get(k);
    if (!a) a = { minutes: 0, sigL: 0, sigAbs: 0, tdL: 0, tdAllowed: 0 };
    a.minutes += obs.durationMin;
    a.sigL += obs.sigL;
    a.sigAbs += obs.sigAbs;
    a.tdL += obs.tdL;
    a.tdAllowed += obs.tdAllowed;
    map.set(k, a);
  };
  for (const { red, blue } of fightPairs) { add(red); add(blue); }
  return map;
}

function divisionPriors(fightPairs) {
  const by = new Map();
  const add = obs => {
    const d = by.get(obs.weightClass) || { minutes: 0, sigL: 0, sigAbs: 0, tdL: 0, tdAllowed: 0 };
    d.minutes += obs.durationMin;
    d.sigL += obs.sigL;
    d.sigAbs += obs.sigAbs;
    d.tdL += obs.tdL;
    d.tdAllowed += obs.tdAllowed;
    by.set(obs.weightClass, d);
  };
  for (const { red, blue } of fightPairs) { add(red); add(blue); }
  for (const [division, d] of by) {
    const m = Math.max(1, d.minutes);
    by.set(division, {
      sigProd: d.sigL / m,
      sigAllow: d.sigAbs / m,
      tdProd: d.tdL / m * 15,
      tdAllow: d.tdAllowed / m * 15
    });
  }
  return by;
}

function expectedAgainst(opponentAgg, obs, prior, kind) {
  const remaining = Math.max(0, opponentAgg.minutes - obs.durationMin);
  if (kind === 'sig_allow') return ((opponentAgg.sigAbs - obs.sigL) + prior.sigAllow * PRIOR_MINUTES) / (remaining + PRIOR_MINUTES);
  if (kind === 'sig_prod') return ((opponentAgg.sigL - obs.sigAbs) + prior.sigProd * PRIOR_MINUTES) / (remaining + PRIOR_MINUTES);
  if (kind === 'td_allow') return ((opponentAgg.tdAllowed - obs.tdL) + prior.tdAllow * PRIOR_MINUTES / 15) / ((remaining + PRIOR_MINUTES) / 15);
  if (kind === 'td_prod') return ((opponentAgg.tdL - obs.tdAllowed) + prior.tdProd * PRIOR_MINUTES / 15) / ((remaining + PRIOR_MINUTES) / 15);
  return 0;
}

function computeElo(fightPairs) {
  const current = new Map();
  const opponentPre = new Map();
  const ordered = [...fightPairs].filter(p => p.red.eventDate).sort((a, b) => a.red.eventDate.localeCompare(b.red.eventDate) || a.red.index - b.red.index);
  for (const pair of ordered) {
    const a = pair.red.name;
    const b = pair.blue.name;
    const ra = current.get(a) ?? 1500;
    const rb = current.get(b) ?? 1500;
    opponentPre.set(`${pair.red.index}:red`, rb);
    opponentPre.set(`${pair.blue.index}:blue`, ra);
    if (!isDecisive(pair.red.row)) continue;
    const expectedA = 1 / (1 + 10 ** ((rb - ra) / 400));
    const kFactor = 28 * (pair.red.finish ? 1.15 : 1);
    current.set(a, ra + kFactor * (pair.red.won - expectedA));
    current.set(b, rb + kFactor * ((1 - pair.red.won) - (1 - expectedA)));
  }
  return { current, opponentPre };
}

export function buildRatings(fightPairs, aggs) {
  const priors = divisionPriors(fightPairs);
  const divisionAggs = divisionOpponentAggregates(fightPairs);
  const { current: elo, opponentPre } = computeElo(fightPairs);
  const sourceMaxDate = fightPairs.map(p => p.red.eventDate).filter(Boolean).sort().at(-1);
  const maxDate = sourceMaxDate ? new Date(`${sourceMaxDate}T00:00:00Z`) : new Date();
  const perf = new Map();

  for (const pair of fightPairs) {
    for (const obs of [pair.red, pair.blue]) {
      const fighterCareer = aggs.get(obs.name);
      if (!fighterCareer || obs.weightClass !== fighterCareer.weightClass) continue;
      const oppAgg = divisionAggs.get(key(obs.opponent, obs.weightClass));
      const prior = priors.get(obs.weightClass);
      if (!oppAgg || !prior) continue;

      const years = obs.eventDate ? Math.max(0, (maxDate - new Date(`${obs.eventDate}T00:00:00Z`)) / 31557600000) : 10;
      const recency = Math.exp(-years / 3.5);
      const sampleWeight = clamp(Math.sqrt(obs.durationMin / 15), 0.35, 1.4);
      const opponentElo = opponentPre.get(`${obs.index}:${obs.side}`) ?? 1500;
      const qualityWeight = clamp(0.75 + (opponentElo - 1300) / 800, 0.65, 1.35);
      const w = recency * sampleWeight * qualityWeight;

      const sigLpm = obs.sigL / obs.durationMin;
      const oppSigLpm = obs.sigAbs / obs.durationMin;
      const td15 = obs.tdL / obs.durationMin * 15;
      const oppTd15 = obs.tdAllowed / obs.durationMin * 15;
      const sigOff = Math.log((sigLpm + EPS) / (expectedAgainst(oppAgg, obs, prior, 'sig_allow') + EPS));
      const sigDef = Math.log((expectedAgainst(oppAgg, obs, prior, 'sig_prod') + EPS) / (oppSigLpm + EPS));
      const tdOff = Math.log((td15 + EPS) / (expectedAgainst(oppAgg, obs, prior, 'td_allow') + EPS));
      const tdDef = Math.log((expectedAgainst(oppAgg, obs, prior, 'td_prod') + EPS) / (oppTd15 + EPS));
      const grappling = obs.sub / obs.durationMin * 15 + 2.2 * (obs.ctrlSec / obs.durationSec);
      const pace = (obs.sigA + obs.sigAbsA) / obs.durationMin + 0.5 * (obs.tdA + obs.tdFaced) / obs.durationMin * 15;
      const finishing = obs.kd / obs.durationMin * 15 + obs.sub / obs.durationMin * 15 + (obs.won === 1 && obs.finish ? 0.6 : 0);

      let p = perf.get(obs.name);
      if (!p) p = { name: obs.name, weightClass: obs.weightClass, lastFight: obs.eventDate, bouts: 0, minutes: 0, sigOff: [], sigDef: [], tdOff: [], tdDef: [], grappling: [], pace: [], finishing: [], sos: [], results: [] };
      p.bouts += 1;
      p.minutes += obs.durationMin;
      p.sigOff.push([sigOff, w]);
      p.sigDef.push([sigDef, w]);
      p.tdOff.push([tdOff, w]);
      p.tdDef.push([tdDef, w]);
      p.grappling.push([grappling, w]);
      p.pace.push([pace, w]);
      p.finishing.push([finishing, w]);
      p.sos.push([opponentElo, w]);
      p.results.push({ date: obs.eventDate, won: obs.won, opponentElo });
      if (!p.lastFight || (obs.eventDate && obs.eventDate > p.lastFight)) p.lastFight = obs.eventDate;
      perf.set(obs.name, p);
    }
  }

  const rows = [...perf.values()].map(p => ({
    ...p,
    sigOffRaw: weightedMean(p.sigOff),
    sigDefRaw: weightedMean(p.sigDef),
    tdOffRaw: weightedMean(p.tdOff),
    tdDefRaw: weightedMean(p.tdDef),
    grapplingRaw: weightedMean(p.grappling),
    paceRaw: weightedMean(p.pace),
    finishingRaw: weightedMean(p.finishing),
    sosRaw: weightedMean(p.sos),
    eloRaw: elo.get(p.name) ?? 1500
  }));

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.weightClass)) groups.set(row.weightClass, []);
    groups.get(row.weightClass).push(row);
  }

  const ratings = [];
  for (const group of groups.values()) {
    const d = {
      sigOff: distribution(group.map(x => x.sigOffRaw)),
      sigDef: distribution(group.map(x => x.sigDefRaw)),
      tdOff: distribution(group.map(x => x.tdOffRaw)),
      tdDef: distribution(group.map(x => x.tdDefRaw)),
      grappling: distribution(group.map(x => x.grapplingRaw)),
      pace: distribution(group.map(x => x.paceRaw)),
      finishing: distribution(group.map(x => x.finishingRaw)),
      sos: distribution(group.map(x => x.sosRaw)),
      elo: distribution(group.map(x => x.eloRaw))
    };

    for (const row of group) {
      const raw = {
        strikingOffense: scoreFrom(row.sigOffRaw, d.sigOff),
        strikingDefense: scoreFrom(row.sigDefRaw, d.sigDef),
        wrestlingOffense: scoreFrom(row.tdOffRaw, d.tdOff),
        wrestlingDefense: scoreFrom(row.tdDefRaw, d.tdDef),
        grappling: scoreFrom(row.grapplingRaw, d.grappling),
        pace: scoreFrom(row.paceRaw, d.pace),
        finishing: scoreFrom(row.finishingRaw, d.finishing),
        strengthOfSchedule: scoreFrom(row.sosRaw, d.sos),
        resume: scoreFrom(row.eloRaw, d.elo)
      };

      const reliability = sampleReliability(row.minutes, row.bouts);
      const resumeReliability = clamp(0.25 + 0.75 * (1 - Math.exp(-row.bouts / 9)), 0.25, 0.99);
      const strikingOffense = shrinkScore(raw.strikingOffense, reliability);
      const strikingDefense = shrinkScore(raw.strikingDefense, reliability);
      const wrestlingOffense = shrinkScore(raw.wrestlingOffense, reliability);
      const wrestlingDefense = shrinkScore(raw.wrestlingDefense, reliability);
      const grappling = shrinkScore(raw.grappling, reliability);
      const pace = shrinkScore(raw.pace, reliability);
      const finishing = shrinkScore(raw.finishing, reliability);
      const strengthOfSchedule = shrinkScore(raw.strengthOfSchedule, resumeReliability);
      const resume = shrinkScore(raw.resume, resumeReliability);

      const technicalPerformance = 0.30 * raw.strikingOffense + 0.22 * raw.strikingDefense + 0.16 * raw.wrestlingOffense + 0.16 * raw.wrestlingDefense + 0.08 * raw.grappling + 0.04 * raw.pace + 0.04 * raw.finishing;
      const technical = 0.30 * strikingOffense + 0.22 * strikingDefense + 0.16 * wrestlingOffense + 0.16 * wrestlingDefense + 0.08 * grappling + 0.04 * pace + 0.04 * finishing;

      const recent = [...row.results].filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
      const recentRaw = weightedMean(recent.map((x, i) => [(x.won - 0.5) * (0.85 + (x.opponentElo - 1300) / 700), 1 / (1 + i * 0.35)]));
      const recentUnshrunk = clamp(50 + recentRaw * 38, 5, 99);
      const recentReliability = clamp(recent.length / 5, 0.2, 1);
      const recentForm = shrinkScore(recentUnshrunk, recentReliability);

      const confidence = clamp(reliability * 100, 5, 99);
      const performanceBase = 0.56 * technicalPerformance + 0.24 * raw.resume + 0.10 * raw.strengthOfSchedule + 0.10 * recentUnshrunk;
      const performanceCmr = calibrateCmr(performanceBase);
      const rankedBase = 0.56 * technical + 0.24 * resume + 0.10 * strengthOfSchedule + 0.10 * recentForm;
      const uncertaintyPenalty = (1 - reliability) * 6.5;
      const cmr = calibrateCmr(rankedBase - uncertaintyPenalty);
      const provisional = row.bouts < 5 || row.minutes < 45 || confidence < 60;

      ratings.push({
        ...row,
        strikingOffense,
        strikingDefense,
        wrestlingOffense,
        wrestlingDefense,
        grappling,
        pace,
        finishing,
        strengthOfSchedule,
        resume,
        technical,
        recentForm,
        confidence,
        cmr,
        performanceCmr,
        provisional,
        components: {
          sig_offense_vs_expected: Number(Math.exp(row.sigOffRaw).toFixed(3)),
          sig_defense_vs_expected: Number(Math.exp(row.sigDefRaw).toFixed(3)),
          td_offense_vs_expected: Number(Math.exp(row.tdOffRaw).toFixed(3)),
          td_defense_vs_expected: Number(Math.exp(row.tdDefRaw).toFixed(3)),
          elo: Number(row.eloRaw.toFixed(1)),
          performance_cmr: Number(performanceCmr.toFixed(2)),
          ranked_cmr: Number(cmr.toFixed(2)),
          provisional,
          sample_reliability: Number(reliability.toFixed(4)),
          uncertainty_penalty: Number(uncertaintyPenalty.toFixed(2)),
          sample_scope: 'current_division_only',
          recent: recent.map(x => ({ date: x.date, result: x.won === 1 ? 'W' : x.won === 0 ? 'L' : 'D', opponent_elo: Math.round(x.opponentElo) }))
        }
      });
    }
  }

  return { ratings, sourceMaxDate };
}
