import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceCodeHash} from '../scripts/validate-predictor-v02.mjs';
import {predictVector} from '../scripts/lib/predictor_v02.mjs';
import {predictFrozenVector} from '../scripts/lib/predictor_v01.mjs';
import {ELO_SLOPE} from '../scripts/lib/forecast.mjs';
import {chooseTrial} from '../scripts/lib/predictor-evaluation.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));

test('committed 0.2 artifact matches audited source code, validation selection and research-only status',()=>{
  const artifact=read('scripts/data/predictor-v02-candidate.json');
  const report=read('docs/research/predictor-v02/report.json');
  const selection=read('docs/research/predictor-v02/selection.json');
  assert.equal(artifact.source.code_sha256,sourceCodeHash(),'Regenerate and review the candidate audit when implementation changes');
  const protocol=readFileSync(new URL('../docs/PREDICTOR-0.2-PROTOCOL.md',import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(artifact.source.protocol_sha256,createHash('sha256').update(protocol).digest('hex'));
  assert.deepEqual(artifact.source,report.source);assert.deepEqual(artifact.source,selection.source);
  assert.equal(artifact.model.experiment,chooseTrial(selection.trials).experiment);
  assert.equal(artifact.model.experiment,report.selected_experiment);
  assert.equal(artifact.status,'offline_research_only');assert.equal(artifact.training_end,'2022-12-31');
  assert.equal(report.promotion.production_eligible,false);assert.equal(report.promotion.prospective_graded_bouts,0);
});

test('frozen 0.2 artifact reproduces audited real historical rows and preserves the unrated fallback',()=>{
  const artifact=read('scripts/data/predictor-v02-candidate.json');
  const fixtures=read('tests/helpers/predictor-v02-regression.json');
  for(const row of fixtures){
    const probability=row.rated?predictVector(artifact.model,row.x):1/(1+Math.exp(-ELO_SLOPE*row.x[0]));
    assert.ok(Math.abs(probability-row.candidate_p)<1e-12,row.id);
    if(row.rated)assert.ok(Math.abs(predictFrozenVector(row.x.slice(0,24))-row.baseline_p)<1e-12);
    else assert.equal(row.candidate_p,row.baseline_p);
  }
});
