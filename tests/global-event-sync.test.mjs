import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('scripts/sync-global-events.mjs','utf8');

test('global calendar reconciliation removes only stale scheduled shell events',()=>{
  assert.match(source,/item\.status==='ok'&&item\.events>0/);
  assert.match(source,/status='scheduled'/);
  assert.match(source,/slug NOT IN/);
  assert.match(source,/NOT EXISTS \(SELECT 1 FROM bouts WHERE bouts\.event_id=events\.id\)/);
  assert.match(source,/event_date>=date\('now','-3 day'\)/);
});

test('failed or quiet source fetches never trigger destructive reconciliation',()=>{
  assert.doesNotMatch(source,/sources\.filter\(item=>item\.status==='ok'\)\)\{/);
  assert.match(source,/item\.status==='ok'&&item\.events>0/);
});
