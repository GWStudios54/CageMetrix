import { displayName, parseClock, parseDate, parsePair } from './csv.mjs';
import { fighterIdentity, assertIdentityConsistency } from './identity.mjs';

const PRIOR_MINUTES = 45;
const EPS = 0.25;
const MS_PER_YEAR = 31557600000;

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

function isDecisive(row) {
  return row.fight_outcome === 'red_win' || row.fight_outcome === 'blue_win';
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
    const finish = isDecisive(r) && /^(KO\/TKO|TKO - Doctor's Stoppage|Submission)$/i.test(String(r.method || ''));
    const redIdentity = fighterIdentity(r, 'red');
    const blueIdentity = fighterIdentity(r, 'blue');
    const common = { index, eventDate, weightClass, durationSec, durationMin, finish, noContest: r.fight_outcome === 'no_contest', row: r };
    return {
      red: {
        ...common,
        identity: redIdentity, fighterId: redIdentity.id, opponentId: blueIdentity.id,
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
        identity: blueIdentity, fighterId: blueIdentity.id, opponentId: redIdentity.id,
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
  assertIdentityConsistency(pairs);
  return pairs;
}

export function careerAggregates(fightPairs) {
  const map = new Map();
  const add = obs => {
    let a = map.get(obs.fighterId);
    if (!a) {
      a = { fighterId: obs.fighterId, identity: obs.identity, name: obs.name, bouts: 0, minutes: 0, sigL: 0, sigAbs: 0, tdL: 0, tdAllowed: 0, lastFight: null, weightClass: obs.weightClass };
      map.set(obs.fighterId, a);
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
    const k = key(obs.fighterId, obs.weightClass);
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
    const a = pair.red.fighterId;
    const b = pair.blue.fighterId;
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
  for (const [name, observations] of byFighter) {
    const currentDivision = aggregates.get(name)?.weightClass;
    if (!currentDivision) continue;

    const ordered = observations
      .filter(obs => obs.eventDate)
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.index - b.index);
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

    scopes.set(name, {
      currentDivision,
      previousDivision,
      currentDebutDate,
      cutoffDate,
      lookbackYears
    });
  }
  return scopes;
}

export function buildRatings(fightPairs, aggs, options = {}) {
  // A historical caller must cut the entire dataset, including population and
  // opponent baselines, before aggregating. Never reuse a full-history aggregate.
  if (options.asOfDate) {
    fightPairs = fightPairs.filter(p => p.red.eventDate <= options.asOfDate);
  }
  aggs = careerAggregates(fightPairs);
  // Overturned bouts remain in raw history but cannot supply result/skill evidence.
  fightPairs = fightPairs.filter(p => !p.red.noContest);
  const priors = divisionPriors(fightPairs);
  const divisionAggs = divisionOpponentAggregates(fightPairs);
  const { current: elo, opponentPre } = computeElo(fightPairs);
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
        transferScope &&
        obs.weightClass === transferScope.previousDivision &&
        obs.eventDate &&
        obs.eventDate >= transferScope.cutoffDate &&
        obs.eventDate < transferScope.currentDebutDate
      );
      if (!isCurrentDivision && !isTransferred) continue;

      const oppAgg = divisionAggs.get(key(obs.opponentId, obs.weightClass));
      const prior = priors.get(obs.weightClass);
      if (!oppAgg || !prior) continue;

      const years = obs.eventDate ? Math.max(0, (maxDate - new Date(`${obs.eventDate}T00:00:00Z`)) / MS_PER_YEAR) : 10;
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
          sigOff: [], sigDef: [], tdOff: [], tdDef: [], grappling: [], pace: [], finishing: [], sos: [], results: []
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
      p.sigOff.push([sigOff, w]);
      p.sigDef.push([sigDef, w]);
      p.tdOff.push([tdOff, w]);
      p.tdDef.push([tdDef, w]);
      p.grappling.push([grappling, w]);
      p.pace.push([pace, w]);
      p.finishing.push([finishing, w]);
      p.sos.push([opponentElo, w]);
      p.results.push({ date: obs.eventDate, won: obs.won, opponentElo, weightClass: obs.weightClass, transferred: isTransferred });
      perf.set(obs.fighterId, p);
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

      const rankingReliability = clamp(0.42 * (1 - Math.exp(-row.minutes / 45)) + 0.58 * (1 - Math.exp(-row.bouts / 5)), 0.08, 0.99);
      const confidence = rankingReliability * 100;
      const performanceBase = 0.56 * technicalPerformance + 0.24 * raw.resume + 0.10 * raw.strengthOfSchedule + 0.10 * recentUnshrunk;
      const performanceCmr = calibrateCmr(performanceBase);
      const rankedBase = 0.56 * technical + 0.24 * resume + 0.10 * strengthOfSchedule + 0.10 * recentForm;
      const uncertaintyPenalty = (1 - rankingReliability) * 3 + Math.max(0, 5 - row.bouts) * 3;
      const cmr = clamp(50 + (performanceCmr - 50) * (0.25 + 0.75 * rankingReliability) - uncertaintyPenalty, 5, 99);
      const provisional = row.bouts < 5 || rankingReliability < 0.55;
      const transfer = row.transferScope && row.transferredBouts > 0 ? row.transferScope : null;

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
          sample_reliability: Number(rankingReliability.toFixed(4)),
          evidence_label: 'Sample strength',
          confidence_note: 'Bout-count and cage-time exposure index; not an accuracy probability or statistical confidence interval.',
          uncertainty_penalty: Number(uncertaintyPenalty.toFixed(2)),
          sample_scope: transfer ? 'current_division_plus_previous_division_2y' : 'current_division_only',
          current_division_bouts: row.currentDivisionBouts,
          current_division_minutes: Number(row.currentDivisionMinutes.toFixed(3)),
          transferred_bouts: row.transferredBouts,
          transferred_minutes: Number(row.transferredMinutes.toFixed(3)),
          previous_division: transfer?.previousDivision ?? null,
          current_division_debut: transfer?.currentDebutDate ?? null,
          transfer_cutoff: transfer?.cutoffDate ?? null,
          transfer_lookback_years: transfer?.lookbackYears ?? 0,
          recent: recent.map(x => ({
            date: x.date,
            result: x.won === 1 ? 'W' : x.won === 0 ? 'L' : 'D',
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
