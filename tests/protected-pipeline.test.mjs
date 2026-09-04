import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FORECAST_NAME,FORECAST_VERSION} from '../scripts/lib/forecast.mjs';
import {
  PREDICTOR_V02_VERSION,
  PREDICTOR_V02_WEIGHTS,
  PREDICTOR_V02_SCALES,
  PREDICTOR_V02_PRIOR_OPTIONS,
  PREDICTOR_V02_BENCHMARK
} from '../scripts/lib/predictor_v02.mjs';

// These cores are intentionally unchanged by the 0.3.1 / 0.2 promotion:
// Predictor 0.1 remains reproducible for historical predictions, CMR's UFC
// technical engine remains stable, and the official live-results grader is
// independent of model promotion.
const expected={
  "scripts/lib/predictor_v01.mjs": "04faae917a45f70de78519c2b554ba85e81d03f98e25f62de05e132490a8836e",
  "scripts/lib/model_v03.mjs": "2ec735fd80fae1a762ff10faa06dd1b4710bf489fd81d2f27750cfd008478d76",
  "src/live-results.ts": "27358ea08e1391e284b8c361829947cd53d8bf81ba4e10e08144f229defdd4eb"
};

test('model promotion preserves legacy/result cores and pins the new production contract',()=>{
  for(const [path,hash] of Object.entries(expected)){
    const source=readFileSync(new URL('../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n');
    assert.equal(createHash('sha256').update(source).digest('hex'),hash,path);
  }
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.deepEqual(config.triggers.crons,['*/2 * * * *']);
  assert.equal(config.vars.MODEL_VERSION,'0.3.1');
  assert.equal(FORECAST_NAME,'CageMetrix Win Probability');
  assert.equal(FORECAST_VERSION,'0.2.0');
  assert.equal(PREDICTOR_V02_VERSION,'0.2.0');
  assert.equal(PREDICTOR_V02_WEIGHTS.length,33);
  assert.equal(PREDICTOR_V02_SCALES.length,33);
  assert.deepEqual(PREDICTOR_V02_PRIOR_OPTIONS,{maxWeight:0.65,decayBouts:4});
  assert.equal(PREDICTOR_V02_BENCHMARK.common_holdout.bouts,1446);
  assert.ok(PREDICTOR_V02_BENCHMARK.common_holdout.log_loss < PREDICTOR_V02_BENCHMARK.common_holdout.predictor_v01_log_loss);
});
