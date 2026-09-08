import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local');
if(Number(remote)+Number(local)!==1)throw new Error('Choose exactly one of --remote or --local');
const target=remote?'--remote':'--local';
const SOURCE_KEY='leandroiber_mmastats';
const cache='.cache/source-name-history';
const ROWID_BATCH=5000;
mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString();
const summary={checked_at:checkedAt,source_key:SOURCE_KEY,status:'running'};

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
const scalar=sql=>Number(query(sql)[0]?.n||0);
function persist(){
  writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
}

try{
  const registry=query(`SELECT active_snapshot_id snapshot_id FROM mma_source_registry WHERE source_key=${q(SOURCE_KEY)}`)[0];
  if(!registry?.snapshot_id)throw new Error(`No active snapshot for ${SOURCE_KEY}`);
  const snapshot=String(registry.snapshot_id);
  summary.snapshot_id=snapshot;
  summary.identity_contract='exact participant fighter_name -> exactly one authoritative mma_fighters source_fighter_id';
  summary.normalized_name_guessing=false;
  summary.hash_identity_assumption=false;

  // Rebuild only the source-grounded overlay for the active immutable snapshot. Raw source
  // rows and reviewed/manual participant resolutions remain untouched.
  run(`DELETE FROM mma_source_master_name_identities WHERE source_key=${q(SOURCE_KEY)} AND snapshot_id=${q(snapshot)};`);

  const rawBefore=scalar(`SELECT COUNT(*) n FROM mma_fight_participants p JOIN mma_source_registry r ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id WHERE p.source_key=${q(SOURCE_KEY)} AND p.source_fighter_id IS NULL`);
  const range=query(`SELECT MIN(p.rowid) min_rowid,MAX(p.rowid) max_rowid FROM mma_fight_participants p JOIN mma_source_registry r ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id WHERE p.source_key=${q(SOURCE_KEY)} AND p.source_fighter_id IS NULL`)[0]||{};
  const minRow=Number(range.min_rowid||0),maxRow=Number(range.max_rowid||0);
  summary.raw_unresolved_sides_before=rawBefore;
  summary.min_unresolved_rowid=minRow;
  summary.max_unresolved_rowid=maxRow;

  let batches=0;
  for(let lo=minRow;lo&&lo<=maxRow;lo+=ROWID_BATCH){
    const hi=Math.min(maxRow,lo+ROWID_BATCH-1);
    batches+=1;
    console.log(`Resolving exact source names from authoritative master batch ${batches}: rowid ${lo}-${hi}`);
    run(`INSERT OR REPLACE INTO mma_source_master_name_identities(
        source_key,snapshot_id,fighter_name,normalized_name,source_fighter_id,identity_basis,confidence,evidence_json,updated_at
      )
      SELECT p.source_key,p.snapshot_id,p.fighter_name,MIN(p.normalized_name),MIN(f.source_fighter_id),
             'source_exact_name_unique_master',0.999,
             json_object('basis','exact participant fighter_name resolves to one authoritative source master id','master_candidate_count',COUNT(DISTINCT f.source_fighter_id)),
             CURRENT_TIMESTAMP
      FROM mma_fight_participants p
      JOIN mma_fighters f
        ON f.source_key=p.source_key
       AND f.snapshot_id=p.snapshot_id
       AND f.fighter_name=p.fighter_name
      WHERE p.source_key=${q(SOURCE_KEY)}
        AND p.snapshot_id=${q(snapshot)}
        AND p.rowid BETWEEN ${lo} AND ${hi}
        AND p.source_fighter_id IS NULL
        AND trim(p.fighter_name)<>''
      GROUP BY p.source_key,p.snapshot_id,p.fighter_name
      HAVING COUNT(DISTINCT f.source_fighter_id)=1;`);
  }

  const completedFilter=`p.result IN ('W','L','D','NC') AND f.outcome<>'unknown' AND f.event_date<=date('now')`;
  const identitiesWritten=scalar(`SELECT COUNT(*) n FROM mma_source_master_name_identities WHERE source_key=${q(SOURCE_KEY)} AND snapshot_id=${q(snapshot)}`);
  const exactResolvedCompleted=scalar(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.identity_match_method='source_exact_name_unique_master'`);
  const effectiveCompleted=scalar(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.effective_source_fighter_id IS NOT NULL`);
  const unresolvedCompleted=scalar(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.effective_source_fighter_id IS NULL`);
  const ambiguousExactNames=scalar(`SELECT COUNT(*) n FROM (
    SELECT p.fighter_name
    FROM mma_unresolved_participants p
    JOIN mma_fighters f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.fighter_name=p.fighter_name
    WHERE p.source_key=${q(SOURCE_KEY)} AND p.snapshot_id=${q(snapshot)}
    GROUP BY p.fighter_name
    HAVING COUNT(DISTINCT f.source_fighter_id)>1
  )`);
  const noExactMasterNames=scalar(`SELECT COUNT(DISTINCT p.fighter_name) n
    FROM mma_unresolved_participants p
    WHERE p.source_key=${q(SOURCE_KEY)} AND p.snapshot_id=${q(snapshot)}
      AND NOT EXISTS(
        SELECT 1 FROM mma_fighters f
        WHERE f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.fighter_name=p.fighter_name
      )`);
  const selfCollisions=scalar(`SELECT COUNT(*) n FROM (SELECT p.source_key,p.snapshot_id,p.source_fight_id FROM mma_effective_participants p JOIN mma_effective_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.side=1 AND p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.effective_source_fighter_id IS NOT NULL AND p.effective_source_fighter_id=o.effective_source_fighter_id)`);
  const unresolvedExamples=query(`SELECT p.fighter_name,COUNT(*) participant_sides,
      (SELECT COUNT(DISTINCT mf.source_fighter_id) FROM mma_fighters mf WHERE mf.source_key=p.source_key AND mf.snapshot_id=p.snapshot_id AND mf.fighter_name=p.fighter_name) exact_master_candidates
    FROM mma_effective_participants p
    JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
    WHERE p.source_key=${q(SOURCE_KEY)} AND ${completedFilter} AND p.effective_source_fighter_id IS NULL
    GROUP BY p.source_key,p.snapshot_id,p.fighter_name
    ORDER BY participant_sides DESC,p.fighter_name
    LIMIT 100`);

  Object.assign(summary,{
    status:'complete',
    rowid_batches:batches,
    exact_unique_master_identities_written:identitiesWritten,
    exact_unique_master_completed_sides:exactResolvedCompleted,
    effective_completed_participant_sides_after:effectiveCompleted,
    unresolved_completed_participant_sides:unresolvedCompleted,
    ambiguous_exact_names_remaining:ambiguousExactNames,
    names_without_exact_master_row_remaining:noExactMasterNames,
    self_identity_collision_fights:selfCollisions,
    unresolved_examples:unresolvedExamples,
    note:'Unresolved or ambiguous names are retained as unresolved for review; they do not block recovery of every safely attributable completed fighter-side history row.'
  });
  persist();
  console.log(`Resolved ${identitiesWritten} exact source names from authoritative master ids; ${unresolvedCompleted} completed participant sides remain intentionally unresolved rather than guessed.`);
}catch(error){
  summary.status='failed';
  summary.error=error instanceof Error?error.message:String(error);
  persist();
  throw error;
}
