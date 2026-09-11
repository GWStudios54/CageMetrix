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
  const html='<form><input name="email"><textarea name="message"></textarea><button>Send</button></form>';
  assert.equal(contactRowsFromOfficialPage(html,source)[0].contact_value,'https://agency.test/book');
  assert.deepEqual(contactRowsFromOfficialPage(html,{...source,contactFormUrl:'https://evil.test/book'}),[]);
  assert.deepEqual(contactRowsFromOfficialPage('<p>Contact</p>',source),[]);
});

test('wave 1 contact registry uses official source-backed recruiter routes',()=>{
  const bySlug=slug=>MANAGEMENT_CONTACT_SOURCES.find(row=>row.agencySlug===slug);
  const expected={
    'first-round-management':'info@firstroundmanagement.com',
    'fair-play-mma':'info@fairplaymma.com',
    'ak-fighter-management':'info@akfightermanagement.com',
    'knock-out-representation':'info@koreps.com',
    'galaktik-sports':'javad@galaktiksports.com',
    'magnar-sports-entertainment':'info@magnarentertainment.com'
  };
  for(const [slug,email] of Object.entries(expected)){
    const source=bySlug(slug);
    assert.ok(source,slug);
    assert.equal(source.expectedEmail,email);
    assert.equal(source.confidence,'A');
    assert.equal(new URL(source.url).hostname,source.host);
  }
  assert.equal(bySlug('first-round-management').contactKind,'general_email');
  assert.equal(bySlug('first-round-management').label,'General agency contact');
  assert.equal(bySlug('ak-fighter-management').contactKind,'booking_email');
  const gladiator=bySlug('gladiator-management-agency');
  assert.equal(gladiator.contactKind,'contact_form');
  assert.equal(gladiator.contactFormUrl,'https://www.gladiatormgmtagency.com/contact');
  for(const slug of ['dominance-mma','ruby-sports-entertainment','goat-worldwide','tam-global']){
    const source=bySlug(slug);
    assert.ok(source,slug);
    assert.equal(source.contactKind,'contact_form');
    assert.equal(source.confidence,'A');
    assert.equal(new URL(source.contactFormUrl).hostname,source.host);
  }
  assert.ok(MANAGEMENT_CONTACT_SOURCES.length>=11);
});

test('contact sync retires stale routes only after a reachable official source',()=>{
  const source=read('scripts/sync-management-contacts.mjs');
  assert.match(source,/if\(!audit\|\|audit\.status!=='ok'\)continue/);
  assert.match(source,/UPDATE management_agency_contacts SET is_current=0/);
  assert.match(source,/ON CONFLICT\(agency_id,contact_kind,contact_value,source_url\) DO UPDATE/);
  const parser=read('scripts/lib/management-contact-sources.mjs');
  assert.match(parser,/const hasForm=Boolean\(doc\.querySelector\('form'\)\)/);
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


test('fighter intel coverage prefers direct fighter contact, then verified agency route, then website fallback',()=>{
  const sql=read('migrations/0041_management_contact_intelligence.sql');
  assert.match(sql,/WHEN o\.public_contact_url IS NOT NULL THEN o\.public_contact_url/);
  assert.match(sql,/WHEN cm\.agency_contact_kind IN \('booking_email','general_email'\).*'mailto:'\|\|cm\.agency_contact_value/s);
  assert.match(sql,/WHEN cm\.agency_contact_value IS NOT NULL THEN cm\.agency_contact_value/);
  assert.match(sql,/ELSE cm\.agency_website/);
  assert.match(sql,/COALESCE\(o\.public_contact_url,cm\.agency_contact_value,cm\.agency_website\) IS NOT NULL/);
  assert.match(sql,/agency_contact_verified_at/);
});

test('recruiting uses verified agency contacts before generic agency websites',()=>{
  const source=read('src/recruiting.ts');
  assert.match(source,/function agencyContactHref/);
  assert.match(source,/agency_contact_kind/);
  assert.match(source,/agency_contact_value/);
  assert.match(source,/Agency booking email/);
  assert.match(source,/Agency website/);
  assert.match(source,/!row\.public_contact_url&&!row\.agency_contact_value&&!row\.agency_website/);
  assert.match(source,/contact stale/);
  assert.match(source,/COALESCE\(o\.public_contact_url,c\.public_contact_url,cm\.agency_contact_value,cm\.agency_website\) resolved_contact_url/);
});

test('public talent and fighter intel label management contact provenance correctly',()=>{
  const talent=read('src/talent-network.ts'),intel=read('src/fighter-intel.ts');
  assert.match(talent,/function agencyContactHref/);
  assert.match(talent,/agency_contact_source_url/);
  assert.match(talent,/Booking email/);
  assert.match(talent,/Agency website/);
  assert.match(intel,/agency_contact_source_url/);
  assert.match(intel,/management_booking_email/);
  assert.match(intel,/Agency booking form/);
  assert.match(intel,/Agency website/);
});
