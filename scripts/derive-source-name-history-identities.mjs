import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readdirSync,rmSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local');
if(Number(remote)+Number(local)!==1)throw new Error('Choose exactly one of --remote or --local');
const target=remote?'--remote':'--local';
const SOURCE_KEY='leandroiber_mmastats';
const cache='.cache/source-name-history';
const sqlDir=`${cache}/sql`;
const ROWID_BATCH=5000;
const INSERT_BATCH=250;
const MAX_FILE_BYTES=800_000;
mkdirSync(cache,{recursive:true});
rmSync(sqlDir,{recursive:true,force:true});
mkdirSync(sqlDir,{recursive:true});
const checkedAt=new Date().toISOString();

function exec(command,args,options={}){
  return execFileSync(command,args,{encoding:'utf8',stdio:options.capture?['ignore','pipe','pipe']:'inherit',maxBuffer:50*1024*1024,env:process.env})||'';
}
function wrangler(params,capture=false){return exec(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{capture});}
function query(sql){
  const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  return blocks.flatMap(block=>block?.results||[]);
}
function run(sql){wrangler(['d1','execute','cagemetrix',target,'--command',sql]);}
const q=value=>value===null||value===undefined?'NULL':`'${String(value).replaceAll("'","''")}'`;
const md5=value=>createHash('md5').update(String(value),'utf8').digest('hex');

const registry=query(`SELECT active_snapshot_id snapshot_id FROM mma_source_registry WHERE source_key=${q(SOURCE_KEY)}`)[0];
if(!registry?.snapshot_id)throw new Error(`No active snapshot for ${SOURCE_KEY}`);
const snapshot=String(registry.snapshot_id);

// Fail closed unless the active source proves its identity contract across every master row.
// This is intentionally runtime-verified because the upstream schema does not document the
// MD5 rule even though its published fighter ids follow it.
let cursor='';
let masterRows=0;
const mismatches=[];
while(true){
  const rows=query(`SELECT source_fighter_id,fighter_name FROM mma_fighters WHERE source_key=${q(SOURCE_KEY)} AND snapshot_id=${q(snapshot)} ${cursor?`AND source_fighter_id>${q(cursor)}`:''} ORDER BY source_fighter_id LIMIT 1000`);
  if(!rows.length)break;
  for(const row of rows){
    masterRows+=1;
    const expected=md5(row.fighter_name??'');
    if(expected!==String(row.source_fighter_id))mismatches.push({fighter_name:row.fighter_name,source_fighter_id:row.source_fighter_id,expected});
  }
  cursor=String(rows.at(-1).source_fighter_id);
  if(rows.length<1000)break;
}
if(!masterRows)throw new Error('Active source contains no fighter master rows');

const contractEvidence=JSON.stringify({basis:'fighter_id equals MD5 of exact UTF-8 fighter_name for every active master row',sample_mismatches:mismatches.slice(0,5)});
run(`INSERT INTO mma_source_identity_contracts(source_key,snapshot_id,algorithm,master_rows_checked,mismatch_count,status,evidence_json,verified_at)
VALUES (${q(SOURCE_KEY)},${q(snapshot)},'md5(exact_utf8_fighter_name)',${masterRows},${mismatches.length},${q(mismatches.length?'failed':'verified')},${q(contractEvidence)},CURRENT_TIMESTAMP)
ON CONFLICT(source_key,snapshot_id) DO UPDATE SET algorithm=excluded.algorithm,master_rows_checked=excluded.master_rows_checked,mismatch_count=excluded.mismatch_count,status=excluded.status,evidence_json=excluded.evidence_json,verified_at=CURRENT_TIMESTAMP;`);
if(mismatches.length)throw new Error(`Upstream fighter identity contract changed: ${mismatches.length}/${masterRows} master ids are not MD5(exact fighter_name)`);

// Rebuild only the derived layer for the active immutable snapshot. Manual/reviewed
// participant resolutions and raw source rows are untouched.
run(`DELETE FROM mma_source_name_identities WHERE source_key=${q(SOURCE_KEY)} AND snapshot_id=${q(snapshot)};`);

const rawBefore=Number(query(`SELECT COUNT(*) n FROM mma_fight_participants p JOIN mma_source_registry r ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id WHERE p.source_key=${q(SOURCE_KEY)} AND p.source_fighter_id IS NULL`)[0]?.n||0);
const range=query(`SELECT MIN(p.rowid) min_rowid,MAX(p.rowid) max_rowid FROM mma_fight_participants p JOIN mma_source_registry r ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id WHERE p.source_key=${q(SOURCE_KEY)} AND p.source_fighter_id IS NULL`)[0]||{};
const minRow=Number(range.min_rowid||0),maxRow=Number(range.max_rowid||0);
const names=new Map();
for(let lo=minRow;lo&&lo<=maxRow;lo+=ROWID_BATCH){
  const hi=Math.min(maxRow,lo+ROWID_BATCH-1);
  const rows=query(`SELECT p.fighter_name,p.normalized_name FROM mma_fight_participants p JOIN mma_source_registry r ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id WHERE p.source_key=${q(SOURCE_KEY)} AND p.rowid BETWEEN ${lo} AND ${hi} AND p.source_fighter_id IS NULL`);
  for(const row of rows){
    const fighterName=String(row.fighter_name??'');
    if(!fighterName.trim())continue;
    if(!names.has(fighterName))names.set(fighterName,String(row.normalized_name??''));
  }
}

const rows=[...names.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([fighterName,normalizedName])=>[
  SOURCE_KEY,snapshot,fighterName,normalizedName,md5(fighterName),'source_exact_name_md5',0.97,JSON.stringify({contract:'md5(exact_utf8_fighter_name)',scope:'source-history bookkeeping; not independent human-identity verification'})
]);

let fileIndex=0,fileBody='',fileBytes=0;
const flush=()=>{
  if(!fileBody)return;
  const path=`${sqlDir}/${String(++fileIndex).padStart(4,'0')}-source-name-identities.sql`;
  writeFileSync(path,`BEGIN;\n${fileBody}COMMIT;\n`);
  fileBody='';fileBytes=0;
};
for(let i=0;i<rows.length;i+=INSERT_BATCH){
  const batch=rows.slice(i,i+INSERT_BATCH);
  const values=batch.map(row=>`(${row.map(q).join(',')})`).join(',\n');
  const statement=`INSERT OR REPLACE INTO mma_source_name_identities(source_key,snapshot_id,fighter_name,normalized_name,derived_source_fighter_id,identity_basis,confidence,evidence_json) VALUES\n${values};\n`;
  const bytes=Buffer.byteLength(statement);
  if(fileBody&&fileBytes+bytes>MAX_FILE_BYTES)flush();
  fileBody+=statement;fileBytes+=bytes;
}
flush();
for(const file of readdirSync(sqlDir).sort())wrangler(['d1','execute','cagemetrix',target,'--file',`${sqlDir}/${file}`]);

const completedFilter=`p.result IN ('W','L','D','NC') AND f.outcome<>'unknown' AND f.event_date<=date('now')`;
const effectiveAfter=Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.effective_source_fighter_id IS NOT NULL`)[0]?.n||0);
const unresolvedAfter=Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.effective_source_fighter_id IS NULL`)[0]?.n||0);
const derivedCompleted=Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.identity_match_method='source_exact_name_md5'`)[0]?.n||0);
const selfCollisions=Number(query(`SELECT COUNT(*) n FROM (SELECT p.source_key,p.snapshot_id,p.source_fight_id FROM mma_effective_participants p JOIN mma_effective_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.side=1 AND p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.effective_source_fighter_id IS NOT NULL AND p.effective_source_fighter_id=o.effective_source_fighter_id)`)[0]?.n||0);
const summary={checked_at:checkedAt,source_key:SOURCE_KEY,snapshot_id:snapshot,identity_contract:{algorithm:'md5(exact_utf8_fighter_name)',master_rows_checked:masterRows,mismatches:mismatches.length,status:'verified'},raw_unresolved_sides_before:rawBefore,distinct_unresolved_exact_names:names.size,derived_name_identities_written:rows.length,derived_completed_participant_sides:derivedCompleted,effective_completed_participant_sides_after:effectiveAfter,remaining_unresolved_completed_sides:unresolvedAfter,self_identity_collision_fights:selfCollisions,sql_files:fileIndex};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(unresolvedAfter!==0)throw new Error(`Source-name derivation left ${unresolvedAfter} completed participant sides without an effective source history identity`);
console.log(`Verified ${masterRows} upstream fighter ids and derived ${rows.length} exact-name history identities; every completed source participant side now has an effective history id.`);
