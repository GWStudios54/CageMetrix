import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const policy=JSON.parse(fs.readFileSync('scripts/data/contract-source-policy.json','utf8'));

test('contract policy keeps missing evidence unknown and requires explicit free-agent evidence',()=>{
  assert.equal(policy.publish_rules.missing_is_unknown,true);
  assert.equal(policy.publish_rules.free_agent_requires_explicit_source,true);
  assert.equal(policy.publish_rules.unmanaged_requires_explicit_source,true);
  assert.equal(policy.publish_rules.exact_expiration_requires_explicit_source,true);
  assert.equal(policy.publish_rules.remaining_fights_requires_explicit_source,true);
  assert.equal(policy.publish_rules.purse_terms_require_explicit_source,true);
  assert.equal(policy.publish_rules.no_hacked_or_private_material,true);
});

test('first-party and public-record sources carry the highest evidence tier',()=>{
  for(const key of ['fighter_direct','manager_or_agency_direct','promotion_direct','athletic_commission_record','court_record'])assert.ok(policy.A.includes(key));
});
