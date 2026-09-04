import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSurfacePreUfcHistory } from '../src/fighter-history.ts';

test('debutants and provisional UFC samples surface verified pre-UFC history', () => {
  assert.equal(shouldSurfacePreUfcHistory({ fighter: { id: 10, ufc_bouts: 0 }, rating: null }), true);
  assert.equal(shouldSurfacePreUfcHistory({ fighter: { id: 10, ufc_bouts: 2 }, rating: { provisional: true } }), true);
});

test('established UFC samples return to UFC-focused fight history', () => {
  assert.equal(shouldSurfacePreUfcHistory({ fighter: { id: 10, ufc_bouts: 8 }, rating: { provisional: false } }), false);
  assert.equal(shouldSurfacePreUfcHistory({ fighter: null, rating: null }), false);
});
