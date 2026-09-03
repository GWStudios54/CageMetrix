import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ratingFromArchive,recoverSnapshot,snapshotInsertSql} from './lib/prediction-snapshot.mjs';
import {q} from './lib/dataset.mjs';
const args=process.argv.slice(2),remote=args.includes('--remote');
if(!remote&&!args.includes('--local'))throw new Error('Choose --local or --remote');
const persist=args.indexOf('--persist-to');
const flags=[remote?'--remote':'--local',...(persist>=0?['--persist-to',args[persist+1]]:[])];
function read(sql){
  const out=execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cagemetrix',...flags,'--command',sql,'--json'],{encoding:'utf8',maxBuffer:40*1024*1024});
  return JSON.parse(out).flatMap(r=>r.results||[]);
}
const predictions=read(`SELECT p.*,mv.name model_name,mv.version model_version,a.name fighter_a_name,a.slug fighter_a_slug,z.name fighter_b_name,z.slug fighter_b_slug,b.fighter_a_id,b.fighter_b_id FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id JOIN bouts b ON b.id=p.bout_id JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id LEFT JOIN prediction_snapshots s ON s.prediction_id=p.id WHERE p.input_snapshot_json IS NULL AND s.prediction_id IS NULL`);
const sql=[],counts={verified_archive:0,unavailable:0};
for(const key of new Set(predictions.map(p=>p.input_snapshot_key))){
  const rows=key?read(`SELECT rh.* FROM ratings_history rh JOIN model_versions mv ON mv.id=rh.model_version_id WHERE rh.snapshot_key=${q(key)} AND mv.name='CageMetrix Opponent-Adjusted Rating' AND mv.version='0.3.0'`):[];
  const byFighter=new Map();
  for(const row of rows){if(byFighter.has(row.fighter_id))throw new Error(`Ambiguous original rating for ${row.fighter_id} in ${key}`);byFighter.set(row.fighter_id,row);}
  const dates=[...new Set(rows.map(r=>r.as_of_date))];
  if(dates.length>1)throw new Error(`Ambiguous source dates in ${key}`);
  for(const p of predictions.filter(p=>p.input_snapshot_key===key)){
    const snapshot=recoverSnapshot(p,ratingFromArchive(byFighter.get(p.fighter_a_id)),ratingFromArchive(byFighter.get(p.fighter_b_id)),dates[0]);
    counts[snapshot.provenance]++;
    sql.push(snapshotInsertSql(p.id,snapshot));
  }
}
mkdirSync('.cache/snapshots',{recursive:true});
writeFileSync('.cache/snapshots/backfill.sql',sql.join('\n'));
writeFileSync('.cache/snapshots/summary.json',JSON.stringify(counts,null,2));
if(sql.length&&!args.includes('--dry-run'))execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cagemetrix',...flags,'--file','.cache/snapshots/backfill.sql'],{stdio:'inherit'});
console.log('Archived snapshot recovery:',counts);
