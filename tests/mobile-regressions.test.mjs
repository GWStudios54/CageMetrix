import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('featured UFC card uses dedicated mobile-safe layout and readable CTA',()=>{
  const seo=read('src/static-seo.ts');
  assert.match(seo,/class=\"event-spotlight\"/);
  assert.match(seo,/class=\"button primary\"/);
  assert.match(seo,/@media\(max-width:760px\)\{\.event-spotlight\{display:grid\}\.event-spotlight \.button\{width:100%;text-align:center\}/);
  assert.doesNotMatch(seo,/class=\"status-panel\" aria-label=\"Featured upcoming UFC predictions\"/);
  assert.doesNotMatch(seo,/class=\"status-dot\"/);
});

test('fan comparison follows the preferred current public predictor instead of pinning 0.1',()=>{
  const api=read('src/fans.ts');
  const ui=read('public/fans.js');
  assert.doesNotMatch(api,/PUBLIC_VERSION='0\.1\.0'/);
  assert.match(api,/WHEN '0\.2\.1' THEN 0 WHEN '0\.2\.0' THEN 1 WHEN '0\.1\.0' THEN 2/);
  assert.match(api,/mv\.version model_version/);
  assert.match(ui,/m\.model_version/);
  assert.doesNotMatch(ui,/CageMetrix Predictor 0\.1/);
});

test('fight page does not mislabel model contributions as literal experience edges',()=>{
  const html=read('public/fight.html');
  const presentation=read('public/fight-presentation.js');
  assert.doesNotMatch(html,/graded against Predictor 0\.1/);
  assert.match(html,/current public CageMetrix™ Predictor/);
  assert.match(presentation,/UFC sample & uncertainty adjustment/);
  assert.match(presentation,/Model contribution favors/);
  assert.match(presentation,/not a claim that the favored fighter has more UFC experience/);
  assert.match(presentation,/Predictor \$\{p\.model_version\}/);
});
