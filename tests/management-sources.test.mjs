import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MANAGEMENT_SOURCES,applyManagementAliases,foldManagementLatinCompatibility,managementLookupKeys,normalizeManagementName,parseManagementRoster} from '../scripts/lib/management-sources.mjs';

test('management source registry separates roster sources from agency profile evidence',()=>{
  assert.ok(MANAGEMENT_SOURCES.length>=6);
  for(const source of MANAGEMENT_SOURCES){
    assert.ok(source.slug&&source.name&&source.website);
    assert.ok(['A','B','C'].includes(source.confidence));
    assert.ok(['official_public_roster','profile_only'].includes(source.rosterScope));
    assert.ok(Array.isArray(source.urls));
    assert.ok(Array.isArray(source.profileUrls)&&source.profileUrls.length>0);
    for(const url of [...source.urls,...source.profileUrls])assert.match(url,/^https:\/\//);
    if(source.rosterScope==='official_public_roster'){
      assert.ok(source.urls.length>0);
      assert.ok((Array.isArray(source.rosterSelectors)&&source.rosterSelectors.length>0)||source.rosterSection,`missing explicit roster extraction contract for ${source.slug}`);
    }
    if(source.rosterScope==='profile_only')assert.equal(source.urls.length,0);
  }
  assert.ok(MANAGEMENT_SOURCES.some(source=>source.slug==='suckerpunch-entertainment'&&source.rosterScope==='profile_only'));
  assert.ok(MANAGEMENT_SOURCES.some(source=>source.slug==='paradigm-sports'&&source.rosterScope==='profile_only'));
  const artnox=MANAGEMENT_SOURCES.find(source=>source.slug==='artnox-fight-sport');
  assert.ok(artnox);
  assert.equal(artnox.confidence,'A');
  assert.equal(artnox.rosterScope,'official_public_roster');
  assert.ok(artnox.urls.some(url=>/artnoxfightsport\.pl\/pages\/zawodnicy/.test(url)));
  const fairPlay=MANAGEMENT_SOURCES.find(source=>source.slug==='fair-play-mma');
  const ak=MANAGEMENT_SOURCES.find(source=>source.slug==='ak-fighter-management');
  for(const source of [fairPlay,ak]){
    assert.ok(source);
    assert.equal(source.confidence,'A');
    assert.equal(source.rosterScope,'official_public_roster');
    assert.ok(source.urls.length>0);
  }
  assert.ok(fairPlay.urls.some(url=>/fairplaymma\.com/.test(url)));
  assert.ok(ak.urls.some(url=>/akfightermanagement\.com/.test(url)));
  const koreps=MANAGEMENT_SOURCES.find(source=>source.slug==='knock-out-representation');
  const gladiator=MANAGEMENT_SOURCES.find(source=>source.slug==='gladiator-management-agency');
  for(const source of [koreps,gladiator]){
    assert.ok(source);
    assert.equal(source.confidence,'A');
    assert.equal(source.rosterScope,'official_public_roster');
    assert.ok(source.urls.length>0);
  }
  assert.ok(koreps.urls.some(url=>/koreps\.com\/athletes/.test(url)));
  assert.ok(gladiator.urls.some(url=>/gladiatormgmtagency\.com\/roster/.test(url)));
  for(const slug of ['hd-global-athlete-management','3mgt-sports-media-management','burns-mma-agency']){
    const source=MANAGEMENT_SOURCES.find(row=>row.slug===slug);
    assert.ok(source,slug);
    assert.equal(source.confidence,'A');
    assert.equal(source.rosterScope,'official_public_roster');
    assert.ok(source.urls.length>0);
    assert.ok(source.rosterSection);
  }
});

test('warehouse-compatible normalization preserves cautious exact matching',()=>{
  assert.equal(normalizeManagementName('Lone’er Kavanagh'),'lone er kavanagh');
  assert.equal(normalizeManagementName('Arman Tsarukyan'),'arman tsarukyan');
  assert.equal(normalizeManagementName('Jonas Mågård'),'jonas magard');
});

test('roster parser extracts athlete names but not page furniture',()=>{
  const html=`<main><h1>UFC Athletes</h1><div><h6>Ilia Topuria</h6></div><div><p>Mayra Bueno Silva</p></div><div><span>Lone’er Kavanagh</span></div><div><img alt="Kamaru Usman"><p>Kamaru Usman (UFC)</p></div><h2>Our Services</h2><p>First Round Management</p><p>Las Vegas, Nevada</p></main>`;
  const names=parseManagementRoster(html),normalized=names.map(normalizeManagementName);
  for(const expected of ['ilia topuria','mayra bueno silva','lone er kavanagh','kamaru usman'])assert.ok(normalized.includes(expected),`missing ${expected}: ${JSON.stringify(names)}`);
  assert.ok(!normalized.includes('first round management'));
  assert.ok(!normalized.includes('our services'));
});

test('agency team pages are never registered as fighter roster sources',()=>{
  const sucker=MANAGEMENT_SOURCES.find(source=>source.slug==='suckerpunch-entertainment');
  const paradigm=MANAGEMENT_SOURCES.find(source=>source.slug==='paradigm-sports');
  assert.deepEqual(sucker.urls,[]);
  assert.ok(sucker.profileUrls.some(url=>/about-us/.test(url)));
  assert.deepEqual(paradigm.urls,[]);
  assert.ok(paradigm.profileUrls.some(url=>/representation/.test(url)));
});

test('official roster promotion labels are stripped before matching',()=>{
  const names=parseManagementRoster(`<section><p>Khabib Nurmagomedov (UFC)</p><p>Kayla Harrison (PFL)</p><p>Islam Makhachev (UFC)</p></section>`).map(normalizeManagementName);
  assert.deepEqual(names.sort(),['islam makhachev','kayla harrison','khabib nurmagomedov'].sort());
});

test('small explicit aliases fix source spelling without fuzzy identity guesses',()=>{
  const aliases={'bia mesquita':'Beatriz Mesquita','sodiq yusuf':'Sodiq Yusuff'};
  assert.equal(applyManagementAliases('Bia Mesquita',aliases),'Beatriz Mesquita');
  assert.equal(applyManagementAliases('Unknown Prospect',aliases),'Unknown Prospect');
});


test('source-specific First Round parser preserves UFC PFL and regional fighter templates only',()=>{
  const source=MANAGEMENT_SOURCES.find(row=>row.slug==='first-round-management');
  const html='<main><h6>Ilia Topuria</h6><h6 class="posts__title">Gable Steveson Beats Anthony Cassioppi at RAF 12</h6><span class="fname">Lydia Warren</span><span class="location">New Mexico, USA</span><h4>Mission Statement</h4></main>';
  assert.deepEqual(parseManagementRoster(html,source),['Ilia Topuria','Lydia Warren']);
});

test('source-specific Ruby parser reads individual image titles instead of merged card text',()=>{
  const source=MANAGEMENT_SOURCES.find(row=>row.slug==='ruby-sports-entertainment');
  const html='<main><div class="image-title-wrapper">Gustavo Lopez Al Matavao Niklas Stolze</div><div class="image-title sqs-dynamic-text">Gustavo Lopez</div><div class="image-title sqs-dynamic-text">Al Matavao</div><div class="image-title sqs-dynamic-text">Niklas Stolze</div></main>';
  assert.deepEqual(parseManagementRoster(html,source),['Gustavo Lopez','Al Matavao','Niklas Stolze']);
});

test('source-specific AK parser is bounded to the official Our Fighters section',()=>{
  const source=MANAGEMENT_SOURCES.find(row=>row.slug==='ak-fighter-management');
  const html='<main><h3>Fight Bookings</h3><h2>Our Fighters</h2><h3 class="roster-category">Signed Fighters</h3><h3>Mick Parkin</h3><h3>Phil De Fries</h3><h3 class="roster-category">Looking for Opportunities</h3><h3>Andrew Fisher</h3><h2>Apply to Be Talent</h2><h3>Application Received</h3></main>';
  assert.deepEqual(parseManagementRoster(html,source),['Mick Parkin','Phil De Fries','Andrew Fisher']);
});

test('source-aware parser extracts only official roster elements for representative templates',()=>{
  const cases=[
    ['fair-play-mma','<h4 class="w-person-name">Mario Pinto</h4><h4>Contact Us</h4>',['Mario Pinto']],
    ['tam-global','<h4 class="sc_team_item_title trx_addons_hover_title">Myktybek Orolbai</h4><h1>Latest News</h1>',['Myktybek Orolbai']],
    ['magnar-sports-entertainment','<a class="athlete-card"><h3>Damir Tolenov</h3><span>13-1</span></a><h4>Follow Us</h4>',['Damir Tolenov']],
    ['galaktik-sports','<a class="fcard"><img alt="DZHAMALUDIN ALIEV"></a><div class="service-title">FULL SUPPORT</div>',['DZHAMALUDIN ALIEV']],
    ['goat-worldwide','<div class="grid__item medium-up--one-third text-center"><h3>"PEREGRINO"</h3><div class="rte-setting text-spacing">JOILTON LUTTERBACH</div></div><h2>BOOK A FIGHTER</h2>',['JOILTON LUTTERBACH']],
    ['artnox-fight-sport','<h3 class="artnox-fighter-name-gradient">IWO BARANIEWSKI</h3><h3 class="roster-name">Marcin Wójcik</h3><div class="fighter-stat-box">REKORD 9-0</div>',['IWO BARANIEWSKI','Marcin Wójcik']],
    ['dominance-mma','<div class="spectra-image-gallery__media-thumbnail-caption">Yana Kunitskaya (UFC)</div><h4>Recent Posts</h4>',['Yana Kunitskaya']],
    ['iridium-sports-agency','<img class="gallery-item" alt="Khoas Williams"><span>top of page</span>',['Khoas Williams']]
  ];
  for(const [slug,html,expected] of cases){
    const source=MANAGEMENT_SOURCES.find(row=>row.slug===slug);
    assert.deepEqual(parseManagementRoster(html,source),expected,slug);
  }
});

test('management sync always supplies source metadata to roster extraction',()=>{
  const source=fs.readFileSync('scripts/sync-management.mjs','utf8');
  assert.match(source,/parseManagementRoster\(html,agency\)/);
});


test('Latin compatibility lookup keys are deterministic exact alternatives, not fuzzy matching',()=>{
  assert.equal(foldManagementLatinCompatibility('Rafał Haratyk'),'Rafal Haratyk');
  assert.equal(foldManagementLatinCompatibility('Łukasz Rajewski'),'Lukasz Rajewski');
  assert.equal(foldManagementLatinCompatibility('Søren Fighter'),'Soren Fighter');
  assert.deepEqual(managementLookupKeys('Rafał Haratyk'),['rafa haratyk','rafal haratyk']);
  assert.deepEqual(managementLookupKeys('Jon Jones'),['jon jones']);
});

test('management sync unions deterministic lookup keys and still requires one exact warehouse identity',()=>{
  const source=fs.readFileSync('scripts/sync-management.mjs','utf8');
  assert.match(source,/deduped\.flatMap\(row=>row\.lookup_keys\|\|\[row\.normalized_name\]\)/);
  assert.match(source,/const hitMap=new Map\(\)/);
  assert.match(source,/for\(const key of row\.lookup_keys\|\|\[row\.normalized_name\]\)/);
  assert.match(source,/if\(hits\.length===1\)matchedPreConflict\.push/);
  assert.match(source,/else if\(hits\.length>1\)ambiguous\.push/);
  assert.doesNotMatch(source,/levenshtein|jaro|similarity|fuzzy/i);
});

test('management sync rechecks cross-agency conflicts after resolving exact fighter identity',()=>{
  const source=fs.readFileSync('scripts/sync-management.mjs','utf8');
  assert.match(source,/const resolvedClaims=new Map\(\)/);
  assert.match(source,/row\.profile\.source_key\+'\:'\+row\.profile\.source_fighter_id/);
  assert.match(source,/resolvedClaims\.get\(key\)\.add\(row\.agency_slug\)/);
  assert.match(source,/const resolvedConflictIds=new Set/);
  assert.match(source,/const matched=matchedPreConflict\.filter\(row=>!resolvedConflictIds\.has/);
  assert.match(source,/resolved_identity_conflicts/);
});


test('KOREPS parser reads linked athlete name cards instead of page navigation',()=>{
  const source=MANAGEMENT_SOURCES.find(row=>row.slug==='knock-out-representation');
  const html='<main><h2>Athletes</h2><h2>Our Athletes</h2><h1><a href="/aljamain-sterling/">Aljamain Sterling</a></h1><h1><a href="/merab-dvalishvili/">Merab Dvalishvili</a></h1><h1><a href="/renato-moicano/">Renato Moicano</a></h1><footer><h1><a href="/contact/">Contact Us</a></h1></footer></main>';
  assert.deepEqual(parseManagementRoster(html,source),['Aljamain Sterling','Merab Dvalishvili','Renato Moicano']);
});

test('Gladiator parser is bounded to the official roster section',()=>{
  const source=MANAGEMENT_SOURCES.find(row=>row.slug==='gladiator-management-agency');
  const html='<main><h2>Common Questions</h2><h3>Will you help me get fights?</h3><h1>The Gladiators</h1><h3>Rafael Carvalho</h3><h3>Vanessa Melo</h3><h3>Elaman Sayassatov</h3><h2>CONTACT US</h2><h3>Contact Us</h3></main>';
  assert.deepEqual(parseManagementRoster(html,source),['Rafael Carvalho','Vanessa Melo','Elaman Sayassatov']);
});

test('wave 5 management sources are official public roster evidence only',()=>{
  const koreps=MANAGEMENT_SOURCES.find(row=>row.slug==='knock-out-representation');
  const gladiator=MANAGEMENT_SOURCES.find(row=>row.slug==='gladiator-management-agency');
  assert.deepEqual(koreps.rosterSelectors,['h1 a']);
  assert.deepEqual(gladiator.rosterSection,{start:'The Gladiators',end:'CONTACT US',selector:'h3'});
  assert.ok(koreps.profileUrls.every(url=>new URL(url).hostname==='www.koreps.com'));
  assert.ok(gladiator.profileUrls.every(url=>new URL(url).hostname==='www.gladiatormgmtagency.com'));
});


test('HD Global parser is bounded to the current featured MMA roster section',()=>{
  const source=MANAGEMENT_SOURCES.find(row=>row.slug==='hd-global-athlete-management');
  const html='<main><h2>The HD Global Athlete Management Roster</h2><h3>Dakota Ditcheva</h3><p>PFL</p><h3>Shanelle Dyer</h3><p>UFC</p><h3>Melissa Mullins</h3><p>UFC</p><h3>Connor Hughes</h3><p>PFL</p><h2>Why Choose Us</h2><h3>A Team of Passionate Individuals</h3></main>';
  assert.deepEqual(parseManagementRoster(html,source),['Dakota Ditcheva','Shanelle Dyer','Melissa Mullins','Connor Hughes']);
});

test('3MGT parser reads only managed athlete headings from the official athlete section',()=>{
  const source=MANAGEMENT_SOURCES.find(row=>row.slug==='3mgt-sports-media-management');
  const html='<main><h2>Our Athletes</h2><h5>Islam Dulatov</h5><p>UFC Fighter - islam@3mgt.de</p><h5>Losene Keita</h5><p>MMA Champion - keita@3mgt.de</p><h5>Kerim Engizek</h5><p>MMA Champion - kerim@3mgt.de</p><h2>Case Studie</h2><h5>Kerim Engizek</h5></main>';
  assert.deepEqual(parseManagementRoster(html,source),['Islam Dulatov','Losene Keita','Kerim Engizek']);
});

test('Burns parser keeps the named managed athlete and rejects site furniture',()=>{
  const source=MANAGEMENT_SOURCES.find(row=>row.slug==='burns-mma-agency');
  const html='<main><h4>Brands we build.</h4><h3>Rafael "Bipolar" Tobias</h3><p>UFC Fighter</p><h3>More Athletes soon</h3><h3>PARTNERS</h3><h3>Build something that lasts.</h3></main>';
  assert.deepEqual(parseManagementRoster(html,source),['Rafael "Bipolar" Tobias']);
});

test('wave 6 roster sections fail closed when the expected boundary is absent',()=>{
  for(const slug of ['hd-global-athlete-management','3mgt-sports-media-management','burns-mma-agency']){
    const source=MANAGEMENT_SOURCES.find(row=>row.slug===slug);
    assert.deepEqual(parseManagementRoster('<main><h3>Random Fighter Name</h3><p>Contact us today</p></main>',source),[],slug);
  }
});
