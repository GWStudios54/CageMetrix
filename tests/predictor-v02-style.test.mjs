import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_NAMES, featureVector } from '../scripts/lib/predictor_v02.mjs';

const fighter = overrides => ({
  eloRaw: 1550, cmr: 55, technical: 56, resume: 54,
  strikingOffense: 57, strikingDefense: 53, wrestlingOffense: 52, wrestlingDefense: 58,
  grappling: 51, finishing: 54, pace: 60, strengthOfSchedule: 55, recentForm: 57,
  confidence: 70, bouts: 8, minutes: 85,
  reliabilities: { strikingOffense: .8, strikingDefense: .8, wrestlingOffense: .6, wrestlingDefense: .7, grappling: .5, technical: .7, resume: .7 },
  ...overrides
});
const style = overrides => ({ sigAttemptsPerMin: 9, tdAttemptsPer15: 2.5, subAttemptsPer15: .6, reliability: .8, weightedMinutes: 70, ...overrides });

test('Predictor 0.2 style vector is antisymmetric when fighters swap', () => {
  const a=fighter({cmr:61,strikingOffense:63,wrestlingOffense:59}), b=fighter({eloRaw:1490,cmr:49,strikingDefense:61,wrestlingDefense:48});
  const sa=style({sigAttemptsPerMin:11,tdAttemptsPer15:4.2}), sb=style({sigAttemptsPerMin:7,tdAttemptsPer15:.8,subAttemptsPer15:.1});
  const ab=featureVector(a,b,sa,sb), ba=featureVector(b,a,sb,sa);
  assert.equal(ab.length,FEATURE_NAMES.length);
  assert.deepEqual(ba.map(v=>Math.abs(v)<1e-12?0:Number(v.toFixed(12))),ab.map(v=>Math.abs(v)<1e-12?0:Number((-v).toFixed(12))));
});

test('explicit takedown pressure is separate from wrestling skill', () => {
  const a=fighter({wrestlingOffense:65}),b=fighter({wrestlingOffense:65});
  const x=featureVector(a,b,style({tdAttemptsPer15:6}),style({tdAttemptsPer15:0}));
  assert.equal(x[FEATURE_NAMES.indexOf('wrestling_offense_diff')],0);
  assert.ok(x[FEATURE_NAMES.indexOf('td_attempt_rate_diff')]>0);
  assert.ok(x[FEATURE_NAMES.indexOf('takedown_pressure_vs_defense')]>0);
});

test('opponent activity does not become a fighter style feature', () => {
  const x=featureVector(fighter({}),fighter({}),style({sigAttemptsPerMin:4,tdAttemptsPer15:0}),style({sigAttemptsPerMin:14,tdAttemptsPer15:7}));
  assert.ok(x[FEATURE_NAMES.indexOf('sig_attempt_rate_diff')]<0);
  assert.ok(x[FEATURE_NAMES.indexOf('td_attempt_rate_diff')]<0);
});
