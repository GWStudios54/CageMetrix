import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_NAMES, featureVector, fitLogistic, predict } from '../scripts/lib/predictor_v01.mjs';

function rating(overrides = {}) {
  return {
    eloRaw: 1500, cmr: 50, technical: 50, resume: 50,
    strikingOffense: 50, strikingDefense: 50,
    wrestlingOffense: 50, wrestlingDefense: 50,
    grappling: 50, pace: 50, finishing: 50,
    strengthOfSchedule: 50, recentForm: 50, confidence: 70,
    bouts: 6, minutes: 70,
    ...overrides
  };
}

test('feature vector is anti-symmetric when fighters are swapped', () => {
  const a = rating({ eloRaw: 1610, cmr: 63, strikingOffense: 72, wrestlingDefense: 68, bouts: 9 });
  const b = rating({ eloRaw: 1480, cmr: 54, strikingDefense: 61, wrestlingOffense: 66, bouts: 4 });
  const ab = featureVector(a, b);
  const ba = featureVector(b, a);
  assert.equal(ab.length, FEATURE_NAMES.length);
  for (let i = 0; i < ab.length; i++) assert.ok(Math.abs(ab[i] + ba[i]) < 1e-9, FEATURE_NAMES[i]);
});

test('fitted probabilities remain symmetric', () => {
  const strong = rating({ eloRaw: 1650, cmr: 67, technical: 64, strikingOffense: 70, wrestlingOffense: 65 });
  const weak = rating({ eloRaw: 1450, cmr: 45, technical: 46, strikingDefense: 44, wrestlingDefense: 43 });
  const x = featureVector(strong, weak);
  const rows = [
    { x, won: 1 },
    { x: x.map(v => v * 0.7), won: 1 },
    { x: x.map(v => v * 0.4), won: 1 }
  ];
  const model = fitLogistic(rows, { lambda: 0.1, iterations: 150 });
  const p = predict(model, x);
  const reverse = predict(model, x.map(v => -v));
  assert.ok(p > 0.5 && p < 1);
  assert.ok(Math.abs((p + reverse) - 1) < 1e-10);
});
