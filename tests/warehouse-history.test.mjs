import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWarehouseName, confidenceForIdentity } from '../scripts/lib/warehouse-history.mjs';

test('warehouse identity normalization matches accents and punctuation conservatively', () => {
  assert.equal(normalizeWarehouseName('José Aldo Jr.'), 'jose aldo jr');
  assert.equal(normalizeWarehouseName("Sean O’Malley"), 'sean o malley');
  assert.equal(normalizeWarehouseName('  Zhang   Weili  '), 'zhang weili');
});

test('exact DOB corroboration raises identity confidence', () => {
  assert.equal(confidenceForIdentity({ dob: '1986-09-09' }, { dob: '1986-09-09' }), 0.995);
  assert.equal(confidenceForIdentity({ dob: null }, { dob: '1986-09-09' }), 0.95);
  assert.equal(confidenceForIdentity({ dob: '1986-09-09' }, { dob: '1987-09-09' }), 0.95);
});
