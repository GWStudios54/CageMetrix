import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../src/index.ts';

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const db = new DatabaseSync(':memory:');
for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
db.exec("INSERT INTO model_versions (id,name,version) VALUES (99,'CageMetrix Opponent-Adjusted Rating','0.2.2')");
const insertFighter = db.prepare('INSERT INTO fighters (id,slug,name,current_weight_class,active) VALUES (?,?,?,?,?)');
const insertRating = db.prepare('INSERT INTO ratings_history (fighter_id,model_version_id,as_of_date,cmr,striking_offense,confidence,sample_bouts) VALUES (?,99,?,?,?,90,1)');
for (let i = 1; i <= 65; i++) {
  insertFighter.run(i, `fighter-${i}`, i === 65 ? "100% O'Neil_" : `Fighter ${i}`, i <= 60 ? 'Lightweight' : 'Heavyweight', i === 64 ? 0 : 1);
  insertRating.run(i, '2026-06-27', 100 - i, i);
}
const env = { MODEL_VERSION: '0.2.2', DB: { prepare(sql) {
  const statement = db.prepare(sql);
  let bindings = [];
  return {
    bind(...values) { bindings = values; return this; },
    async all() { return { results: statement.all(...bindings) }; },
    async first() { return statement.get(...bindings) ?? null; }
  };
} } };
async function request(params) {
  return worker.fetch(new Request(`https://cagemetrix.com/api/rankings?${new URLSearchParams(params)}`), env, { waitUntil() {} });
}
test('pagination traverses every eligible fighter once and retains absolute ranks', async () => {
  const pages = await Promise.all([0, 25, 50].map(async offset => (await request({ weight_class: 'Lightweight', limit: 25, offset })).json()));
  assert.deepEqual(pages.map(p => p.data.length), [25, 25, 10]);
  assert.equal(pages[0].meta.total, 60);
  assert.deepEqual(pages.flatMap(p => p.data.map(r => r.rank)), Array.from({ length: 60 }, (_, i) => i + 1));
  assert.equal(new Set(pages.flatMap(p => p.data.map(r => r.slug))).size, 60);
});
test('search preserves rank and accepts one-bout provisional samples', async () => {
  const result = await (await request({ weight_class: 'Lightweight', q: 'Fighter 40' })).json();
  assert.equal(result.data[0].rank, 40);
  assert.equal(result.data[0].name, 'Fighter 40');
  assert.equal(result.meta.total, 1);
});
test('metric selection changes ordering, and active-only filtering remains applied', async () => {
  const result = await (await request({ metric: 'striking_offense', limit: 200 })).json();
  assert.equal(result.data[0].id, 65);
  assert.equal(result.data[0].metric_value, 65);
  assert.equal(result.meta.total, 64);
  assert.ok(result.data.every(r => r.id !== 64));
});
test('search treats SQL wildcard characters literally and binds apostrophes', async () => {
  for (const q of ['%', '_', "O'Neil"]) {
    const result = await (await request({ q })).json();
    assert.equal(result.meta.total, 1);
    assert.equal(result.data[0].id, 65);
  }
  assert.equal((await (await request({ q: "' OR 1=1 --" })).json()).data.length, 0);
});
test('unsupported metrics fail with a useful response', async () => {
  const response = await request({ metric: 'unknown' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_metric');
});
