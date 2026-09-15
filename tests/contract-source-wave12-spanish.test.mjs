import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_DISCOVERY_SOURCES,candidateRows,detectContractPromotion,detectContractSignal,hasContractSignal,normalizeContractText,parseContractListing} from '../scripts/lib/contract-intel-discovery.mjs';

const source=CONTRACT_DISCOVERY_SOURCES.find(row=>row.slug==='agdeportes-rss');

test('wave 12 registers AG Deportes as a Spanish-language reputable-trade-reporting source, title-scoped to cut general-sports noise',()=>{
  assert.ok(source);
  assert.equal(source.publisher,'AG Deportes');
  assert.equal(source.sourceType,'reputable_trade_reporting');
  assert.equal(source.promotionSlug,null);
  assert.equal(source.kind,'rss');
  assert.equal(source.host,'agdeportes.com');
  assert.equal(source.lang,'es');
  assert.equal(source.titleSignalOnly,true);
});

test('other languages are unaffected by adding Spanish: lang dispatch is additive',()=>{
  assert.equal(hasContractSignal('Adam Darby signs a UFC contract'),true);
  assert.equal(hasContractSignal('Alex Poatan assina novo contrato com o UFC','pt'),true);
  assert.equal(hasContractSignal('平良達郎がUFCと契約を結んだ','ja'),true);
});

test('Spanish diacritics (ñ, á, é) fold correctly with zero new normalization code, same as Portuguese',()=>{
  assert.equal(normalizeContractText('Peña'),normalizeContractText('Pena'));
  assert.equal(normalizeContractText('José'),normalizeContractText('Jose'));
});

test('real, verified Spanish-language contract vocabulary is recognized across all five event types',()=>{
  // Every phrase confirmed against real 2025-2026 reporting (ESPN Deportes, AG Deportes, Eurosport
  // España, Ecuavisa, Infobae): Charles Oliveira's and Jim Miller's real UFC deals, the real Dani
  // Bárez non-renewal and departure coverage, Derek Brunson's real "agente libre" framing, Francis
  // Ngannou's and a real nine-fighter release wave's "despido" coverage, and the real DWCS
  // "Seis contratos" signing-night recap.
  assert.equal(hasContractSignal('Charles Oliveira ha firmado un nuevo contrato de 8 peleas con la UFC','es'),true);
  assert.deepEqual(detectContractSignal('Charles Oliveira ha firmado un nuevo contrato de 8 peleas con la UFC','es'),{eventType:'signing',status:'under_contract'});
  assert.equal(detectContractPromotion('Charles Oliveira ha firmado un nuevo contrato de 8 peleas con la UFC',null,'es'),'ufc');

  assert.equal(hasContractSignal('Jim Miller firma una extension de contrato con la UFC','es'),true);
  assert.deepEqual(detectContractSignal('Jim Miller firma una extension de contrato con la UFC','es'),{eventType:'extension',status:'under_contract'});
  assert.equal(detectContractPromotion('Jim Miller firma una extension de contrato con la UFC',null,'es'),'ufc');

  assert.equal(hasContractSignal('La UFC no renovará el contrato a Dani Bárez','es'),true);
  assert.deepEqual(detectContractSignal('La UFC no renovará el contrato a Dani Bárez','es'),{eventType:'expiration',status:'expired'});
  assert.equal(detectContractPromotion('La UFC no renovará el contrato a Dani Bárez',null,'es'),'ufc');

  assert.equal(hasContractSignal('Dani Bárez abandona la UFC','es'),true);
  assert.deepEqual(detectContractSignal('Dani Bárez abandona la UFC','es'),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion('Dani Bárez abandona la UFC',null,'es'),'ufc');

  assert.equal(hasContractSignal('Derek Brunson UFC agente libre','es'),true);
  assert.deepEqual(detectContractSignal('Derek Brunson UFC agente libre','es'),{eventType:'free_agency',status:'free_agent'});

  assert.equal(hasContractSignal('Francis Ngannou es despedido de UFC','es'),true);
  assert.deepEqual(detectContractSignal('Francis Ngannou es despedido de UFC','es'),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion('Francis Ngannou es despedido de UFC',null,'es'),'ufc');

  assert.equal(hasContractSignal('la UFC anuncia el despido de nueve peleadores','es'),true);
  assert.deepEqual(detectContractSignal('la UFC anuncia el despido de nueve peleadores','es'),{eventType:'release',status:'released'});
  assert.equal(detectContractPromotion('la UFC anuncia el despido de nueve peleadores',null,'es'),'ufc');

  assert.equal(hasContractSignal('Contender Series: Seis contratos en una gran noche en el Meta Apex','es'),true);
  assert.deepEqual(detectContractSignal('Contender Series: Seis contratos en una gran noche en el Meta Apex','es'),{eventType:'signing',status:'under_contract'});
});

test('a bare "contrato(s)" mention (no specific verb) still registers as a signal, same as English and Japanese',()=>{
  // Spanish sports headlines routinely compress "Dana White awarded contracts" down to a bare noun
  // count ("Seis contratos"); English and Japanese both already accept a bare contract/契約 fallback
  // for exactly this reason, backstopped by the promotion + exact-name filters and human review.
  assert.equal(hasContractSignal('Dana White entrego cinco contratos','es'),true);
});

test('Spanish sponsorship and broadcast-rights coverage does not falsely trigger a contract signal',()=>{
  assert.equal(hasContractSignal('UFC anuncia acuerdo de transmision en Latinoamerica','es'),false);
  assert.equal(hasContractSignal('Patrocinio de la marca X con el equipo','es'),false);
});

test('titleSignalOnly is honored for RSS sources, not just HTML listings: description-only noise from an unrelated sport does not leak through',()=>{
  // AG Deportes is a general Spanish-language sports outlet (football, F1, basketball) that happens to
  // also carry real MMA/UFC contract news -- confirmed by its own past headlines on Charles Oliveira and
  // Dani Bárez. Scoping signal detection to the RSS item title (not the fuller description) cuts down
  // false positives from unrelated-sport articles that only mention contract terms in passing detail.
  const xml=`<?xml version="1.0" encoding="UTF-8"?><rss><channel>
    <item><title>Real Madrid golea en el clasico</title><link>https://agdeportes.com/real-madrid-golea-en-el-clasico/</link><description>El defensor renovo su contrato con el club hace unas semanas.</description></item>
    <item><title>Charles Oliveira firmo un nuevo contrato con la UFC</title><link>https://agdeportes.com/charles-oliveira-firmo-un-nuevo-contrato-con-la-ufc/</link><description>El brasileno asegura su futuro en la organizacion.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Charles Oliveira firmo un nuevo contrato con la UFC');
});

test('AG Deportes RSS only surfaces same-host article links carrying a Spanish contract signal in the title',()=>{
  const xml=`<?xml version="1.0" encoding="UTF-8"?><rss><channel>
    <item><title>Charles Oliveira firmó un nuevo contrato con la UFC</title><link>https://agdeportes.com/charles-oliveira-firmo-un-nuevo-contrato-con-la-ufc/</link><description>El brasileño asegura su futuro en la organización.</description><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>Kimi Antonelli conquista el Gran Premio de España</title><link>https://agdeportes.com/kimi-antonelli-conquista-el-gran-premio-de-espana/</link><description>Resultado de Formula 1.</description></item>
    <item><title>Fighter signs UFC contract</title><link>https://example.com/fake</link><description>Wrong host.</description></item>
  </channel></rss>`;
  const rows=parseContractListing(xml,source);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Charles Oliveira firmó un nuevo contrato con la UFC');
  assert.ok(rows.every(row=>new URL(row.url).hostname==='agdeportes.com'));
});

test('a Spanish-reported UFC signing queues a UFC candidate with exact identity, same as every other source',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'6001',fighter_name:'Charles Oliveira'}];
  const rows=candidateRows(
    {title:'Charles Oliveira firmó un nuevo contrato de 8 peleas con la UFC',url:'https://agdeportes.com/charles-oliveira-firmo-un-nuevo-contrato-de-8-peleas-con-la-ufc/',publishedAt:'2026-09-15'},
    source,
    'El brasileño Charles Oliveira firmó un nuevo contrato de 8 peleas con la UFC antes de subir de categoria.',
    profiles
  );
  assert.equal(rows.length,1);
  assert.equal(rows[0].fighterName,'Charles Oliveira');
  assert.equal(rows[0].promotionSlug,'ufc');
  assert.equal(rows[0].detectedEventType,'signing');
  assert.equal(rows[0].reviewStatus,'pending');
});

test('Spanish candidate extraction still requires an exact profile-name match; it does not fuzzy-match names',()=>{
  const profiles=[{source_key:'mma',source_fighter_id:'9',fighter_name:'Someone Else'}];
  const rows=candidateRows(
    {title:'x',url:'https://agdeportes.com/x/',publishedAt:'2026-09-15'},
    source,
    'Charles Oliveira firmó un nuevo contrato con la UFC.',
    profiles
  );
  assert.equal(rows.length,0);
});
