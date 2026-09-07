import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

test('Scout AI is routed through the worker and Workers AI binding', () => {
  const worker = read('src/worker.ts');
  const config = read('wrangler.jsonc');
  const navigation = read('src/navigation.ts');

  assert.match(worker, /from ['"]\.\/scout-ai\.ts['"]/);
  assert.match(worker, /url\.pathname==='\/api\/scout'/);
  assert.match(worker, /url\.pathname==='\/scout'/);
  assert.match(config, /"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"/s);
  assert.match(config, /"\/scout"/);
  assert.match(navigation, /href="\/scout">Scout AI/);
});

test('Scout AI keeps model output downstream of retrieved evidence', () => {
  const source = read('src/scout-ai.ts');

  assert.match(source, /Answer ONLY from the supplied structured evidence/);
  assert.match(source, /Never invent a fight, opponent, statistic, ranking, injury, result, or biographical fact/);
  assert.match(source, /FROM ratings_history/);
  assert.match(source, /FROM bout_totals/);
  assert.match(source, /FROM ufc_warehouse_career_rows/);
  assert.match(source, /response_format/);
  assert.match(source, /json_schema/);
  assert.doesNotMatch(source, /eval\s*\(/);
});

test('Scout AI preview renders model text as text, not HTML', () => {
  const html = read('public/scout.html');
  const client = read('public/scout-ai.js');

  assert.match(html, /id="scout-ai-form"/);
  assert.match(html, /id="scout-ai-question"/);
  assert.match(html, /data-scout-question=/);
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.match(client, /fetch\('\/api\/scout'/);
  assert.match(client, /answer\.textContent/);
  assert.doesNotMatch(client, /\.innerHTML\s*=/);
});
