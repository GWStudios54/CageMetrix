import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local');
if(Number(remote)+Number(local)!==1)throw new Error('Choose exactly one of --remote or --local');
const target=remote?'--remote':'--local';
const cache='.cache/fighter-intel';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString();

function exec(command,args,options={}){
  return execFileSync(command,args,{encoding:'utf8',stdio:options.capture?['ignore','pipe','pipe']:'inherit',maxBuffer:40*1024*1024,env:process.env})||'';
}
function wrangler(params,capture=false){return exec(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{capture});}
function query(sql){
  const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  return blocks.flatMap(block=>block?.results||[]);
}

// Generate the canonical idempotent SQL without asking Wrangler's bulk-file
// importer to run it. D1's import endpoint is optimized for dumps and can
// return "Not currently importing anything" for a large mixed UPSERT file.
exec(process.execPath,['scripts/sync-fighter-intel.mjs','--dry-run']);
let text=readFileSync(`${cache}/sync.sql`,'utf8');

// SQLite requires a WHERE clause to disambiguate SELECT ... JOIN ... ON from
// UPSERT's ON CONFLICT in these two source-backed statements.
text=text.replaceAll(
  'FROM fighter_management_history h LEFT JOIN management_agencies a ON a.id=h.agency_id\nON CONFLICT',
  'FROM fighter_management_history h LEFT JOIN management_agencies a ON a.id=h.agency_id\nWHERE 1=1\nON CONFLICT'
);
writeFileSync(`${cache}/sync.sql`,text);

const statements=text.split(/;\s*(?:\n|$)/).map(value=>value.trim()).filter(Boolean);
const applied=[];
for(const [index,statement] of statements.entries()){
  try{
    wrangler(['d1','execute','cagemetrix',target,'--command',`${statement};`]);
    applied.push({statement:index+1,status:'ok'});
  }catch(error){
    const failure={statement:index+1,status:'error',preview:statement.slice(0,180),message:error instanceof Error?error.message:String(error)};
    writeFileSync(`${cache}/apply-progress.json`,JSON.stringify({checked_at:checkedAt,applied,failure},null,2)+'\n');
    throw new Error(`Fighter intel statement ${index+1}/${statements.length} failed: ${failure.preview}`,{cause:error});
  }
}

const coverage=query(`SELECT COUNT(*) fighters,ROUND(AVG(intel_coverage_pct),1) avg_coverage,MIN(intel_coverage_pct) min_coverage,MAX(intel_coverage_pct) max_coverage,SUM(CASE WHEN management_status='represented' THEN 1 ELSE 0 END) represented,SUM(CASE WHEN gym IS NOT NULL AND trim(gym)<>'' THEN 1 ELSE 0 END) gym_known FROM scout_fighter_intel_coverage`)[0]||{};
const facts=query(`SELECT category,COUNT(*) facts FROM fighter_intel_facts WHERE is_current=1 GROUP BY category ORDER BY facts DESC`);
const events=query(`SELECT event_type,COUNT(*) events FROM fighter_intel_events GROUP BY event_type ORDER BY events DESC`);
const largestGaps=query(`SELECT fact_key,COUNT(*) missing FROM scout_fighter_intel_coverage c CROSS JOIN (SELECT 'management.current' fact_key UNION ALL SELECT 'team.primary' UNION ALL SELECT 'contract.status' UNION ALL SELECT 'location.base') k WHERE (k.fact_key='management.current' AND c.management_status='unknown') OR (k.fact_key='team.primary' AND (c.gym IS NULL OR trim(c.gym)='')) OR (k.fact_key='contract.status' AND c.contract_status='unknown') OR (k.fact_key='location.base' AND COALESCE(c.base_city,c.base_region,c.base_country) IS NULL) GROUP BY fact_key ORDER BY missing DESC`);
const coverageBands=query(`SELECT CASE WHEN intel_coverage_pct>=80 THEN '80-100' WHEN intel_coverage_pct>=60 THEN '60-79' WHEN intel_coverage_pct>=40 THEN '40-59' WHEN intel_coverage_pct>=20 THEN '20-39' ELSE '0-19' END coverage_band,COUNT(*) fighters FROM scout_fighter_intel_coverage GROUP BY coverage_band ORDER BY coverage_band DESC`);
const summary={checked_at:checkedAt,mode:remote?'remote':'local',statements:statements.length,coverage,facts,events,coverage_bands:coverageBands,largest_gaps:largestGaps};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
writeFileSync(`${cache}/apply-progress.json`,JSON.stringify({checked_at:checkedAt,applied,complete:true},null,2)+'\n');
console.log(`Fighter intel refreshed for ${coverage.fighters||0} active fighters; average coverage ${coverage.avg_coverage??0}% across ${statements.length} idempotent statements.`);
