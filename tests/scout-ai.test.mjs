import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

test('Scout AI is routed through the worker and protected by Workers bindings', () => {
  const worker = read('src/worker.ts');
  const config = read('wrangler.jsonc');
  const navigation = read('src/navigation.ts');

  assert.match(worker, /from ['"]\.\/scout-ai\.ts['"]/);
  assert.match(worker, /url\.pathname==='\/api\/scout'/);
  assert.match(worker, /url\.pathname==='\/scout'/);
  assert.match(config, /"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"/s);
  assert.match(config, /SCOUT_BURST_LIMITER/);
  assert.match(config, /SCOUT_MINUTE_LIMITER/);
  assert.match(config, /"period"\s*:\s*10/);
  assert.match(config, /"period"\s*:\s*60/);
  assert.match(config, /"\/scout"/);
  assert.match(navigation, /href="\/scout">Scout AI/);
});

test('Scout AI 0.2 keeps model output downstream of retrieved evidence', () => {
  const source = read('src/scout-ai.ts');

  assert.match(source, /Answer ONLY from the supplied structured evidence and evidence cards/);
  assert.match(source, /Never invent a fight, opponent, statistic, ranking, injury, result, organization, age, or biographical fact/);
  assert.match(source, /FROM ratings_history/);
  assert.match(source, /FROM bout_totals/);
  assert.match(source, /FROM ufc_warehouse_career_rows/);
  assert.match(source, /FROM scout_fighter_index/);
  assert.match(source, /FROM ufc_fighter_history_summary/);
  assert.match(source, /similar_fighters/);
  assert.match(source, /prospect_search/);
  assert.match(source, /pre_ufc_rankings/);
  assert.match(source, /validCitationAnswer/);
  assert.match(source, /response_format/);
  assert.match(source, /json_schema/);
  assert.doesNotMatch(source, /eval\s*\(/);
});

test('Scout research index materializes broad warehouse data away from runtime scans', () => {
  const migration = read('migrations/0023_scout_research_index.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS scout_fighter_index/);
  assert.match(migration, /CREATE TRIGGER trg_refresh_scout_fighter_index/);
  assert.match(migration, /AFTER UPDATE OF active_snapshot_id/);
  assert.match(migration, /recent_wins_730d/);
  assert.match(migration, /last_weight_class/);
});

test('Scout AI preview renders model text and evidence as text, not HTML', () => {
  const html = read('public/scout.html');
  const client = read('public/scout-ai.js');

  assert.match(html, /id="scout-ai-form"/);
  assert.match(html, /id="scout-ai-question"/);
  assert.match(html, /id="scout-ai-evidence"/);
  assert.match(html, /data-scout-question=/);
  assert.match(html, /Scout AI 0\.2/);
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.match(client, /fetch\('\/api\/scout'/);
  assert.match(client, /answer\.textContent/);
  assert.match(client, /li\.textContent = fact/);
  assert.doesNotMatch(client, /\.innerHTML\s*=/);
});
