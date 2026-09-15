import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal,normalizeContractText,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='inthecage-pl-rss');

test('wave 7 registers InTheCage.pl as a Polish-language reputable-trade-reporting source',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'InTheCage.pl');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.promotionSlug,null);
  assert.equal(source.kind,'rss');
  assert.equal(source.host,'inthecage.pl');
  assert.equal(source.lang,'pl');
});

test('English sources are unaffected: lang defaults to en and existing behavior is unchanged',()=>{
  assert.equal(hasContractSignal('Adam Darby signs a UFC contract'),true);
  assert.equal(hasContractSignal('Adam Darby signs a UFC contract','en'),true);
  assert.deepEqual(detectContractSignal('Michael Page completes his UFC contract'),{eventType:'expiration',status:'expired'});
  assert.equal(detectContractPromotion('Adam Darby has signed with the UFC after his latest victory.'),'ufc');
});

test('Polish ł is folded to l deterministically (not stripped), same mechanism already used for management names',()=>{
  assert.equal(normalizeContractText('podpisał kontrakt'),'podpisal kontrakt');
  assert.equal(normalizeContractText('przedłużył kontrakt'),'przedluzyl kontrakt');
});

test('real, verified Polish contract-signing and extension headlines are recognized',()=>{
  // Headlines confirmed live from sportowefakty.wp.pl, mmarocks.pl and inthecage.pl reporting on real KSW/UFC transfers.
  assert.equal(hasContractSignal('Były mistrz KSW podpisał kontrakt z UFC. Od razu dostał walkę wieczoru','pl'),true);
  assert.deepEqual(detectContractSignal('Były mistrz KSW podpisał kontrakt z UFC. Od razu dostał walkę wieczoru','pl'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion('Były mistrz KSW podpisał kontrakt z UFC.',null,'pl'),'ufc');

  assert.equal(hasContractSignal('Mariusz Pudzianowski przedłużył kontrakt z Federacją KSW!','pl'),true);
  assert.deepEqual(detectContractSignal('Mariusz Pudzianowski przedłużył kontrakt z Federacją KSW!','pl'),{eventType:'extension',status:'under_contract'});
  assert.equal(detectContractPromotion('Mariusz Pudzianowski przedłużył kontrakt z Federacją KSW!',null,'pl'),'ksw');

  assert.equal(hasContractSignal('Rory MacDonald, czołowy wolny agent MMA podpisuje kontrakt z Professional Fighters League','pl'),true);
  assert.deepEqual(detectContractSignal('Rory MacDonald, czołowy wolny agent MMA podpisuje kontrakt z Professional Fighters League','pl'),{eventType:'free_agency',status:'free_agent'});
});

test('a Polish "parted ways with X" headline is classified as a release, matching the English release/part-ways pattern',()=>{
  const text='Ivan Erslan rozstał się z KSW po latach w organizacji';
  assert.deepEqual(detectContractSignal(text,'pl'),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion(text,null,'pl'),'ksw');
});

test('like English, a sentence naming two promotions resolves to whichever pattern matches first -- an existing system-wide approximation the mandatory human review queue accounts for, not a Polish-specific gap',()=>{
  const plText='Ivan Erslan rozstał się z KSW - były pretendent do pasa podpisał kontrakt z organizacją UFC';
  const enText='Fighter parts ways with Cage Warriors after signing a contract with the UFC.';
  assert.equal(detectContractPromotion(plText,null,'pl'),'ufc');
  assert.equal(detectContractPromotion(enText,null,'en'),'ufc');
});

test('Polish event-preview and broadcast-logistics text does not falsely trigger a contract signal',()=>{
  assert.equal(hasContractSignal('XTB KSW 121 gdzie oglądać transmisję','pl'),false);
  assert.equal(hasContractSignal('Ważenie i strefa fana przed galą XTB KSW 121 w Libercu','pl'),false);
});

test('InTheCage.pl RSS only surfaces same-host article links carrying a Polish contract signal',()=>{
  const xml=`<?xml version="1.0"?><rss><channel>
    <item><title>Roberto Soldić oficjalnie w UFC! Były podwójny mistrz KSW podpisał kontrakt</title><link>https://inthecage.pl/roberto-soldic-oficjalnie-w-ufc-byly-podwojny-mistrz-ksw-podpisal-kontrakt/</link><description>Chorwat podpisał kontrakt z UFC.</description><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>Kogo zobaczymy na XTB KSW 121 w Libercu</title><link>https://inthecage.pl/kogo-zobaczymy-na-xtb-ksw-121-w-libercu-przeglad-debiutantow/</link><description>Przegląd debiutantów przed galą.</description></item>
    <item><title>Fighter signs UFC contract</title><link>https://example.com/fake-signing/</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Roberto Soldić oficjalnie w UFC! Były podwójny mistrz KSW podpisał kontrakt');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='inthecage.pl'));
});

test('a Polish-reported UFC signing queues a UFC candidate with exact identity, same as English sources',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'901',fighter_name:'Roberto Soldic'}];
  const rows=candidateRows(
    {title:'Roberto Soldić oficjalnie w UFC',url:'https://inthecage.pl/roberto-soldic-oficjalnie-w-ufc/',publishedAt:'2026-08-01'},
    source,
    'Roberto Soldić oficjalnie zawodnikiem UFC. Były podwójny mistrz KSW podpisał kontrakt z organizacją UFC i zadebiutuje w Las Vegas.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Roberto Soldic');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'signing');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('Polish candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'1',fighter_name:'Someone Else'}];
  const rows=candidateRows(
    {title:'Roberto Soldić oficjalnie w UFC',url:'https://inthecage.pl/roberto-soldic-oficjalnie-w-ufc/',publishedAt:'2026-08-01'},
    source,
    'Roberto Soldić podpisał kontrakt z organizacją UFC.',
    profiles
  );
  assert.equal(rows.length,0);
});
