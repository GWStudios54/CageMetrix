import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_NAMES, featureVector, predictFrozenVector, predictMatchup } from '../scripts/lib/predictor_v01.mjs';
import { FORECAST_NAME, FORECAST_VERSION, forecast } from '../scripts/lib/forecast.mjs';

function rating(overrides = {}) {
  return {
    name: 'Example Fighter',
    eloRaw: 1500, cmr: 50, technical: 50, resume: 50,
    strikingOffense: 50, strikingDefense: 50,
    wrestlingOffense: 50, wrestlingDefense: 50,
    grappling: 50, pace: 50, finishing: 50,
    strengthOfSchedule: 50, recentForm: 50, confidence: 70,
    bouts: 6, minutes: 70,
    ...overrides
  };
}

test('Predictor 0.1 production identity stays on the public forecast key', () => {
  assert.equal(FORECAST_NAME, 'CageMetrix Win Probability');
  assert.equal(FORECAST_VERSION, '0.1.0');
});

test('feature vector and frozen probability are symmetric when fighters swap', () => {
  const a = rating({ eloRaw: 1610, cmr: 63, strikingOffense: 72, wrestlingDefense: 68, bouts: 9 });
  const b = rating({ eloRaw: 1480, cmr: 54, strikingDefense: 61, wrestlingOffense: 66, bouts: 4 });
  const ab = featureVector(a, b);
  const ba = featureVector(b, a);
  assert.equal(ab.length, FEATURE_NAMES.length);
  for (let i = 0; i < ab.length; i++) assert.ok(Math.abs(ab[i] + ba[i]) < 1e-9, FEATURE_NAMES[i]);
  const p = predictFrozenVector(ab);
  const reverse = predictFrozenVector(ba);
  assert.ok(Math.abs((p + reverse) - 1) < 1e-10);
});

test('frozen coefficients reproduce the validated Predictor 0.1 holdout probability', () => {
  const x = [-12.91679927936184,1.5655783684974551,0.13154959890941598,-1.6310763993490127,-13.028007325754288,20.287416293066748,-4.678438074128479,2.7490810972709028,6.2216219965648065,-17.159190321902592,1.851379540228642,1.3960600560491088,-3.092258301246673,17.138617053186145,0.4054651081081643,0.6613984822453651,4.33107632693827,-0.8839873450085527,4.430177012412056,6.368148049205878,2.014076985355949,-0.7634573929760933,8.845626424075759,-2.710210522406782];
  assert.ok(Math.abs(predictFrozenVector(x) - 0.5108549846086381) < 1e-12);
});

test('rated fighters use Predictor 0.1 with auditable matchup drivers', () => {
  const a = rating({ name:'Alpha', eloRaw:1630, cmr:64, strikingOffense:69, wrestlingOffense:63, recentForm:61 });
  const b = rating({ name:'Bravo', eloRaw:1510, cmr:56, strikingDefense:60, wrestlingDefense:58, recentForm:53 });
  const raw = predictMatchup(a,b);
  const result = forecast(a,b,{a:'Alpha',b:'Bravo'});
  assert.equal(result.modelUsed, 'predictor_v01');
  assert.ok(Math.abs(result.probabilityA - raw.probabilityA) < 1e-12);
  assert.ok(result.drivers.length > 0);
  assert.match(result.notes, /Main model edges:/);
});

test('an unrated UFC debutant uses the documented Elo fallback', () => {
  const veteran = rating({ eloRaw:1600, bouts:8, confidence:80 });
  const result = forecast(veteran, null, {a:'Veteran',b:'Debutant'});
  assert.equal(result.modelUsed, 'elo_fallback');
  assert.equal(result.limitedHistory, true);
  assert.match(result.notes, /neutral-start Elo fallback/);
});
