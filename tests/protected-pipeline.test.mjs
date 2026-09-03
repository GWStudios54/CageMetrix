import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Baseline: main 02820a7. A fight-detail change must not alter the model or result pipeline.
const expected={
  "scripts/lib/predictor_v01.mjs": "04faae917a45f70de78519c2b554ba85e81d03f98e25f62de05e132490a8836e",
  "scripts/lib/forecast.mjs": "6311b0d47886d340d30637339b3f166cf22438a5b2d4b3aaf6923a9994ef2a93",
  "scripts/lib/model_v03.mjs": "2ec735fd80fae1a762ff10faa06dd1b4710bf489fd81d2f27750cfd008478d76",
  "src/live-results.ts": "27358ea08e1391e284b8c361829947cd53d8bf81ba4e10e08144f229defdd4eb"
};
test('fight details leave Predictor 0.1, CMR and official result pipeline unchanged',()=>{
 for(const [path,hash] of Object.entries(expected)){
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(source).digest('hex'),hash,path);
 }
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.deepEqual(config.triggers.crons,['*/2 * * * *']);
});
