import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('public fighter page wires camp and anti-doping context in the correct visual order after contract intelligence',()=>{
  const entry=read('src/entry.ts');
  assert.match(entry,/enhanceFighterCampContext/);
  assert.match(entry,/enhanceFighterAntidopingContext/);
  const contractIdx=entry.indexOf('enhanceFighterContractContext(dossier');
  const campIdx=entry.indexOf('enhanceFighterCampContext(dossier');
  const antidopingIdx=entry.indexOf('enhanceFighterAntidopingContext(dossier');
  assert.ok(contractIdx>-1&&campIdx>-1&&antidopingIdx>-1,'all three enhancement calls must be present');
  assert.ok(contractIdx<campIdx,'camp context must be wired after contract context');
  assert.ok(campIdx<antidopingIdx,'anti-doping context must be wired after camp context');
});

test('camp context always renders a section, anchored after contract-intelligence, with a neutral unknown state',()=>{
  const source=read('src/camp-intel-context.ts');
  assert.match(source,/export async function enhanceFighterCampContext/);
  assert.match(source,/on\('\.contract-intelligence',\{element\(el\)\{el\.after\(section,\{html:true\}\);\}\}\)/);
  assert.match(source,/class="contract-intelligence camp-intelligence"/);
  assert.match(source,/Training camp is not publicly verified/);
  assert.match(source,/No camp record is treated as unknown.{0,3}not campless/);
  assert.match(source,/FROM fighter_camp_history h/);
  assert.match(source,/LEFT JOIN training_camps t ON t\.id=h\.camp_id/);
  assert.match(source,/LEFT JOIN fighter_camp_evidence ev/);
});

test('camp card links to a fighter’s resolved camp slug and shows coach when known',()=>{
  const source=read('src/camp-intel-context.ts');
  assert.match(source,/href="\/camps\/\$\{esc\(row\.camp_slug\)\}"/);
  assert.match(source,/Coach: \$\{esc\(row\.coach_name\)\}/);
});

test('anti-doping context is omitted entirely (not an empty state) when a fighter has no published event',()=>{
  const source=read('src/antidoping-intel-context.ts');
  assert.match(source,/export async function enhanceFighterAntidopingContext/);
  assert.match(source,/if\(!data\|\|!data\.events\.length\)return response;/);
  assert.match(source,/on\('\.camp-intelligence',\{element\(el\)\{el\.after\(section,\{html:true\}\);\}\}\)/);
  assert.match(source,/class="contract-intelligence antidoping-intelligence"/);
});

test('anti-doping section framing is documented as neutral and factual, not editorializing',()=>{
  const source=read('src/antidoping-intel-context.ts');
  assert.match(source,/[Nn]eutral,? factual framing/);
  assert.match(source,/[Nn]o editorializing/);
  assert.doesNotMatch(source,/busted|caught red-handed|shameful|disgraced/i);
});

test('anti-doping card surfaces substance, sanctioning body, suspension length and sources without a verified_profile escape hatch',()=>{
  const source=read('src/antidoping-intel-context.ts');
  assert.match(source,/Substance: \$\{row\.substance\}/);
  assert.match(source,/Sanctioning body: \$\{row\.sanctioning_body\}/);
  assert.match(source,/Reported suspension: \$\{row\.suspension_months\}/);
  assert.match(source,/FROM fighter_antidoping_events e/);
  assert.doesNotMatch(source,/verified_profile/);
});

test('camp and anti-doping intelligence never feed Global Rating',()=>{
  const rating=read('scripts/build-global-scout-rating-v2.py');
  for(const forbidden of ['fighter_camp_history','fighter_camp_evidence','training_camps','fighter_antidoping_events','fighter_antidoping_evidence'])assert.doesNotMatch(rating,new RegExp(forbidden));
});
