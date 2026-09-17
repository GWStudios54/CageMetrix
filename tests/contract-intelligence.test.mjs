import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {articleText,candidateRows,detectContractSignal,exactFighterMatches,hasContractSignal,normalizeContractText,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const read=path=>fs.readFileSync(path,'utf8');

test('contract schema separates events, evidence, management evidence, agency sources and private discovery candidates',()=>{
  const migration=read('migrations/0037_contract_representation_intelligence.sql');
  for(const table of ['fighter_contract_events','fighter_contract_evidence','fighter_management_evidence','management_agency_sources','contract_intel_candidates'])assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration,/CREATE VIEW scout_current_contracts/);
  assert.match(migration,/review_status IN \('pending','accepted','rejected','duplicate','needs_identity'\)/);
  assert.match(migration,/INSERT OR IGNORE INTO fighter_management_evidence/);
});

test('public contract API and dossier keep release/expiration distinct from free agency',()=>{
  const source=read('src/contract-intel.ts');
  assert.match(source,/release or contract expiration with one promotion does not automatically mean global free agency/i);
  assert.match(source,/statusAfter==='under_contract'\|\|statusAfter==='non_exclusive'\|\|statusAfter==='free_agent'/);
  assert.doesNotMatch(source,/statusAfter==='released'\|\|statusAfter==='expired'.*fighter_opportunity_status/);
  assert.match(source,/free_agent_requires_stronger_source/);
  assert.match(source,/No public contract terms verified yet/);
});

test('contract and candidate routes are first-class and candidate review stays authenticated',()=>{
  const entry=read('src/entry.ts'),queue=read('src/contract-candidates.ts');
  assert.match(entry,/\/contracts\\\/\?\$/);
  assert.match(entry,/api\/admin\/talent\/contracts\/candidates/);
  assert.match(entry,/enhanceFighterContractContext/);
  assert.match(queue,/adminAccount\(request,env\.DB\)/);
  assert.match(queue,/Discovery candidates are private review leads, not published contract facts/);
});

test('agency pages link official evidence while declaring independence',()=>{
  const source=read('src/management-about.ts');
  assert.match(source,/Independent MMA Scouts profile/);
  assert.match(source,/not affiliated with or endorsed by/);
  assert.match(source,/not copied marketing text/);
  assert.match(source,/management_agency_sources/);
});

test('management sync preserves multiple agency and representation evidence rows',()=>{
  const sync=read('scripts/sync-management.mjs');
  assert.match(sync,/management_agency_sources/);
  assert.match(sync,/fighter_management_evidence/);
  assert.match(sync,/official fighter roster/);
  assert.match(sync,/evidence_verification/);
});

test('manual representation changes preserve source metadata',()=>{
  const source=read('src/talent-admin.ts');
  assert.match(source,/fighter_management_evidence/);
  assert.match(source,/source_title/);
  assert.match(source,/publisher/);
  assert.match(source,/published_at/);
  assert.match(source,/addManagementEvidence/);
});

test('contract and representation intelligence never feeds Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  for(const forbidden of ['fighter_contract_events','fighter_contract_evidence','fighter_management_evidence','contract_intel_candidates','management_agency_sources'])assert.doesNotMatch(rating,new RegExp(forbidden));
});

test('contract signal detector distinguishes common deal events',()=>{
  assert.equal(hasContractSignal('Fighter signs new multi-fight contract'),true);
  assert.deepEqual(detectContractSignal('Fighter is now a free agent'),{eventType:'free_agency',status:'free_agent'});
  assert.deepEqual(detectContractSignal('Promotion released Fighter Name'),{eventType:'release',status:'released'});
  assert.deepEqual(detectContractSignal('Fighter Name re-signed on a new deal'),{eventType:'extension',status:'under_contract'});
  assert.equal(hasContractSignal('Promotion announces a new media rights agreement'),false);
});

test('discovery requires exact full-name matches and flags duplicate identities',()=>{
  const profiles=[
    {source_key:'a',source_fighter_id:'1',fighter_name:'Jane Doe'},
    {source_key:'a',source_fighter_id:'2',fighter_name:'John Smith'},
    {source_key:'b',source_fighter_id:'3',fighter_name:'John Smith'}
  ];
  const matches=exactFighterMatches('Jane Doe signs a new contract. John Smith is also discussed.',profiles);
  assert.equal(matches.length,2);
  assert.equal(matches.find(row=>row.name===normalizeContractText('Jane Doe')).ambiguous,false);
  assert.equal(matches.find(row=>row.name===normalizeContractText('John Smith')).ambiguous,true);
});

test('listing parser only surfaces contract-signal article links from approved host/path',()=>{
  const source={kind:'html',url:'https://example.com/news',host:'example.com',path:/\/news\//};
  const html=`<article><a href="/news/jane-doe-signs">Jane Doe signs new contract</a></article><article><a href="/news/event-results">Event results</a></article><article><a href="https://evil.example/news/fake">John Smith released</a></article>`;
  const rows=parseContractListing(html,source);
  assert.equal(rows.length,1);assert.match(rows[0].url,/jane-doe-signs/);
});

test('article extraction preserves semantic blocks instead of flattening the entire page',()=>{
  const html=`<main><h1>Contract story comparing a signee to Famous Fighter</h1><nav>Famous Fighter signs elsewhere</nav><p>Jane Doe signed a UFC contract after her win.</p><aside>John Smith released by another promotion.</aside><p>Unrelated event result.</p></main>`;
  const body=articleText(html);
  assert.match(body,/Jane Doe signed a UFC contract/);
  assert.match(body,/Unrelated event result/);
  assert.doesNotMatch(body,/Famous Fighter signs elsewhere/);
  assert.doesNotMatch(body,/John Smith released/);
  assert.doesNotMatch(body,/Contract story comparing/);
});

test('article extraction excludes a related-posts river so one article\'s events are never misattributed to fighters named only in another story\'s teaser',()=>{
  // Mirrors a real bug found live on BJPenn.com: its article pages append a
  // `<section class="related os-related">` river of "Read more" excerpt blocks for OTHER, unrelated
  // stories, right after the real content -- with no distinguishing tag our old exclusion list caught.
  // Those excerpts were getting swept into the block scan, producing candidates that misattributed one
  // story's fighters/events to a completely different article (e.g. a Renato Moicano quote-excerpt
  // teaser landing inside the Brian Ortega withdrawal article's extracted text).
  const html=`<article class="entry-content"><p>Real Fighter has withdrawn from his upcoming bout due to injury.</p></article><section class="related os-related"><div class="os-feed-item"><p class="os-feed-excerpt">Other Fighter scorches rival after unrelated pullout drama.</p></div></section>`;
  const body=articleText(html);
  assert.match(body,/Real Fighter has withdrawn/);
  assert.doesNotMatch(body,/Other Fighter scorches rival/);
});

test('article extraction excludes a "see also" link list embedded in a single paragraph, with no wrapper class to catch it, by anchor density rather than a per-language phrase',()=>{
  // Mirrors a real bug found live on ufc-fr.com: unlike BJPenn's separately-wrapped related-posts
  // section, its "Voir aussi les articles suivants :" recommendation list is a single <p> with no
  // distinguishing class, sitting inside the very same <article> as the real content -- so a class
  // exclusion can never catch it. One of its five links named a fighter (Max Holloway) with zero
  // connection to the actual article, producing a misattributed candidate. Real prose blocks across
  // every source already relied on (BJPenn, Sherdog, PFL) never carry more than 3 anchors, so >=4 is
  // used as a safe, language-independent signal instead.
  const html=`<article><p>Real Fighter earned a new contract after his win at the event.</p><p><strong>See also the following stories:</strong><br><a href="/a">Other Story About Rival Fighter</a><br><a href="/b">Second Story About Another Name</a><br><a href="/c">Third Story About A Third Name</a><br><a href="/d">Fourth Story Mentioning Unrelated Fighter</a></p></article>`;
  const body=articleText(html);
  assert.match(body,/Real Fighter earned a new contract/);
  assert.doesNotMatch(body,/Unrelated Fighter/);
});

test('article extraction excludes a "recirc" widget even though it has no "related" class, since sites name this pattern differently',()=>{
  // Mirrors a real bug found live on MMA Mania (a Vox Media/SB Nation "Duet" platform site, same
  // platform as MMA Fighting): its real "More in <event>" river is wrapped in
  // `.duet--layout--article-recirc`, which the earlier [class*="related"] fix does not match --
  // Vox names this content-recycling pattern "recirc", not "related". It let an unrelated fighter's
  // withdrawal story leak into a completely different fight-preview article's extracted text.
  const html=`<article><p>Real Fighter is undefeated heading into this weekend's card.</p><div class="duet--layout--article-recirc"><p>Unrelated Fighter was forced to withdraw from his upcoming bout.</p></div></article>`;
  const body=articleText(html);
  assert.match(body,/Real Fighter is undefeated/);
  assert.doesNotMatch(body,/Unrelated Fighter/);
});

test('signal-local discovery excludes comparison and opponent names from contract candidates',()=>{
  const source={publisher:'UFC',sourceType:'promotion_direct',promotionSlug:'ufc'};
  const profiles=[
    {source_key:'mma',source_fighter_id:'1',fighter_name:'Quentin Pasley'},
    {source_key:'mma',source_fighter_id:'2',fighter_name:'Isaac Moreno'},
    {source_key:'mma',source_fighter_id:'3',fighter_name:'Martin Kozak'},
    {source_key:'mma',source_fighter_id:'4',fighter_name:'Christian Natividad'},
    {source_key:'mma',source_fighter_id:'5',fighter_name:'Jon Jones'},
    {source_key:'mma',source_fighter_id:'6',fighter_name:'Christian Echols'},
    {source_key:'mma',source_fighter_id:'7',fighter_name:'Apollo Gomes'},
    {source_key:'mma',source_fighter_id:'8',fighter_name:'Alexa Grasso'}
  ];
  const body=[
    'Week 5 saw light heavyweight Quentin Pasley, welterweight Isaac Moreno, middleweight Martin Kozak, and flyweight Christian Natividad each earn UFC contracts after impressive wins.',
    'After the fight, Dana White praised Quentin Pasley, awarding him a contract and comparing him to Jon Jones.',
    'Martin Kozak stepped into the Octagon to take on Christian Echols, and the performance made Kozak contract offer an easy decision.',
    'Apollo Gomes defeats Kwon Won Il via unanimous decision.',
    'Alexa Grasso was mentioned in a related story elsewhere on the page.'
  ].join('\n');
  const rows=candidateRows({title:'Welcome To The UFC',url:'https://www.ufc.com/news/welcome',summary:'Four contracts awarded.'},source,body,profiles);
  const names=new Set(rows.map(row=>row.fighterName));
  for(const expected of ['Quentin Pasley','Isaac Moreno','Martin Kozak','Christian Natividad'])assert.equal(names.has(expected),true,expected);
  for(const forbidden of ['Jon Jones','Christian Echols','Apollo Gomes','Alexa Grasso'])assert.equal(names.has(forbidden),false,forbidden);
  assert.ok(rows.every(row=>row.extractionMethod==='signal_block_scoped_subject_v4'));
});

test('candidate discovery reconciles clean v4 rediscoveries instead of hiding them behind legacy keys',()=>{
  const discovery=read('scripts/discover-contract-intel.mjs');
  assert.match(discovery,/candidate key identifies the source \+ fighter \+ detected event/i);
  assert.match(discovery,/UPDATE contract_intel_candidates SET source_url=.*extraction_method=.*review_status=.*reviewed_at=NULL/s);
  assert.match(discovery,/Automatically reactivated by scoped subject-attributed discovery v4/);
  assert.match(discovery,/review_status='rejected' AND instr\(COALESCE\(notes,''\)/);
  assert.match(discovery,/restored_legacy_candidates/);
  assert.match(discovery,/LEGACY_METHODS=.*signal_block_subject_v3/);
});

test('candidate discovery queues evidence without publishing contract events',()=>{
  const source={publisher:'Test Promotion',sourceType:'promotion_direct',promotionSlug:'test'};
  const profiles=[{source_key:'mma',source_fighter_id:'42',fighter_name:'Jane Doe'}];
  const rows=candidateRows({title:'Jane Doe signs new contract',url:'https://example.com/news/jane',summary:'Jane Doe has signed a new multi-fight contract.'},source,'Jane Doe has signed a new multi-fight contract and will remain with the promotion.',profiles);
  assert.equal(rows.length,1);assert.equal(rows[0].reviewStatus,'pending');assert.equal(rows[0].detectedEventType,'signing');assert.equal(rows[0].sourceFighterId,'42');
  const discovery=read('scripts/discover-contract-intel.mjs');
  assert.match(discovery,/source\.seedArticles/);
  assert.match(discovery,/INSERT OR IGNORE INTO contract_intel_candidates/);
  assert.match(discovery,/signal_block_scoped_subject_v4/);
  assert.match(discovery,/Automatically superseded by scoped subject-attributed discovery v4/);
  assert.doesNotMatch(discovery,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_contract_events/i);
});


test('contract review desk requires human publication before accepting discovery leads',()=>{
  const page=read('src/contract-review.ts'),queue=read('src/contract-candidates.ts'),admin=read('src/contract-intel.ts'),entry=read('src/entry.ts');
  assert.match(page,/Detection is a private lead, not a fact/);
  assert.match(page,/Evidence explicitly supports this status as current now/);
  assert.match(page,/Recency is not enough/);
  assert.match(page,/Publish verified event/);
  assert.match(page,/\/api\/admin\/talent\/contracts/);
  assert.match(page,/review_status:'accepted'/);
  assert.ok(page.indexOf("api('/api/admin/talent/contracts'")<page.indexOf("review_status:'accepted'"),'contract event must be written before candidate acceptance');
  assert.match(queue,/sameOrigin\(request\)/);
  assert.match(admin,/sameOrigin\(request\)/);
  assert.match(entry,/path==='\/recruiting\/contracts'/);
  assert.match(entry,/contractReviewPage/);
});

test('contract review never auto-promotes discovery candidates',()=>{
  const discovery=read('scripts/discover-contract-intel.mjs'),page=read('src/contract-review.ts');
  assert.doesNotMatch(discovery,/INSERT\s+(?:OR\s+\w+\s+)?INTO fighter_contract_events/i);
  assert.match(page,/Nothing is auto-published/);
  assert.match(page,/needs_identity/);
  assert.doesNotMatch(page,/<input[^>]*name=\\?"is_current\\?"[^>]*\\schecked(?:=|\\s|>)/i);
});
