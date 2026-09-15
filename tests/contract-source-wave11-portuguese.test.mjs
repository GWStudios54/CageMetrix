import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal,normalizeContractText,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='agfight-rss');

test('wave 11 registers Ag. Fight as a Portuguese-language reputable-trade-reporting source',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'Ag. Fight');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.promotionSlug,null);
  assert.equal(source.kind,'rss');
  assert.equal(source.host,'agfight.com');
  assert.equal(source.lang,'pt');
});

test('other languages are unaffected by adding Portuguese: lang dispatch is additive',()=>{
  assert.equal(hasContractSignal('Adam Darby signs a UFC contract'),true);
  assert.equal(hasContractSignal('Były mistrz KSW podpisał kontrakt z UFC.','pl'),true);
  assert.equal(hasContractSignal('平良達郎がUFCと契約を結んだ','ja'),true);
});

test('Portuguese diacritics (ã, ç, õ) fold correctly with zero new normalization code, unlike Polish/Cyrillic/Hangul/kanji',()=>{
  // Latin-script diacritics decompose cleanly through the existing NFKD pipeline -- this language needed
  // no transliteration engine or curated alias table at all, unlike every other language added this pass.
  assert.equal(normalizeContractText('renovação'),'renovacao');
  assert.equal(normalizeContractText('José'),normalizeContractText('Jose'));
});

test('real, verified Brazilian Portuguese contract vocabulary is recognized: signing, extension, expiration, release and free agency',()=>{
  // Every phrase confirmed against real 2024-2026 Brazilian MMA reporting (ESPN Brasil, Ag. Fight, Lance,
  // Terra, Metropoles, Sim Notícias): Kaik Brito's and Alex Poatan's real UFC signings, Raimundo Souza's
  // real signing, Poatan's real contract renewal, the real "UFC dispensa quatro lutadores... encerra
  // contratos" release wave, Matheus Nicolau's and Elizeu Zaleski's real releases, Brazilian fighters
  // going "sem contrato com o UFC", and Michael Page's real "virou free agent" (the English loanword is
  // itself the authentic Brazilian-press usage, not a translation gap).
  assert.equal(hasContractSignal('Kaik Brito assinou seu primeiro contrato com o UFC','pt'),true);
  assert.deepEqual(detectContractSignal('Kaik Brito assinou seu primeiro contrato com o UFC','pt'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion('Kaik Brito assinou seu primeiro contrato com o UFC',null,'pt'),'ufc');

  assert.equal(hasContractSignal('Raimundo Souza foi contratado pelo UFC em janeiro de 2026','pt'),true);
  assert.deepEqual(detectContractSignal('Raimundo Souza foi contratado pelo UFC em janeiro de 2026','pt'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion('Raimundo Souza foi contratado pelo UFC em janeiro de 2026',null,'pt'),'ufc');

  assert.equal(hasContractSignal('Brasileiro revela que renovou contrato com o UFC','pt'),true);
  assert.deepEqual(detectContractSignal('Brasileiro revela que renovou contrato com o UFC','pt'),{eventType:'extension',status:'under_contract'});
  assert.equal(detectContractPromotion('Brasileiro revela que renovou contrato com o UFC',null,'pt'),'ufc');

  assert.equal(hasContractSignal('UFC dispensa quatro lutadores brasileiros e encerra contratos','pt'),true);
  assert.deepEqual(detectContractSignal('UFC dispensa quatro lutadores brasileiros e encerra contratos','pt'),{eventType:'expiration',status:'expired'});
  assert.equal(detectContractPromotion('UFC dispensa quatro lutadores brasileiros e encerra contratos',null,'pt'),'ufc');

  assert.equal(hasContractSignal('Matheus Nicolau foi dispensado pelo UFC após três derrotas seguidas','pt'),true);
  assert.deepEqual(detectContractSignal('Matheus Nicolau foi dispensado pelo UFC após três derrotas seguidas','pt'),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion('Matheus Nicolau foi dispensado pelo UFC após três derrotas seguidas',null,'pt'),'ufc');

  assert.equal(hasContractSignal('Elizeu Zaleski dos Santos foi liberado pelo UFC após mais de 10 anos','pt'),true);
  assert.deepEqual(detectContractSignal('Elizeu Zaleski dos Santos foi liberado pelo UFC após mais de 10 anos','pt'),{eventType:'release',status:'released'});

  assert.equal(hasContractSignal('Brasileiros ficam sem contrato com o UFC','pt'),true);
  assert.deepEqual(detectContractSignal('Brasileiros ficam sem contrato com o UFC','pt'),{eventType:'free_agency',status:'free_agent'});
  assert.equal(detectContractPromotion('Brasileiros ficam sem contrato com o UFC',null,'pt'),'ufc');

  assert.equal(hasContractSignal('Michael Page virou free agent após deixar o Bellator','pt'),true);
  assert.deepEqual(detectContractSignal('Michael Page virou free agent após deixar o Bellator','pt'),{eventType:'free_agency',status:'free_agent'});
});

test('a modifier between the verb and "contrato" (e.g. "assinou seu primeiro contrato") does not break signing detection',()=>{
  // Real headline phrasing rarely puts "contrato" immediately after the verb -- Portuguese naturally
  // inserts "seu primeiro", "um novo", "de 8 lutas" etc. in between.
  assert.equal(hasContractSignal('Alex Pereira assinou um novo contrato de 8 lutas com o UFC','pt'),true);
  assert.equal(detectContractPromotion('Alex Pereira assinou um novo contrato de 8 lutas com o UFC',null,'pt'),'ufc');
});

test('Portuguese sponsorship and broadcast-rights coverage does not falsely trigger a contract signal',()=>{
  assert.equal(hasContractSignal('UFC fecha acordo de transmissão no Brasil','pt'),false);
  assert.equal(hasContractSignal('Patrocínio da marca X com o time','pt'),false);
});

test('Ag. Fight RSS only surfaces same-host article links carrying a Portuguese contract signal',()=>{
  const xml=`<?xml version="1.0" encoding="UTF-8"?><rss><channel>
    <item><title>Alex Poatan assina novo contrato com o UFC</title><link>https://agfight.com/ufc/alex-poatan-assina-novo-contrato-com-o-ufc/</link><description>O brasileiro assinou contrato de 8 lutas com o UFC.</description><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>Presença de Jon Jones em programa antidoping do UFC reacende rumores</title><link>https://agfight.com/ufc/presenca-de-jon-jones/</link><description>Rumores sobre retorno.</description></item>
    <item><title>Fighter signs UFC contract</title><link>https://example.com/fake</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Alex Poatan assina novo contrato com o UFC');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='agfight.com'));
});

test('a Portuguese-reported UFC signing queues a UFC candidate with exact identity, same as every other source',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'5001',fighter_name:'Alex Pereira'}];
  const rows=candidateRows(
    {title:'Alex Poatan assina novo contrato com o UFC',url:'https://agfight.com/ufc/alex-poatan-assina-novo-contrato-com-o-ufc/',publishedAt:'2026-09-15'},
    source,
    'O brasileiro Alex Pereira assinou um novo contrato de 8 lutas com o UFC antes de subir para os pesos pesados.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Alex Pereira');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'signing');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('Portuguese candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'9',fighter_name:'Someone Else'}];
  const rows=candidateRows(
    {title:'Alex Poatan assina novo contrato com o UFC',url:'https://agfight.com/ufc/alex-poatan-assina-novo-contrato-com-o-ufc/',publishedAt:'2026-09-15'},
    source,
    'Alex Pereira assinou um novo contrato com o UFC.',
    profiles
  );
  assert.equal(rows.length,0);
});
