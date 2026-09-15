import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal,normalizeContractText,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='ufc-fr-rss');

test('wave 13 registers UFC Fans as a French-language reputable-trade-reporting source',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'UFC Fans');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.promotionSlug,null);
  assert.equal(source.kind,'rss');
  assert.equal(source.host,'www.ufc-fr.com');
  assert.equal(source.lang,'fr');
});

test('other languages are unaffected by adding French: lang dispatch is additive',()=>{
  assert.equal(hasContractSignal('Adam Darby signs a UFC contract'),true);
  assert.equal(hasContractSignal('Charles Oliveira firmó un nuevo contrato con la UFC','es'),true);
});

test('French diacritics (é, è, à) fold correctly with zero new normalization code, same as Spanish/Portuguese',()=>{
  assert.equal(normalizeContractText('libéré'),'libere');
  assert.equal(normalizeContractText("l'UFC"),"l'ufc");
});

test('real, verified French-language contract vocabulary is recognized across signing, extension, release and free agency',()=>{
  // Every phrase confirmed against real reporting from ufc-fr.com and actumma.com: a French DWCS
  // signing ("Un nouveau combattant français signe à l'UFC"), Fares Ziam's and Michael Page's real
  // extension coverage ("annonce prolonger avec l'UFC" / "souhaite prolonger son contrat"), and
  // Francis Ngannou's and Patricio Pitbull Freire's real release/free-agency coverage.
  assert.equal(hasContractSignal("Un nouveau combattant français signe à l'UFC",'fr'),true);
  assert.deepEqual(detectContractSignal("Un nouveau combattant français signe à l'UFC",'fr'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion("Un nouveau combattant français signe à l'UFC",null,'fr'),'ufc');

  assert.equal(hasContractSignal("Fares Ziam annonce prolonger avec l'UFC",'fr'),true);
  assert.deepEqual(detectContractSignal("Fares Ziam annonce prolonger avec l'UFC",'fr'),{eventType:'extension',status:'under_contract'});
  assert.equal(detectContractPromotion("Fares Ziam annonce prolonger avec l'UFC",null,'fr'),'ufc');

  assert.equal(hasContractSignal("Francis Ngannou libéré de son contrat avec l'UFC",'fr'),true);
  assert.deepEqual(detectContractSignal("Francis Ngannou libéré de son contrat avec l'UFC",'fr'),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion("Francis Ngannou libéré de son contrat avec l'UFC",null,'fr'),'ufc');

  assert.equal(hasContractSignal('Patricio Pitbull Freire libéré de son contrat avec le PFL et devient agent libre','fr'),true);
  assert.deepEqual(detectContractSignal('Patricio Pitbull Freire libéré de son contrat avec le PFL et devient agent libre','fr'),{eventType:'free_agency',status:'free_agent'});
  assert.equal(detectContractPromotion('Patricio Pitbull Freire libéré de son contrat avec le PFL et devient agent libre',null,'fr'),'pfl');
});

test('a broadcasting-rights extension ("prolonge ses droits") does not falsely trigger a contract signal',()=>{
  // Found by testing against the real live UFC Fans feed: RMC Sport (the French UFC broadcaster)
  // extending its TV rights uses the same verb ("prolonge") as a fighter contract extension, but
  // "ses droits" (its [broadcast] rights) is a distinct, non-fighter construction.
  assert.equal(hasContractSignal("RMC Sport prolonge ses droits de l'UFC pour 5 ans",'fr'),false);
});

test('French sponsorship coverage does not falsely trigger a contract signal',()=>{
  assert.equal(hasContractSignal("Annonce d'un partenariat avec une marque de vêtements",'fr'),false);
});

test('UFC Fans RSS only surfaces same-host article links carrying a French contract signal',()=>{
  const xml=`<?xml version="1.0" encoding="UTF-8"?><rss><channel>
    <item><title>Un nouveau combattant français signe à l'UFC</title><link>https://www.ufc-fr.com/nouveau-combattant-francais-signe-ufc-14999.html</link><description>Le combattant a signé un contrat avec l'UFC.</description><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>UFC 331 : Brian Ortega blessé, Renato Moicano déplacé</title><link>https://www.ufc-fr.com/ufc-331-brian-ortega-blesse-14541.html</link><description>Changement de card pour UFC 331.</description></item>
    <item><title>Fighter signs UFC contract</title><link>https://example.com/fake</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,"Un nouveau combattant français signe à l'UFC");
  assert.ok(rows.every(row=>new URL(row.url).hostname==='www.ufc-fr.com'));
});

test('a real feed quirk (leading whitespace and an undeclared media: namespace) does not break RSS parsing',()=>{
  // ufc-fr.com's actual live feed both starts with a stray newline before the XML declaration and
  // uses <media:content> without declaring xmlns:media -- both real authoring bugs in the feed, not
  // this pipeline's. JSDOM's strict XML parser rejects each outright; parseContractListing now
  // pre-cleans for both, verified here with a fixture reproducing them exactly.
  const xml=`\n<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
    <item><title>Un nouveau combattant français signe à l'UFC</title><link>https://www.ufc-fr.com/nouveau-combattant-francais-signe-ufc-14999.html</link><description>Le combattant a signé un contrat avec l'UFC.</description><media:content url="https://www.ufc-fr.com/photo.jpg" medium="image" /></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,"Un nouveau combattant français signe à l'UFC");
});

test('a French-reported UFC signing queues a UFC candidate with exact identity, same as every other source',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'8001',fighter_name:'Fares Ziam'}];
  const rows=candidateRows(
    {title:"Fares Ziam annonce prolonger avec l'UFC",url:'https://www.ufc-fr.com/fares-ziam-annonce-14999.html',publishedAt:'2026-09-15'},
    source,
    "Le combattant francais Fares Ziam a annonce prolonger son aventure avec l'UFC apres sa victoire.",
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Fares Ziam');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'extension');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('French candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'9',fighter_name:'Someone Else'}];
  const rows=candidateRows(
    {title:'x',url:'https://www.ufc-fr.com/x-1.html',publishedAt:'2026-09-15'},
    source,
    "Fares Ziam a signe un contrat avec l'UFC.",
    profiles
  );
  assert.equal(rows.length,0);
});
