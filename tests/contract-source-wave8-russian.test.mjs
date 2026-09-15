import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal,normalizeContractText,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='valetudo-ru-rss');

test('wave 8 registers Valetudo.Ru as a Russian-language reputable-trade-reporting source',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Valetudo.Ru');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.promotionSlug,null);
  assert.equal(source.kind,'rss');
  assert.equal(source.host,'valetudo.ru');
  assert.equal(source.lang,'ru');
});

test('English and Polish sources are unaffected by adding Russian: lang dispatch is additive',()=>{
  assert.equal(hasContractSignal('Adam Darby signs a UFC contract'),true);
  assert.equal(hasContractSignal('Były mistrz KSW podpisał kontrakt z UFC.','pl'),true);
});

test('Cyrillic names transliterate deterministically to the same Latin spelling already used in English/Sherdog records',()=>{
  // "Petr Yan" already exists in the English/Sherdog-sourced profile records; the transliteration
  // of the Cyrillic byline must land on the exact same normalized string so identity matching stays exact, not fuzzy.
  assert.equal(normalizeContractText('Пётр Ян'),normalizeContractText('Petr Yan'));
  assert.equal(normalizeContractText('Магомед Анкалаев'),normalizeContractText('Magomed Ankalaev'));
  assert.equal(normalizeContractText('Усман Нурмагомедов'),normalizeContractText('Usman Nurmagomedov'));
});

test('real, verified Russian contract-signing, extension and free-agency headlines are recognized',()=>{
  // Headlines confirmed live on valetudo.ru (Justin Gaethje, Pereira, Hector Lombard UFC signings) and
  // representative of its regular MMA contract-news coverage.
  assert.equal(hasContractSignal('Джастин Гейджи подписал контракт с UFC','ru'),true);
  assert.deepEqual(detectContractSignal('Джастин Гейджи подписал контракт с UFC','ru'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion('Джастин Гейджи подписал контракт с UFC',null,'ru'),'ufc');

  assert.equal(hasContractSignal('Перейра подписал новый контракт с UFC на 8 боев','ru'),true);
  assert.deepEqual(detectContractSignal('Перейра подписал новый контракт с UFC на 8 боев','ru'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion('Перейра подписал новый контракт с UFC на 8 боев',null,'ru'),'ufc');

  assert.equal(hasContractSignal('Пётр Ян продлил контракт с UFC на три года','ru'),true);
  assert.deepEqual(detectContractSignal('Пётр Ян продлил контракт с UFC на три года','ru'),{eventType:'extension',status:'under_contract'});
  assert.equal(detectContractPromotion('Пётр Ян продлил контракт с UFC на три года',null,'ru'),'ufc');

  assert.equal(hasContractSignal('Усман Нурмагомедов стал свободным агентом','ru'),true);
  assert.deepEqual(detectContractSignal('Усман Нурмагомедов стал свободным агентом','ru'),{eventType:'free_agency',status:'free_agent'});
});

test('a Russian "parted ways with" headline is classified as a release',()=>{
  const text='Магомед Анкалаев расстался с командой после провала на UFC';
  assert.deepEqual(detectContractSignal(text,'ru'),{eventType:'release',status:'released'});
});

test('Russian title-vacating and event-recap coverage does not falsely trigger a contract signal',()=>{
  // Real valetudo.ru headlines from the live feed on 2026-09-15, none of which are contract news.
  assert.equal(hasContractSignal('Официально! Том Аспиналл освободил титул UFC','ru'),false);
  assert.equal(hasContractSignal('Жан Силва задушил Хосе Дельгадо одной рукой в главном бою Noche UFC 4','ru'),false);
});

test('Valetudo.Ru RSS only surfaces same-host article links carrying a Russian contract signal',()=>{
  const xml=`<?xml version="1.0" encoding="utf-8"?><rss><channel>
    <item><title>Джастин Гейджи подписал контракт с UFC</title><link>https://valetudo.ru/mma/news/justin-gaethje-podpisal-kontrakt-s-ufc</link><description>Бывший чемпион WSOF официально объявил о подписании контракта с UFC.</description><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>Официально! Том Аспиналл освободил титул UFC</title><link>https://valetudo.ru/mma/news/ofitsialno-tom-aspinall-osvobodil-titul-ufc</link><description>Тяжеловес опубликовал обращение о добровольной сдаче чемпионского пояса.</description></item>
    <item><title>Justin Gaethje signs UFC contract</title><link>https://example.com/fake-signing/</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Джастин Гейджи подписал контракт с UFC');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='valetudo.ru'));
});

test('a Russian-reported UFC contract extension queues a UFC candidate with exact identity, same as English/Polish sources',()=>{
  // A CIS-origin fighter, not a phonetically-respelled foreign name: this is the case deterministic
  // Cyrillic transliteration is actually meant to solve, and it round-trips exactly (see the
  // transliteration test above). A phonetic Russian respelling of a non-Russian name such as
  // "Гейджи" for "Gaethje" will NOT round-trip through letter transliteration -- that is a known,
  // accepted gap (the mandatory human review queue, and separately the needs_identity path, cover it),
  // not something this pass claims to solve.
  const profiles=[{source_key:'mma',source_fighter_id:'1001',fighter_name:'Petr Yan'}];
  const rows=candidateRows(
    {title:'Пётр Ян продлил контракт с UFC',url:'https://valetudo.ru/mma/news/petr-yan-prodlil-kontrakt-s-ufc',publishedAt:'2026-09-15'},
    source,
    'Чемпион UFC Пётр Ян продлил контракт с UFC на три года после победной защиты титула.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Petr Yan');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'extension');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('Russian candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'2',fighter_name:'Someone Else'}];
  const rows=candidateRows(
    {title:'Пётр Ян продлил контракт с UFC',url:'https://valetudo.ru/mma/news/petr-yan-prodlil-kontrakt-s-ufc',publishedAt:'2026-09-15'},
    source,
    'Пётр Ян продлил контракт с UFC.',
    profiles
  );
  assert.equal(rows.length,0);
});

test('a phonetic Russian respelling of a non-Russian fighter name is a known, accepted gap: it does not round-trip through letter transliteration',()=>{
  // Documents the limitation found above -- "Гейджи" is how Russian press phonetically renders the
  // pronunciation of "Gaethje", not a letter-for-letter transliteration, so it cannot deterministically
  // recover the original Latin spelling. This is why the fighter database's exact-match policy is
  // still safe here: a mismatch produces no candidate rather than a wrong one.
  assert.notEqual(normalizeContractText('Гейджи'),normalizeContractText('Gaethje'));
});
