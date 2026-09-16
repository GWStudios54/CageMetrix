import test from 'node:test';
import assert from 'node:assert/strict';
import {amateurRecordCandidate,extractAmateurRecord,extractBirthDate,extractBirthPlace,hasAmateurRecord,hasMartialArtistInfobox,identityBasis,wikipediaLookupUrl} from '../scripts/lib/amateur-record-intel-discovery.mjs';

// A real infobox fragment (verified against Wikipedia's live "Ian Machado Garry" article and against
// Template:Infobox martial artist/doc's own parameter list): am_win/am_kowin/am_subwin/am_loss are the
// real field names, not invented ones.
const REAL_INFOBOX=`{{Short description|Irish mixed martial artist (born 1997)}}
{{Infobox martial artist
| name            = Ian Machado Garry
| birth_date      = {{birth date and age|df=yes|1997|11|17}}
| birth_place     = [[Portmarnock]], [[Dublin]], Ireland
| nationality     =
| mma_kowin       = 7
| mma_subwin      = 1
| am_label        =
| am_win          = 6
| am_kowin        = 5
| am_subwin       = 1
| am_loss         = 1
| am_koloss       =
| am_subloss      =
| am_decloss      = 1
| am_draw         =
| am_nc           =
| other           =
}}`;

const NO_AMATEUR_INFOBOX=`{{Infobox martial artist
| name            = Jon Jones
| birth_date      = {{birth date and age|1987|7|19}}
| mma_win         = 28
}}`;

test('wikipediaLookupUrl requests wikitext content and follows redirects in one call',()=>{
  const url=wikipediaLookupUrl('Ian Garry');
  assert.match(url,/action=query/);
  assert.match(url,/redirects=1/);
  assert.match(url,/rvprop=content/);
  assert.match(url,/titles=Ian(\+|%20)Garry/);
});

test('extracts the real am_win/am_loss/am_draw/am_nc infobox fields, not a fabricated field name',()=>{
  assert.equal(hasMartialArtistInfobox(REAL_INFOBOX),true);
  assert.equal(hasAmateurRecord(REAL_INFOBOX),true);
  const record=extractAmateurRecord(REAL_INFOBOX);
  assert.deepEqual(record,{wins:6,losses:1,draws:0,noContests:0});
});

test('a fighter page with no amateur MMA infobox fields is not treated as having an amateur record',()=>{
  assert.equal(hasMartialArtistInfobox(NO_AMATEUR_INFOBOX),true);
  assert.equal(hasAmateurRecord(NO_AMATEUR_INFOBOX),false);
});

test('parses the real {{birth date and age}} template and the wikilinked birth_place field',()=>{
  assert.equal(extractBirthDate(REAL_INFOBOX),'1997-11-17');
  assert.equal(extractBirthPlace(REAL_INFOBOX),'Portmarnock, Dublin, Ireland');
});

test('identity is corroborated against date of birth, never accepted on name match alone',()=>{
  assert.equal(identityBasis('1997-11-17','1997-11-17'),'birth_date_exact_match');
  assert.equal(identityBasis('1997-11-17','1990-01-01'),'mismatch');
  assert.equal(identityBasis('1997-11-17',null),'no_independent_fact_on_file');
  assert.equal(identityBasis(null,null),'no_independent_fact_on_file');
});

test('a DOB match queues an ordinary pending candidate; no DOB on file queues needs_identity; a DOB mismatch is dropped entirely',()=>{
  const matched=amateurRecordCandidate(
    {source_key:'mma',source_fighter_id:'1',fighter_name:'Ian Machado Garry',normalized_name:'ian machado garry',dob:'1997-11-17'},
    'Ian Machado Garry','https://en.wikipedia.org/wiki/Ian_Machado_Garry',REAL_INFOBOX
  );
  assert.ok(matched);
  assert.equal(matched.reviewStatus,'pending');
  assert.equal(matched.identityBasis,'birth_date_exact_match');
  assert.equal(matched.detectedWins,6);
  assert.equal(matched.detectedLosses,1);

  const noDob=amateurRecordCandidate(
    {source_key:'mma',source_fighter_id:'2',fighter_name:'Ian Machado Garry',normalized_name:'ian machado garry',dob:null},
    'Ian Machado Garry','https://en.wikipedia.org/wiki/Ian_Machado_Garry',REAL_INFOBOX
  );
  assert.ok(noDob);
  assert.equal(noDob.reviewStatus,'needs_identity');
  assert.equal(noDob.identityBasis,'no_independent_fact_on_file');

  const mismatch=amateurRecordCandidate(
    {source_key:'mma',source_fighter_id:'3',fighter_name:'Ian Machado Garry',normalized_name:'ian machado garry',dob:'1990-01-01'},
    'Ian Machado Garry','https://en.wikipedia.org/wiki/Ian_Machado_Garry',REAL_INFOBOX
  );
  assert.equal(mismatch,null);
});

test('a page with a martial-artist infobox but no amateur fields at all produces no candidate',()=>{
  const result=amateurRecordCandidate(
    {source_key:'mma',source_fighter_id:'4',fighter_name:'Jon Jones',normalized_name:'jon jones',dob:'1987-07-19'},
    'Jon Jones','https://en.wikipedia.org/wiki/Jon_Jones',NO_AMATEUR_INFOBOX
  );
  assert.equal(result,null);
});

test('candidateKey is stable and unique per fighter, not just per source URL, since one URL never covers two profiles here',()=>{
  const a=amateurRecordCandidate({source_key:'mma',source_fighter_id:'1',fighter_name:'X',normalized_name:'x',dob:'1997-11-17'},'X','https://en.wikipedia.org/wiki/X',REAL_INFOBOX);
  const b=amateurRecordCandidate({source_key:'mma',source_fighter_id:'2',fighter_name:'X',normalized_name:'x',dob:'1997-11-17'},'X','https://en.wikipedia.org/wiki/X',REAL_INFOBOX);
  assert.notEqual(a.candidateKey,b.candidateKey);
});
