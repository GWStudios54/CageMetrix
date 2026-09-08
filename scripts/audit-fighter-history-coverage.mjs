import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local');
if(Number(remote)+Number(local)!==1)throw new Error('Choose exactly one of --remote or --local');
const target=remote?'--remote':'--local';
const cache='.cache/fighter-history-coverage';mkdirSync(cache,{recursive:true});
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

// Count only safe source-reported fighter sides. A fight where both corners collapse to
// the same source identity is source corruption, not a bout we should silently attach.
run(`WITH source_history AS (
  SELECT p.source_key,p.snapshot_id,p.effective_source_fighter_id source_fighter_id,
         COUNT(*) source_bouts,MIN(f.event_date) first_date,MAX(f.event_date) last_date
  FROM mma_effective_participants p
  JOIN mma_active_fights f
    ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
  JOIN mma_effective_participants o
    ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
  WHERE p.result IN ('W','L','D','NC')
    AND f.outcome<>'unknown'
    AND f.event_date<=date('now')
    AND p.effective_source_fighter_id IS NOT NULL
    AND (o.effective_source_fighter_id IS NULL OR o.effective_source_fighter_id<>p.effective_source_fighter_id)
  GROUP BY p.source_key,p.snapshot_id,p.effective_source_fighter_id
), materialized AS (
  SELECT g.source_key,g.snapshot_id,g.source_fighter_id,
         COUNT(*) materialized_bouts,MIN(g.event_date) first_date,MAX(g.event_date) last_date
  FROM scout_active_global_fights g
  GROUP BY g.source_key,g.snapshot_id,g.source_fighter_id
)
INSERT OR REPLACE INTO mma_fighter_history_coverage(
  source_key,snapshot_id,source_fighter_id,source_reported_completed_bouts,materialized_completed_bouts,missing_bout_count,
  first_source_bout_date,last_source_bout_date,first_materialized_bout_date,last_materialized_bout_date,
  materialization_status,source_max_date,source_age_days,freshness_status,checked_at
)
SELECT f.source_key,f.snapshot_id,f.source_fighter_id,
       COALESCE(s.source_bouts,0),COALESCE(m.materialized_bouts,0),MAX(0,COALESCE(s.source_bouts,0)-COALESCE(m.materialized_bouts,0)),
       s.first_date,s.last_date,m.first_date,m.last_date,
       CASE WHEN COALESCE(s.source_bouts,0)=0 THEN 'no_source_bouts'
            WHEN COALESCE(m.materialized_bouts,0)>=COALESCE(s.source_bouts,0) THEN 'complete'
            ELSE 'gap' END,
       snap.source_max_date,
       CASE WHEN snap.source_max_date IS NULL OR trim(snap.source_max_date)='' THEN NULL ELSE MAX(0,CAST(julianday('now')-julianday(substr(snap.source_max_date,1,10)) AS INTEGER)) END,
       CASE WHEN snap.source_max_date IS NULL OR trim(snap.source_max_date)='' THEN 'unknown'
            WHEN julianday('now')-julianday(substr(snap.source_max_date,1,10))<=14 THEN 'current'
            WHEN julianday('now')-julianday(substr(snap.source_max_date,1,10))<=60 THEN 'aging'
            ELSE 'stale' END,
       CURRENT_TIMESTAMP
FROM mma_active_fighters f
JOIN mma_source_snapshots snap ON snap.source_key=f.source_key AND snap.snapshot_id=f.snapshot_id
LEFT JOIN source_history s ON s.source_key=f.source_key AND s.snapshot_id=f.snapshot_id AND s.source_fighter_id=f.source_fighter_id
LEFT JOIN materialized m ON m.source_key=f.source_key AND m.snapshot_id=f.snapshot_id AND m.source_fighter_id=f.source_fighter_id;`);

const statuses=query(`SELECT materialization_status,freshness_status,COUNT(*) fighters,SUM(source_reported_completed_bouts) source_bouts,SUM(materialized_completed_bouts) materialized_bouts,SUM(missing_bout_count) missing_bouts FROM mma_active_fighter_history_coverage GROUP BY materialization_status,freshness_status ORDER BY materialization_status,freshness_status`);
const totals=query(`SELECT COUNT(*) fighters,SUM(source_reported_completed_bouts) source_bouts,SUM(materialized_completed_bouts) materialized_bouts,SUM(missing_bout_count) missing_bouts,SUM(materialization_status='complete') complete_fighters,SUM(materialization_status='gap') gap_fighters,SUM(materialization_status='no_source_bouts') no_source_bout_fighters,MIN(source_max_date) oldest_source_max_date,MAX(source_max_date) newest_source_max_date,MAX(source_age_days) max_source_age_days FROM mma_active_fighter_history_coverage`)[0]||{};
const publicCoverage=query(`SELECT c.materialization_status,COUNT(*) fighters,SUM(c.source_reported_completed_bouts) source_bouts,SUM(c.materialized_completed_bouts) materialized_bouts,SUM(c.missing_bout_count) missing_bouts FROM scout_public_global_profiles p JOIN mma_active_fighter_history_coverage c ON c.source_key=p.source_key AND c.snapshot_id=p.snapshot_id AND c.source_fighter_id=p.source_fighter_id GROUP BY c.materialization_status ORDER BY c.materialization_status`);
const missingPublicCoverage=Number(query(`SELECT COUNT(*) n FROM scout_public_global_profiles p WHERE NOT EXISTS(SELECT 1 FROM mma_active_fighter_history_coverage c WHERE c.source_key=p.source_key AND c.snapshot_id=p.snapshot_id AND c.source_fighter_id=p.source_fighter_id)`)[0]?.n||0);
const unsafeSelfIdentity=Number(query(`SELECT COUNT(*) n FROM (SELECT p.source_key,p.snapshot_id,p.source_fight_id FROM mma_effective_participants p JOIN mma_effective_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE p.side=1 AND p.result IN ('W','L','D','NC') AND f.outcome<>'unknown' AND f.event_date<=date('now') AND p.effective_source_fighter_id IS NOT NULL AND p.effective_source_fighter_id=o.effective_source_fighter_id)`)[0]?.n||0);
const remainingEffectiveMissing=Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id JOIN mma_effective_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side WHERE p.result IN ('W','L','D','NC') AND f.outcome<>'unknown' AND f.event_date<=date('now') AND p.effective_source_fighter_id IS NOT NULL AND (o.effective_source_fighter_id IS NULL OR o.effective_source_fighter_id<>p.effective_source_fighter_id) AND NOT EXISTS(SELECT 1 FROM scout_active_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.effective_source_fighter_id AND g.source_fight_id=p.source_fight_id)`)[0]?.n||0);
const staleProfiles=query(`SELECT p.profile_slug,p.fighter_name,c.source_reported_completed_bouts,c.materialized_completed_bouts,c.last_source_bout_date,c.source_max_date,c.source_age_days FROM scout_public_global_profiles p JOIN mma_active_fighter_history_coverage c ON c.source_key=p.source_key AND c.snapshot_id=p.snapshot_id AND c.source_fighter_id=p.source_fighter_id WHERE c.materialization_status='no_source_bouts' OR c.freshness_status='stale' ORDER BY c.source_reported_completed_bouts ASC,c.source_age_days DESC,p.fighter_name LIMIT 100`);

const summary={checked_at:checkedAt,definition:'Complete means every safe completed fighter-side bout reported by the active source snapshot is materialized. Source freshness is reported separately and absolute world completeness is not inferred.',totals,statuses,public_profile_coverage:publicCoverage,public_profiles_without_coverage_row:missingPublicCoverage,unsafe_self_identity_fights:unsafeSelfIdentity,remaining_safe_effective_sides_unmaterialized:remainingEffectiveMissing,profiles_needing_fresher_or_secondary_source:staleProfiles};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
const gaps=Number(totals.gap_fighters||0),missing=Number(totals.missing_bouts||0);
if(gaps!==0||missing!==0||missingPublicCoverage!==0||remainingEffectiveMissing!==0)throw new Error(`History completeness audit failed: gap_fighters=${gaps}, missing_bouts=${missing}, public_without_coverage=${missingPublicCoverage}, safe_sides_unmaterialized=${remainingEffectiveMissing}`);
console.log(`History materialization audit passed for ${totals.fighters||0} master fighters. Freshness remains an independent requirement.`);
