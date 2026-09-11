import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FIGHTER_CONTACT_SOURCES,normalizeFighterContactName,normalizeProfessionalEmail,parse3MgtAthleteContacts} from '../scripts/lib/fighter-contact-sources.mjs';

const read=path=>fs.readFileSync(path,'utf8');

test('fighter professional contact schema is separate, exact-identity evidence',()=>{
  const sql=read('migrations/0042_fighter_professional_contact_intelligence.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS fighter_professional_contacts/);
  assert.match(sql,/CREATE VIEW scout_current_fighter_contact/);
  assert.match(sql,/contact_kind IN \([\s\S]*?'booking_email','management_email','professional_email','contact_form','professional_url'/);
  assert.match(sql,/source_key TEXT NOT NULL/);
  assert.match(sql,/source_fighter_id TEXT NOT NULL/);
  assert.match(sql,/manager_or_agency_direct/);
  assert.doesNotMatch(sql,/ALTER TABLE fighter_opportunity_status/);
});

test('fighter contact precedence is direct, fighter-specific, agency route, then website fallback',()=>{
  const sql=read('migrations/0042_fighter_professional_contact_intelligence.sql');
  assert.match(sql,/WHEN o\.public_contact_url IS NOT NULL THEN o\.public_contact_url/);
  assert.match(sql,/WHEN fpc\.contact_kind IN \('booking_email','management_email','professional_email'\)/);
  assert.match(sql,/WHEN cm\.agency_contact_kind IN \('booking_email','general_email'\)/);
  assert.match(sql,/ELSE cm\.agency_website/);
  assert.match(sql,/COALESCE\(o\.public_contact_url,fpc\.contact_value,cm\.agency_contact_value\) IS NOT NULL/);
  assert.doesNotMatch(sql,/COALESCE\(o\.public_contact_url,fpc\.contact_value,cm\.agency_contact_value,cm\.agency_website\) IS NOT NULL/);
});

test('3MGT parser pairs athlete headings with fighter-specific public management emails',()=>{
  const source=FIGHTER_CONTACT_SOURCES[0];
  const html=`<main>
    <p>Agency: 3mgt@3mgt.de</p>
    <h2>Our Athletes</h2>
    <div><h5>Islam Dulatov</h5><p>UFC Fighter</p><a href="mailto:islam@3mgt.de">islam@3mgt.de</a></div>
    <div><h5>Losene Keita</h5><p>MMA Champion</p><span>keita@3mgt.de</span></div>
    <div><h5>Kerim Engizek</h5><p>MMA Champion</p><span>kerim@3mgt.de</span></div>
    <h2>Case Studie</h2><h5>Not An Athlete</h5><p>case@3mgt.de</p>
  </main>`;
  assert.deepEqual(parse3MgtAthleteContacts(html,source),[
    {fighter_name:'Islam Dulatov',normalized_name:'islam dulatov',email:'islam@3mgt.de'},
    {fighter_name:'Losene Keita',normalized_name:'losene keita',email:'keita@3mgt.de'},
    {fighter_name:'Kerim Engizek',normalized_name:'kerim engizek',email:'kerim@3mgt.de'}
  ]);
});

test('3MGT parser excludes the generic agency inbox from athlete contacts',()=>{
  const source=FIGHTER_CONTACT_SOURCES[0];
  const html='<h2>Our Athletes</h2><div><h5>Islam Dulatov</h5><p>3mgt@3mgt.de</p></div><div><h5>Losene Keita</h5><p>keita@3mgt.de</p></div><div><h5>Kerim Engizek</h5><p>kerim@3mgt.de</p></div><h2>Case Studie</h2>';
  const rows=parse3MgtAthleteContacts(html,source);
  assert.equal(rows[0].email,null);
  assert.equal(rows[1].email,'keita@3mgt.de');
  assert.equal(rows[2].email,'kerim@3mgt.de');
  assert.ok(rows.every(row=>row.email!=='3mgt@3mgt.de'));
});

test('fighter contact source requires a healthy roster and contact sample before retirement',()=>{
  const source=FIGHTER_CONTACT_SOURCES[0];
  assert.ok(source.minimumRosterCount>=3);
  assert.ok(source.minimumContactCount>=2);
  const sync=read('scripts/sync-fighter-contacts.mjs');
  assert.match(sync,/Roster parse below healthy minimum/);
  assert.match(sync,/Contact parse below healthy minimum/);
  assert.match(sync,/sourceAudit\.some\(row=>row\.slug===source\.slug&&row\.status==='ok'\)/);
  assert.match(sync,/UPDATE fighter_professional_contacts SET is_current=0/);
});

test('fighter contact sync requires one exact normalized warehouse identity',()=>{
  const sync=read('scripts/sync-fighter-contacts.mjs');
  assert.match(sync,/normalized_name IN/);
  assert.match(sync,/hits\.length===1/);
  assert.match(sync,/hits\.length>1/);
  assert.match(sync,/ambiguous/);
  assert.doesNotMatch(sync,/fuzzy|levenshtein|jaro|similarity/i);
});

test('missing fighter-specific email retires prior source evidence to unknown rather than inventing a route',()=>{
  const sync=read('scripts/sync-fighter-contacts.mjs');
  assert.match(sync,/if\(!row\.email\)continue/);
  assert.match(sync,/SET is_current=0/);
  assert.doesNotMatch(sync,/contact_value.*agency_website/i);
  assert.doesNotMatch(sync,/availability_status|free_agent/i);
});

test('fighter-specific contact evidence is manager-direct Grade A and rating-independent',()=>{
  const source=FIGHTER_CONTACT_SOURCES[0],rating=read('scripts/build-global-scout-rating-v2.py');
  assert.equal(source.publisher,'3MGT Sports and Media Management');
  assert.equal(source.sourceType,'manager_or_agency_direct');
  assert.equal(source.confidence,'A');
  assert.equal(source.contactKind,'management_email');
  assert.equal(normalizeFighterContactName('Cédric Doumbé'),'cedric doumbe');
  assert.equal(normalizeProfessionalEmail('MAILTO:ISLAM@3MGT.DE?subject=Fight'),'islam@3mgt.de');
  assert.doesNotMatch(rating,/fighter_professional_contacts|scout_current_fighter_contact|fighter_management_email/);
});

test('fighter contact workflow is independent and refreshes fighter intelligence afterward',()=>{
  const workflow=read('.github/workflows/fighter-contact-sync.yml'),fighter=read('.github/workflows/fighter-intel.yml'),pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['fighter:contacts:sync'],'node scripts/sync-fighter-contacts.mjs --remote');
  assert.match(workflow,/group: mmascouts-fighter-contact-sync/);
  assert.match(workflow,/sync-fighter-contacts\.mjs --dry-run/);
  assert.match(workflow,/npm run fighter:contacts:sync/);
  assert.match(fighter,/Sync management contact intelligence/);
  assert.match(fighter,/Sync fighter professional contact intelligence/);
  assert.match(fighter,/migrations\/0042_fighter_professional_contact_intelligence\.sql/);
});
