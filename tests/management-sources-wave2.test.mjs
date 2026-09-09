import test from 'node:test';
import assert from 'node:assert/strict';
import {MANAGEMENT_SOURCES} from '../scripts/lib/management-sources.mjs';

const source=slug=>MANAGEMENT_SOURCES.find(item=>item.slug===slug);

test('second management wave adds five verified agency profiles',()=>{
  for(const slug of ['tam-global','galaktik-sports','magnar-sports-entertainment','littles-mma-management','goat-worldwide']){
    const item=source(slug);assert.ok(item,`missing ${slug}`);assert.ok(item.profileUrls.length>0);assert.match(item.website,/^https:\/\//);
  }
});

test('only explicit public roster surfaces are registered as fighter sources',()=>{
  assert.equal(source('littles-mma-management').rosterScope,'profile_only');
  assert.deepEqual(source('littles-mma-management').urls,[]);
  for(const slug of ['tam-global','galaktik-sports','magnar-sports-entertainment','goat-worldwide']){
    const item=source(slug);assert.equal(item.rosterScope,'official_public_roster');assert.ok(item.urls.length>0);
  }
});
