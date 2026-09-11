import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MANAGEMENT_CONTACT_SOURCES,contactRowsFromOfficialPage,extractPublicEmails,normalizePublicEmail} from '../scripts/lib/management-contact-sources.mjs';

const read=path=>fs.readFileSync(path,'utf8');

test('management contact schema is evidence-backed and separate from agency website metadata',()=>{
  const sql=read('migrations/0041_management_contact_intelligence.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS management_agency_contacts/);
  assert.match(sql,/contact_kind IN \([\s\S]*?'booking_email','general_email','booking_form','contact_form'/);
  assert.match(sql,/CREATE VIEW scout_primary_management_contact/);
  assert.match(sql,/WHEN 'booking_email' THEN 1/);
  assert.match(sql,/agency_contact_kind/);
  assert.match(sql,/agency_contact_value/);
  assert.doesNotMatch(sql,/ALTER TABLE management_agencies ADD COLUMN email/i);
});

test('official contact parser extracts public email text and mailto links only',()=>{
  const html='<main><a href="mailto:Info@Agency.com?subject=Booking">Email us</a><p>General: press@agency.com</p><p>not an email: fighter at agency dot com</p></main>';
  assert.deepEqual(extractPublicEmails(html),['info@agency.com','press@agency.com']);
  assert.equal(normalizePublicEmail('MAILTO:INFO@AGENCY.COM?subject=x'),'info@agency.com');
});

test('expected agency email must actually appear on the official page',()=>{
  const source={agencySlug:'test',publisher:'Test',url:'https://agency.test/contact',host:'agency.test',expectedEmail:'booking@agency.test',contactKind:'booking_email',label:'Bookings',confidence:'A'};
  assert.deepEqual(contactRowsFromOfficialPage('<p>booking@agency.test</p>',source),[{
    agency_slug:'test',publisher:'Test',contact_kind:'booking_email',contact_value:'booking@agency.test',label:'Bookings',source_url:'https://agency.test/contact',source_type:'official_contact',confidence:'A'
  }]);
  assert.deepEqual(contactRowsFromOfficialPage('<p>other@agency.test</p>',source),[]);
});

test('contact forms must remain same-host HTTPS routes',()=>{
  const source={agencySlug:'test',publisher:'Test',url:'https://agency.test/contact',host:'agency.test',contactFormUrl:'https://agency.test/book',contactKind:'booking_form',label:'Book',confidence:'A'};
  assert.equal(contactRowsFromOfficialPage('<p>Contact</p>',source)[0].contact_value,'https://agency.test/book');
  assert.throws(()=>contactRowsFromOfficialPage('<p>Contact</p>',{...source,contactFormUrl:'https://evil.test/book'}));
});

test('wave 1 contact registry uses official source-backed recruiter routes',()=>{
  const bySlug=slug=>MANAGEMENT_CONTACT_SOURCES.find(row=>row.agencySlug===slug);
  const expected={
    'first-round-management':'info@firstroundmanagement.com',
    'fair-play-mma':'info@fairplaymma.com',
    'ak-fighter-management':'info@akfightermanagement.com',
    'knock-out-representation':'info@koreps.com'
  };
  for(const [slug,email] of Object.entries(expected)){
    const source=bySlug(slug);
    assert.ok(source,slug);
    assert.equal(source.expectedEmail,email);
    assert.equal(source.confidence,'A');
    assert.equal(new URL(source.url).hostname,source.host);
  }
  const gladiator=bySlug('gladiator-management-agency');
  assert.equal(gladiator.contactKind,'contact_form');
  assert.equal(gladiator.contactFormUrl,'https://www.gladiatormgmtagency.com/contact');
});

test('contact sync retires stale routes only after a reachable official source',()=>{
  const source=read('scripts/sync-management-contacts.mjs');
  assert.match(source,/if\(!audit\|\|audit\.status!=='ok'\)continue/);
  assert.match(source,/UPDATE management_agency_contacts SET is_current=0/);
  assert.match(source,/ON CONFLICT\(agency_id,contact_kind,contact_value,source_url\) DO UPDATE/);
  assert.match(source,/is_current=1/);
  assert.match(source,/missingAgencies/);
});

test('management contact intelligence never enters Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  assert.doesNotMatch(rating,/management_agency_contacts|scout_primary_management_contact|agency_contact_value/);
});

test('contact workflow is independent and source-scoped',()=>{
  const workflow=read('.github/workflows/management-contact-sync.yml'),pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['management:contacts:sync'],'node scripts/sync-management-contacts.mjs --remote');
  assert.match(workflow,/group: mmascouts-management-contact-sync/);
  assert.match(workflow,/sync-management-contacts\.mjs --dry-run/);
  assert.match(workflow,/npm run management:contacts:sync/);
  assert.doesNotMatch(workflow,/cagemetrix-production/);
});
