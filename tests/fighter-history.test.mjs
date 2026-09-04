import test from 'node:test';
import assert from 'node:assert/strict';
import { augmentFighterProfileWithPreUfcHistory, shouldSurfacePreUfcHistory } from '../src/fighter-history.ts';

test('debutants and provisional UFC samples surface verified pre-UFC history', () => {
  assert.equal(shouldSurfacePreUfcHistory({ fighter: { id: 10, ufc_bouts: 0 }, rating: null }), true);
  assert.equal(shouldSurfacePreUfcHistory({ fighter: { id: 10, ufc_bouts: 0 }, rating: { provisional: false } }), true);
  assert.equal(shouldSurfacePreUfcHistory({ fighter: { id: 10, ufc_bouts: 2 }, rating: { provisional: true } }), true);
});

test('established UFC samples return to UFC-focused fight history', () => {
  assert.equal(shouldSurfacePreUfcHistory({ fighter: { id: 10, ufc_bouts: 8 }, rating: { provisional: false } }), false);
  assert.equal(shouldSurfacePreUfcHistory({ fighter: null, rating: null }), false);
});

test('debutant profiles receive verified active-snapshot pre-UFC rows', async () => {
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /ufc_warehouse_career_rows/);
        assert.match(sql, /active_snapshot_id/);
        return {
          bind(fighterId) {
            assert.equal(fighterId, 10);
            return {
              async all() {
                return { results: [{
                  source_fight_id: 'ksw-1',
                  event_date: '2026-05-01',
                  organization: 'KSW',
                  event_name: 'KSW 100',
                  weight_class: 'Lightweight',
                  is_major_org: 1,
                  method_raw: 'Decision - Unanimous',
                  method_normalized: 'Decision',
                  method_detail: null,
                  round_num: 5,
                  time_finish_seconds: 300,
                  result: 'W',
                  opponent_name: 'Example Opponent'
                }] };
              }
            };
          }
        };
      }
    }
  };

  const response = new Response(JSON.stringify({ fighter: { id: 10, ufc_bouts: 0 }, rating: null, recent_bouts: [] }), {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
  const augmented = await augmentFighterProfileWithPreUfcHistory(response, env);
  const payload = await augmented.json();
  assert.equal(payload.show_pre_ufc_history, true);
  assert.equal(payload.history_scope, 'combined');
  assert.equal(payload.pre_ufc_bouts.length, 1);
  assert.equal(payload.pre_ufc_bouts[0].organization, 'KSW');
  assert.equal(payload.pre_ufc_bouts[0].source_type, 'pre_ufc');
});
