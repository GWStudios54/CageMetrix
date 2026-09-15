import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local');
if(Number(remote)+Number(local)!==1)throw new Error('Choose exactly one of --remote or --local');
const target=remote?'--remote':'--local';
const cache='.cache/fight-history-recovery';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString();

function exec(command,args,options={}){
  return execFileSync(command,args,{encoding:'utf8',stdio:options.capture?['ignore','pipe','pipe']:'inherit',maxBuffer:40*1024*1024,env:process.env})||'';
}
function wrangler(params,capture=false){return exec(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{capture});}
function blocks(sql){return JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));}
function query(sql){return blocks(sql).flatMap(block=>block?.results||[]);}
function run(sql){wrangler(['d1','execute','cagemetrix',target,'--command',sql]);}

const completedFilter=`p.result IN ('W','L','D','NC') AND f.outcome<>'unknown' AND f.event_date<=date('now')`;
const safeSideFilter=`p.effective_source_fighter_id IS NOT NULL AND (o.effective_source_fighter_id IS NULL OR o.effective_source_fighter_id<>p.effective_source_fighter_id)`;
const resolvedMissingSql=`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id JOIN mma_effective_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side WHERE ${completedFilter} AND ${safeSideFilter} AND NOT EXISTS(SELECT 1 FROM scout_active_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.effective_source_fighter_id AND g.source_fight_id=p.source_fight_id)`;

const before={
  completed_participant_sides:Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE ${completedFilter}`)[0]?.n||0),
  resolved_participant_sides:Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE ${completedFilter} AND p.effective_source_fighter_id IS NOT NULL`)[0]?.n||0),
  unresolved_participant_sides:Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE ${completedFilter} AND p.effective_source_fighter_id IS NULL`)[0]?.n||0),
  overlay_resolved_participant_sides:Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE ${completedFilter} AND p.source_fighter_id IS NULL AND p.effective_source_fighter_id IS NOT NULL`)[0]?.n||0),
  unsafe_self_identity_sides:Number(query(`SELECT COUNT(*) n FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id JOIN mma_effective_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side WHERE ${completedFilter} AND p.effective_source_fighter_id IS NOT NULL AND o.effective_source_fighter_id=p.effective_source_fighter_id`)[0]?.n||0),
  materialized_history_rows:Number(query(`SELECT COUNT(*) n FROM scout_active_global_fights`)[0]?.n||0),
  safe_resolved_history_rows_missing:Number(query(resolvedMissingSql)[0]?.n||0),
  one_sided_completed_fights:Number(query(`SELECT COUNT(*) n FROM (SELECT p.source_key,p.snapshot_id,p.source_fight_id,SUM(CASE WHEN p.effective_source_fighter_id IS NOT NULL THEN 1 ELSE 0 END) resolved_sides FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE ${completedFilter} GROUP BY p.source_key,p.snapshot_id,p.source_fight_id HAVING resolved_sides=1)`)[0]?.n||0),
  zero_sided_completed_fights:Number(query(`SELECT COUNT(*) n FROM (SELECT p.source_key,p.snapshot_id,p.source_fight_id,SUM(CASE WHEN p.effective_source_fighter_id IS NOT NULL THEN 1 ELSE 0 END) resolved_sides FROM mma_effective_participants p JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id WHERE ${completedFilter} GROUP BY p.source_key,p.snapshot_id,p.source_fight_id HAVING resolved_sides=0)`)[0]?.n||0)
};

run(`INSERT OR IGNORE INTO scout_global_fights(source_key,snapshot_id,source_fighter_id,source_fight_id,event_date,organization,promotion_slug,event_name,event_location,weight_class,result,opponent_source_fighter_id,opponent_name,opponent_pre_elo,is_title_fight,method,round_num,time_finish_seconds)
SELECT p.source_key,p.snapshot_id,p.effective_source_fighter_id,p.source_fight_id,f.event_date,f.organization,
  (SELECT a.promotion_slug FROM scout_promotion_aliases a WHERE lower(trim(a.organization_alias))=lower(trim(f.organization)) ORDER BY a.promotion_slug LIMIT 1),
  f.event_name,f.event_location,f.weight_class,p.result,o.effective_source_fighter_id,o.fighter_name,NULL,f.is_title_fight,COALESCE(NULLIF(f.method_normalized,''),f.method_raw),f.round_num,f.time_finish_seconds
FROM mma_effective_participants p
JOIN mma_active_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
JOIN mma_effective_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
WHERE ${completedFilter}
  AND ${safeSideFilter}
  AND NOT EXISTS(SELECT 1 FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.effective_source_fighter_id AND g.source_fight_id=p.source_fight_id);`);

// Public dossier aggregates should describe every trustworthy fighter-side result we can
// materialize. The rating graph stays untouched: identity-overlay rows improve dossier
// history only and do not retroactively change Elo, schedule strength, résumé quality or validation.
run(`UPDATE scout_global_profiles AS p SET
  career_start_date=(SELECT MIN(g.event_date) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id),
  last_fight_date=(SELECT MAX(g.event_date) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id),
  current_organization=(SELECT g.organization FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id ORDER BY g.event_date DESC,g.source_fight_id DESC LIMIT 1),
  current_promotion_slug=(SELECT g.promotion_slug FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id ORDER BY g.event_date DESC,g.source_fight_id DESC LIMIT 1),
  current_weight_class=(SELECT g.weight_class FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id ORDER BY g.event_date DESC,g.source_fight_id DESC LIMIT 1),
  career_bouts=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id),
  career_wins=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='W'),
  career_losses=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='L'),
  career_draws=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='D'),
  career_no_contests=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='NC'),
  ko_tko_wins=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='W' AND lower(COALESCE(g.method,'')) LIKE '%ko%'),
  submission_wins=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='W' AND (lower(COALESCE(g.method,'')) LIKE '%submission%' OR lower(COALESCE(g.method,'')) LIKE 'sub%')),
  decision_wins=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='W' AND lower(COALESCE(g.method,'')) LIKE '%decision%'),
  title_fight_bouts=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.is_title_fight=1),
  title_fight_wins=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.is_title_fight=1 AND g.result='W'),
  organization_count=(SELECT COUNT(DISTINCT lower(trim(g.organization))) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id),
  recent_bouts_730d=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.event_date>=date('now','-730 day')),
  recent_wins_730d=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.event_date>=date('now','-730 day') AND g.result='W'),
  last_five_wins=(SELECT COUNT(*) FROM (SELECT g.result FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id ORDER BY g.event_date DESC,g.source_fight_id DESC LIMIT 5) x WHERE x.result='W'),
  last_five_losses=(SELECT COUNT(*) FROM (SELECT g.result FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id ORDER BY g.event_date DESC,g.source_fight_id DESC LIMIT 5) x WHERE x.result='L'),
  finish_round_sum=(SELECT COALESCE(SUM(g.round_num),0) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='W' AND (lower(COALESCE(g.method,'')) LIKE '%ko%' OR lower(COALESCE(g.method,'')) LIKE '%submission%' OR lower(COALESCE(g.method,'')) LIKE 'sub%')),
  first_round_finishes=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='W' AND g.round_num=1 AND (lower(COALESCE(g.method,'')) LIKE '%ko%' OR lower(COALESCE(g.method,'')) LIKE '%submission%' OR lower(COALESCE(g.method,'')) LIKE 'sub%')),
  times_finished=(SELECT COUNT(*) FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id AND g.result='L' AND (lower(COALESCE(g.method,'')) LIKE '%ko%' OR lower(COALESCE(g.method,'')) LIKE '%submission%' OR lower(COALESCE(g.method,'')) LIKE 'sub%')),
  data_completeness=MIN(100,55+7.5*((p.dob IS NOT NULL AND trim(p.dob)<>'')+(p.height_cm IS NOT NULL)+(p.reach_cm IS NOT NULL)+(p.stance IS NOT NULL AND trim(p.stance)<>'')+(p.nationality IS NOT NULL AND trim(p.nationality)<>'')+(p.gym IS NOT NULL AND trim(p.gym)<>''))),
  updated_at=CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM mma_source_registry r WHERE r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id)
  AND EXISTS(SELECT 1 FROM scout_global_fights g WHERE g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id);`);

const afterHistory=Number(query(`SELECT COUNT(*) n FROM scout_active_global_fights`)[0]?.n||0);
const remaining=Number(query(resolvedMissingSql)[0]?.n||0);
if(remaining!==0)throw new Error(`History recovery left ${remaining} safe completed participant sides with effective fighter identity unmaterialized`);
const topRecovered=query(`SELECT p.profile_slug,p.fighter_name,COUNT(*) recovered_rows FROM scout_public_global_profiles p JOIN scout_active_global_fights g ON g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fighter_id=p.source_fighter_id WHERE g.opponent_source_fighter_id IS NULL GROUP BY p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name ORDER BY recovered_rows DESC,p.fighter_name LIMIT 50`);
const coverage=query(`SELECT CASE WHEN career_bouts>=20 THEN '20+' WHEN career_bouts>=10 THEN '10-19' WHEN career_bouts>=5 THEN '5-9' WHEN career_bouts>=1 THEN '1-4' ELSE '0' END history_band,COUNT(*) fighters FROM scout_public_global_profiles GROUP BY history_band ORDER BY CASE history_band WHEN '20+' THEN 1 WHEN '10-19' THEN 2 WHEN '5-9' THEN 3 WHEN '1-4' THEN 4 ELSE 5 END`);
const summary={checked_at:checkedAt,mode:remote?'remote':'local',before,after:{materialized_history_rows:afterHistory,inserted_history_rows:afterHistory-before.materialized_history_rows,remaining_safe_resolved_history_rows_missing:remaining},coverage_bands:coverage,top_recovered_fighters:topRecovered};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
console.log(`Recovered ${summary.after.inserted_history_rows} fighter-side history rows; every safe completed participant side with an effective fighter identity now has a public history row.`);
