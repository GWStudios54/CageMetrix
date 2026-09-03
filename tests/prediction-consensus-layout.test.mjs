import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('prediction cards render model confidence and fan consensus as separate stacked signals',()=>{
  const js=readFileSync(new URL('../public/predictions.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/predictions.css',import.meta.url),'utf8');
  assert.match(js,/class="forecast-signals"/);
  assert.match(js,/class="forecast-signal model-confidence/);
  assert.match(js,/class="forecast-signal fan-consensus/);
  assert.match(css,/\.forecast-signals\{display:grid;gap:/);
});
