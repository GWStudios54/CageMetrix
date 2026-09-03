import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_NAMES, featureVector } from '../scripts/lib/predictor_v02.mjs';

const fighter = overrides => ({
  eloRaw: 1550,
  cmr: 55,
  technical: 56,
  resume: 54,
  strikingOffense: 57,
  strikingDefense: 53,
  wrestlingOffense: 52,
  wrestlingDefense: 58,
  grappling: 51,
  finishing: 54,
  pace: 60,
  strengthOfSchedule: 55,
  recentForm: 57,
  confidence: 70,
  bouts: 8,
  minutes: 85,
  reliabilities: {
    strikingOffense: 0.8,
    strikingDefense: 0.8,
    wrestlingOffense: 0.6,
    wrestlingDefense: 0.7,
    grappling: 0.5,
    technical: 0.7,
    resume: 0.7
  },
  ...overrides
});

const style = overrides => ({
  sigAttemptsPerMin: 9,
  tdAttemptsPer15: 2.5,
  controlShare: 0.18,
  subAttemptsPer15: 0.6,
  reliability: 0.8,
  weightedMinutes: 70,
  ...overrides
});

test('Predictor 0.2 style vector is antisymmetric when fighters swap', () => {
  const a = fighter({ cmr: 61, strikingOffense: 63, wrestlingOffense: 59 });
  const b = fighter({ eloRaw: 1490, cmr: 49, strikingDefense: 61, wrestlingDefense: 48 });
  const sa = style({ sigAttemptsPerMin: 11, tdAttemptsPer15: 4.2 });
  const sb = style({ sigAttemptsPerMin: 7, tdAttemptsPer15: 0.8, controlShare: 0.05 });
  const ab = featureVector(a, b, sa, sb);
  const ba = featureVector(b, a, sb, sa);
  assert.equal(ab.length, FEATURE_NAMES.length);
  assert.deepEqual(ba.map(v => Math.abs(v) < 1e-12 ? 0 : Number(v.toFixed(12))), ab.map(v => Math.abs(v) < 1e-12 ? 0 : Number((-v).toFixed(12))));
});

test('explicit takedown pressure is separate from wrestling skill', () => {
  const a = fighter({ wrestlingOffense: 65 });
  const b = fighter({ wrestlingOffense: 65 });
  const low = style({ tdAttemptsPer15: 0 });
  const high = style({ tdAttemptsPer15: 6 });
  const x = featureVector(a, b, high, low);
  assert.equal(x[FEATURE_NAMES.indexOf('wrestling_offense_diff')], 0);
  assert.ok(x[FEATURE_NAMES.indexOf('td_attempt_rate_diff')] > 0);
  assert.ok(x[FEATURE_NAMES.indexOf('takedown_pressure_vs_defense')] > 0);
});

test('opponent activity does not become a fighter style feature', () => {
  const a = fighter({});
  const b = fighter({});
  const quietA = style({ sigAttemptsPerMin: 4, tdAttemptsPer15: 0 });
  const busyB = style({ sigAttemptsPerMin: 14, tdAttemptsPer15: 7 });
  const x = featureVector(a, b, quietA, busyB);
  assert.ok(x[FEATURE_NAMES.indexOf('sig_attempt_rate_diff')] < 0);
  assert.ok(x[FEATURE_NAMES.indexOf('td_attempt_rate_diff')] < 0);
});
