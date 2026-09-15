import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal,normalizeContractText,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='khan-sports-mma');

test('wave 9 registers Sports Kyunghyang as a Korean-language reputable-trade-reporting source',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Sports Kyunghyang');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.promotionSlug,null);
  assert.equal(source.kind,'html');
  assert.equal(source.host,'sports.khan.co.kr');
  assert.equal(source.lang,'ko');
  assert.equal(source.titleSignalOnly,true);
});

test('English, Polish and Russian sources are unaffected by adding Korean: lang dispatch is additive',()=>{
  assert.equal(hasContractSignal('Adam Darby signs a UFC contract'),true);
  assert.equal(hasContractSignal('Były mistrz KSW podpisał kontrakt z UFC.','pl'),true);
  assert.equal(hasContractSignal('Джастин Гейджи подписал контракт с UFC','ru'),true);
});

test('a curated fighter-alias table resolves known Korean fighters to their Sherdog/UFC-catalogued Western spelling',()=>{
  // Korean fighter names are catalogued in the database in Western given-name-first order with
  // idiosyncratic (non-Revised-Romanization) spelling -- e.g. Sherdog lists 정찬성 as "Chan Sung Jung",
  // not the algorithmic RR form "Jeong Chan-seong". A generic transliteration would not recover this,
  // so this is resolved via a small verified curated table instead, same idea as Japanese will need.
  assert.equal(normalizeContractText('정찬성'),normalizeContractText('Chan Sung Jung'));
  assert.equal(normalizeContractText('최두호'),normalizeContractText('Doo Ho Choi'));
  assert.equal(normalizeContractText('강경호'),normalizeContractText('Kyung Ho Kang'));
});

test('a Hangul name not in the curated alias table still transliterates algorithmically rather than vanishing',()=>{
  // Generic Hangul (e.g. an opponent's name, or a fighter not yet in the curated table) still survives
  // normalization as a deterministic Revised-Romanization-style string instead of being stripped to
  // nothing -- it just won't happen to match a Western-spelled profile name, which is a known, accepted
  // gap (same as the Cyrillic phonetic-respelling gap), not a crash or silent data loss.
  assert.equal(normalizeContractText('가나다'),'ganada');
});

test('real, verified Korean contract vocabulary is recognized: signing, extension, free agency, release, and declined-extension headlines',()=>{
  // Vocabulary confirmed live: "재계약"/Pereira mega-extension (v.daum.net), "자유계약"/McGregor declines
  // extension (heraldk.com via Daum), "방출"/UFC releasing fighters (mt.co.kr, sports.news.nate.com),
  // "계약해지"/Aspinall termination demand (biz.heraldcorp.com), and the standard "계약 체결" signing
  // construction (kr.ufc.com sponsorship-deal headline confirms the phrase is real Korean usage).
  assert.equal(hasContractSignal('최두호 UFC와 계약 체결','ko'),true);
  assert.deepEqual(detectContractSignal('최두호 UFC와 계약 체결','ko'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion('최두호 UFC와 계약 체결',null,'ko'),'ufc');

  assert.equal(hasContractSignal('정찬성 UFC와 재계약','ko'),true);
  assert.deepEqual(detectContractSignal('정찬성 UFC와 재계약','ko'),{eventType:'extension',status:'under_contract'});
  assert.equal(detectContractPromotion('정찬성 UFC와 재계약',null,'ko'),'ufc');

  assert.equal(hasContractSignal('김동현 UFC 자유계약 신분','ko'),true);
  assert.deepEqual(detectContractSignal('김동현 UFC 자유계약 신분','ko'),{eventType:'free_agency',status:'free_agent'});

  assert.equal(hasContractSignal('강경호 UFC서 방출','ko'),true);
  assert.deepEqual(detectContractSignal('강경호 UFC서 방출','ko'),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion('강경호 UFC서 방출',null,'ko'),'ufc');

  assert.equal(hasContractSignal('박준용 UFC에 계약해지 요구','ko'),true);
  assert.deepEqual(detectContractSignal('박준용 UFC에 계약해지 요구','ko'),{eventType:'expiration',status:'expired'});
  assert.equal(detectContractPromotion('박준용 UFC에 계약해지 요구',null,'ko'),'ufc');

  assert.equal(hasContractSignal('최승우, UFC와 계약 연장 거부','ko'),true);
  assert.deepEqual(detectContractSignal('최승우, UFC와 계약 연장 거부','ko'),{eventType:'status_update',status:'unknown'});
});

test('Korean particle suffixes attached directly to a contract-vocabulary word do not break detection',()=>{
  // Korean postpositions attach to the preceding word with no space (e.g. 체결 + 에 -> 체결에), unlike
  // English or Polish/Russian case endings which still leave a word boundary. Detection must not require
  // a boundary immediately after the vocabulary root.
  const text='옥타곤 컴백을 앞둔 최두호가 UFC와 새로운 계약 체결에 성공했다고 15일 밝혔다.';
  assert.equal(hasContractSignal(text,'ko'),true);
  assert.deepEqual(detectContractSignal(text,'ko'),{eventType:'signing',status:'under_contract'});
});

test('Korean event-recap and sponsorship-only coverage does not falsely trigger a contract signal',()=>{
  assert.equal(hasContractSignal('최두호, 핏불 피본다!…8년만에 랭킹 재진입 도전','ko'),false);
  assert.equal(hasContractSignal('UFC-세븐일레븐 스폰서십 계약 체결','ko'),false);
});

test('Sports Kyunghyang listing only surfaces same-host article links carrying a Korean contract signal',()=>{
  const html=`<main>
    <a href="https://sports.khan.co.kr/article/202609151200001">최두호, UFC와 계약 체결</a>
    <a href="https://sports.khan.co.kr/article/202609151200002">최두호, 핏불 피본다!…8년만에 랭킹 재진입 도전</a>
    <a href="https://example.com/fake">Fake Fighter Signs UFC contract</a>
  </main>`;
  const rows=parseContractListing(html,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'최두호, UFC와 계약 체결');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='sports.khan.co.kr'));
});

test('a Korean-reported UFC signing queues a UFC candidate with exact identity, resolved via the curated alias table',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'2001',fighter_name:'Doo Ho Choi'}];
  const rows=candidateRows(
    {title:'최두호, UFC와 계약 체결',url:'https://sports.khan.co.kr/article/202609151200001',publishedAt:'2026-09-15'},
    source,
    '옥타곤 컴백을 앞둔 최두호가 UFC와 새로운 계약 체결에 성공했다고 15일 밝혔다.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Doo Ho Choi');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'signing');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('Korean candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'2',fighter_name:'Someone Else'}];
  const rows=candidateRows(
    {title:'최두호, UFC와 계약 체결',url:'https://sports.khan.co.kr/article/202609151200001',publishedAt:'2026-09-15'},
    source,
    '최두호가 UFC와 계약 체결에 성공했다.',
    profiles
  );
  assert.equal(rows.length,0);
});
