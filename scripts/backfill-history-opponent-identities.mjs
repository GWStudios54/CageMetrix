import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local');
if(Number(remote)+Number(local)!==1)throw new Error('Choose exactly one of --remote or --local');
const target=remote?'--remote':'--local';
const cache='.cache/fighter-history-coverage';mkdirSync(cache,{recursive:true});
const BATCH_ROWS=5000;

function exec(command,args,options={}){return execFileSync(command,args,{encoding:'utf8',stdio:options.capture?['ignore','pipe','pipe']:'inherit',maxBuffer:40*1024*1024,env:process.env})||'';}
function wrangler(params,capture=false){return exec(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{capture});}
function query(sql){return JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true)).flatMap(block=>block?.results||[]);}
function run(sql){wrangler(['d1','execute','cagemetrix',target,'--command',sql]);}

const before=Number(query(`SELECT COUNT(*) n FROM scout_active_global_fights WHERE opponent_source_fighter_id IS NULL`)[0]?.n||0);
const range=query(`SELECT MIN(g.rowid) min_rowid,MAX(g.rowid) max_rowid FROM scout_global_fights g JOIN mma_source_registry r ON r.source_key=g.source_key AND r.active_snapshot_id=g.snapshot_id WHERE g.opponent_source_fighter_id IS NULL`)[0]||{};
const minRow=Number(range.min_rowid||0),maxRow=Number(range.max_rowid||0);
let batches=0;
for(let lo=minRow;lo&&lo<=maxRow;lo+=BATCH_ROWS){
  const hi=Math.min(maxRow,lo+BATCH_ROWS-1);batches+=1;
  run(`UPDATE scout_global_fights AS g
  SET opponent_source_fighter_id=(
    SELECT o.effective_source_fighter_id
    FROM mma_effective_participants p
    JOIN mma_effective_participants o
      ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
    WHERE p.source_key=g.source_key AND p.snapshot_id=g.snapshot_id AND p.source_fight_id=g.source_fight_id
      AND p.effective_source_fighter_id=g.source_fighter_id
      AND o.effective_source_fighter_id IS NOT NULL
      AND o.effective_source_fighter_id<>p.effective_source_fighter_id
    LIMIT 1
  )
  WHERE g.rowid BETWEEN ${lo} AND ${hi}
    AND g.opponent_source_fighter_id IS NULL
    AND EXISTS(
      SELECT 1
      FROM mma_effective_participants p
      JOIN mma_effective_participants o
        ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
      WHERE p.source_key=g.source_key AND p.snapshot_id=g.snapshot_id AND p.source_fight_id=g.source_fight_id
        AND p.effective_source_fighter_id=g.source_fighter_id
        AND o.effective_source_fighter_id IS NOT NULL
        AND o.effective_source_fighter_id<>p.effective_source_fighter_id
    );`);
}
const after=Number(query(`SELECT COUNT(*) n FROM scout_active_global_fights WHERE opponent_source_fighter_id IS NULL`)[0]?.n||0);
const resolvableRemaining=Number(query(`SELECT COUNT(*) n FROM scout_active_global_fights g WHERE g.opponent_source_fighter_id IS NULL AND EXISTS(SELECT 1 FROM mma_effective_participants p JOIN mma_effective_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side WHERE p.source_key=g.source_key AND p.snapshot_id=g.snapshot_id AND p.source_fight_id=g.source_fight_id AND p.effective_source_fighter_id=g.source_fighter_id AND o.effective_source_fighter_id IS NOT NULL AND o.effective_source_fighter_id<>p.effective_source_fighter_id)`)[0]?.n||0);
const summary={checked_at:new Date().toISOString(),opponent_ids_null_before:before,opponent_ids_null_after:after,opponent_ids_filled:before-after,batches_processed:batches,resolvable_null_opponents_remaining:resolvableRemaining};
writeFileSync(`${cache}/opponent-backfill.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(resolvableRemaining!==0)throw new Error(`Opponent identity backfill left ${resolvableRemaining} resolvable history rows without opponent ids`);
