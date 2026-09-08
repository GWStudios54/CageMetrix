import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('promotion pages attach the canonical event calendar ahead of navigation normalization',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/enhancePromotionEvents/);
  assert.match(entry,/const promotionResponse=await promotionPage/);
  assert.match(entry,/enhancePromotionEvents\(promotionResponse,env,promotionPageMatch\[1\]\)/);
});

test('promotion event sections query only their promotion and link canonical event pages',()=>{
  const source=read('src/promotion-events.ts');
  assert.match(source,/WHERE promotion_slug=\?/);
  assert.match(source,/event_date>=date\('now','-45 day'\)/);
  assert.match(source,/href=\"\/events\/\$\{escape\(row\.slug\)\}\"/);
  assert.match(source,/UPCOMING EVENTS/);
  assert.match(source,/RECENT EVENTS/);
  assert.match(source,/verified dates and physical locations/);
  assert.doesNotMatch(source,/prediction|probability/i);
});
