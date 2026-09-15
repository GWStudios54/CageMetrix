import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal,normalizeContractText,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='mmaplanet-jp-rss');

test('wave 10 registers MMAPLANET as a Japanese-language reputable-trade-reporting source',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'MMAPLANET');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.promotionSlug,null);
  assert.equal(source.kind,'rss');
  assert.equal(source.host,'mmaplanet.jp');
  assert.equal(source.lang,'ja');
});

test('English, Polish, Russian and Korean sources are unaffected by adding Japanese: lang dispatch is additive',()=>{
  assert.equal(hasContractSignal('Adam Darby signs a UFC contract'),true);
  assert.equal(hasContractSignal('Były mistrz KSW podpisał kontrakt z UFC.','pl'),true);
  assert.equal(hasContractSignal('Джастин Гейджи подписал контракт с UFC','ru'),true);
  assert.equal(hasContractSignal('최두호 UFC와 계약 체결','ko'),true);
});

test('a curated fighter-alias table resolves known Japanese fighters to their Sherdog-catalogued Western spelling',()=>{
  // Kanji have no algorithmic transliteration at all (readings are ambiguous without a dictionary,
  // unlike Hangul which decomposes mathematically), so this is even more clearly a curated-lookup
  // problem than Korean was. Sherdog/Wikipedia-confirmed spellings, given-name-first Western order.
  assert.equal(normalizeContractText('堀口恭司'),normalizeContractText('Kyoji Horiguchi'));
  assert.equal(normalizeContractText('朝倉海'),normalizeContractText('Kai Asakura'));
  assert.equal(normalizeContractText('平良達郎'),normalizeContractText('Tatsuro Taira'));
});

test('a kanji name not in the curated alias table is not silently invented as a match',()=>{
  // Unlike Cyrillic/Hangul, there is no fallback algorithmic transliteration for kanji here -- a name
  // outside the curated table simply does not resolve to any Latin string, so it can never accidentally
  // collide with an unrelated profile. This is the safe failure mode: no candidate, not a wrong one.
  assert.equal(normalizeContractText('田中太郎'),'');
});

test('real, verified Japanese contract vocabulary is recognized: signing, extension, expiration, release and ambiguous transfer',()=>{
  // Vocabulary confirmed live: "契約更新"/RIZIN-Shaidullaev renewal (gonkaku.jp via Yahoo), "契約は満了した"/
  // UFC-Nakai contract completion (gonkaku.jp), "契約を更新せず...移籍"/Horiguchi's real UFC-to-RIZIN move,
  // and "契約解除" confirmed as real combat-sports usage (a K-1 contract-termination blog title).
  assert.equal(hasContractSignal('堀口恭司、UFCとの契約は満了した','ja'),true);
  assert.deepEqual(detectContractSignal('堀口恭司、UFCとの契約は満了した','ja'),{eventType:'expiration',status:'expired'});
  assert.equal(detectContractPromotion('堀口恭司、UFCとの契約は満了した',null,'ja'),'ufc');

  assert.equal(hasContractSignal('朝倉海、RIZINとの契約を更新','ja'),true);
  assert.deepEqual(detectContractSignal('朝倉海、RIZINとの契約を更新','ja'),{eventType:'extension',status:'under_contract'});
  assert.equal(detectContractPromotion('朝倉海、RIZINとの契約を更新',null,'ja'),'rizin');
  // The real verified headline form omits the object particle (a compound-noun headline style).
  assert.deepEqual(detectContractSignal('RIZINと契約更新へ','ja'),{eventType:'extension',status:'under_contract'});

  assert.equal(hasContractSignal('平良達郎がUFCと契約を結んだ','ja'),true);
  assert.deepEqual(detectContractSignal('平良達郎がUFCと契約を結んだ','ja'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion('平良達郎がUFCと契約を結んだ',null,'ja'),'ufc');

  assert.equal(hasContractSignal('朝倉未来、RIZINとの契約解除','ja'),true);
  assert.deepEqual(detectContractSignal('朝倉未来、RIZINとの契約解除','ja'),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion('朝倉未来、RIZINとの契約解除',null,'ja'),'rizin');

  assert.equal(hasContractSignal('堀口恭司、UFC契約を更新せず、RIZINへ移籍','ja'),true);
  assert.deepEqual(detectContractSignal('堀口恭司、UFC契約を更新せず、RIZINへ移籍','ja'),{eventType:'expiration',status:'expired'});
});

test('a Japanese-specific ambiguity of 契約 ("contract weight" for a catchweight bout) does not falsely trigger a contract signal',()=>{
  // Found by testing against the real live MMAPLANET feed: a routine fight-result recap described its
  // bout as "63キロ契約" (63kg contract weight / catchweight), which is not a promotional-contract signal
  // at all. This is the Japanese equivalent of the sponsorship/broadcast-rights exclusions in every
  // other language here.
  assert.equal(hasContractSignal('＜63キロ契約／5分2R＞ 髙尾凌生（日本）Def. NAOTA（日本）','ja'),false);
});

test('Japanese fight-recap and sponsorship/broadcast coverage does not falsely trigger a contract signal',()=>{
  assert.equal(hasContractSignal('扇久保博正、K-1王者に挑戦','ja'),false);
  assert.equal(hasContractSignal('UFCとのスポンサー契約を発表','ja'),false);
  assert.equal(hasContractSignal('UFCの放送権を獲得','ja'),false);
});

test('MMAPLANET RSS only surfaces same-host article links carrying a Japanese contract signal',()=>{
  const xml=`<?xml version="1.0" encoding="UTF-8"?><rss><channel>
    <item><title>平良達郎がUFCと契約を結んだ</title><link>https://mmaplanet.jp/300001</link><description>フライ級の平良達郎がUFCと正式に契約を結んだ。</description><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>【DEEP133】大成が関節蹴りでシビサイを秒殺</title><link>https://mmaplanet.jp/238356</link><description>メガトン級王座防衛戦の結果。</description></item>
    <item><title>Fighter signs UFC contract</title><link>https://example.com/fake</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'平良達郎がUFCと契約を結んだ');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='mmaplanet.jp'));
});

test('a Japanese-reported UFC signing queues a UFC candidate with exact identity, resolved via the curated alias table',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'3001',fighter_name:'Tatsuro Taira'}];
  const rows=candidateRows(
    {title:'平良達郎がUFCと契約を結んだ',url:'https://mmaplanet.jp/300001',publishedAt:'2026-09-15'},
    source,
    'フライ級の平良達郎がUFCと正式に契約を結んだことがわかった。今後の対戦相手は未定。',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Tatsuro Taira');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'signing');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('Japanese candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'2',fighter_name:'Someone Else'}];
  const rows=candidateRows(
    {title:'平良達郎がUFCと契約を結んだ',url:'https://mmaplanet.jp/300001',publishedAt:'2026-09-15'},
    source,
    '平良達郎がUFCと契約を結んだ。',
    profiles
  );
  assert.equal(rows.length,0);
});
