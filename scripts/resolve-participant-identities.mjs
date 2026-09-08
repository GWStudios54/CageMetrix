import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local');
if(Number(remote)+Number(local)!==1)throw new Error('Choose exactly one of --remote or --local');
const target=remote?'--remote':'--local';
const cache='.cache/participant-identity';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString();

function exec(command,args,options={}){
  return execFileSync(command,args,{encoding:'utf8',stdio:options.capture?['ignore','pipe','pipe']:'inherit',maxBuffer:40*1024*1024,env:process.env})||'';
}
function wrangler(params,capture=false){return exec(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{capture});}
function query(sql){
  const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  return blocks.flatMap(block=>block?.results||[]);
}
function run(sql){wrangler(['d1','execute','cagemetrix',target,'--command',sql]);}
const scalar=sql=>Number(query(sql)[0]?.n||0);

const before={
  raw_unresolved_sides:scalar(`SELECT COUNT(*) n FROM mma_active_participants WHERE source_fighter_id IS NULL`),
  unresolved_without_master_name:scalar(`SELECT COUNT(*) n FROM mma_active_participants p WHERE p.source_fighter_id IS NULL AND NOT EXISTS(SELECT 1 FROM mma_active_fighters f WHERE f.normalized_name=p.normalized_name)`),
  unresolved_with_ambiguous_master_name:scalar(`SELECT COUNT(*) n FROM mma_active_participants p WHERE p.source_fighter_id IS NULL AND (SELECT COUNT(*) FROM mma_active_fighters f WHERE f.normalized_name=p.normalized_name)>1`),
  existing_overlay_resolutions:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted'`)
};

// Auto resolutions are reproducible derivations of the current active source snapshot.
// Rebuild them each run, but never overwrite a manual verified decision.
run(`DELETE FROM mma_participant_identity_resolutions
WHERE match_method IN ('global_builder_existing','metadata_auto')
  AND EXISTS(SELECT 1 FROM mma_source_registry s WHERE s.source_key=mma_participant_identity_resolutions.source_key AND s.active_snapshot_id=mma_participant_identity_resolutions.snapshot_id);`);

// First recover identities the global builder had already resolved from the same source
// metadata. Require exactly one materialized fighter on the fight whose master normalized
// name matches the unresolved participant, so same-name collisions remain unresolved.
run(`WITH matches AS (
  SELECT p.source_key,p.snapshot_id,p.source_fight_id,p.side,p.normalized_name,g.source_fighter_id,
         COUNT(*) OVER(PARTITION BY p.source_key,p.snapshot_id,p.source_fight_id,p.side) match_count
  FROM mma_active_participants p
  JOIN scout_active_global_fights g
    ON g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fight_id=p.source_fight_id
  JOIN mma_active_fighters f
    ON f.source_key=g.source_key AND f.snapshot_id=g.snapshot_id AND f.source_fighter_id=g.source_fighter_id
  WHERE p.source_fighter_id IS NULL AND f.normalized_name=p.normalized_name
)
INSERT INTO mma_participant_identity_resolutions(source_key,snapshot_id,source_fight_id,side,normalized_name,resolved_source_fighter_id,match_method,confidence,score,margin,evidence_json,status,updated_at)
SELECT source_key,snapshot_id,source_fight_id,side,normalized_name,source_fighter_id,'global_builder_existing',0.999,100,100,
       json_object('basis','existing materialized global-builder identity','matching_materialized_candidates',match_count),'accepted',CURRENT_TIMESTAMP
FROM matches
WHERE match_count=1
ON CONFLICT(source_key,snapshot_id,source_fight_id,side) DO NOTHING;`);

// Resolve a subset of the remaining ambiguous names only when independent biography
// evidence clearly separates one candidate. DOB is strongest; height/reach, nationality,
// gym and stance are supporting dimensions. No fuzzy-name guesses are made.
run(`WITH unresolved AS (
  SELECT p.*,
         COALESCE(o.source_fighter_id,orr.resolved_source_fighter_id) opponent_id
  FROM mma_active_participants p
  JOIN mma_active_participants o
    ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
  LEFT JOIN mma_participant_identity_resolutions orr
    ON orr.source_key=o.source_key AND orr.snapshot_id=o.snapshot_id AND orr.source_fight_id=o.source_fight_id AND orr.side=o.side AND orr.status='accepted'
  WHERE p.source_fighter_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM mma_participant_identity_resolutions existing WHERE existing.source_key=p.source_key AND existing.snapshot_id=p.snapshot_id AND existing.source_fight_id=p.source_fight_id AND existing.side=p.side AND existing.status='accepted')
), candidate_base AS (
  SELECT u.source_key,u.snapshot_id,u.source_fight_id,u.side,u.normalized_name,u.opponent_id,
         f.source_fighter_id,
         CASE WHEN u.dob IS NOT NULL AND trim(u.dob)<>'' AND f.dob IS NOT NULL AND trim(f.dob)<>'' AND substr(u.dob,1,10)=substr(f.dob,1,10) THEN 1 ELSE 0 END dob_match,
         CASE WHEN u.gym IS NOT NULL AND trim(u.gym)<>'' AND f.gym IS NOT NULL AND trim(f.gym)<>'' AND lower(trim(u.gym))=lower(trim(f.gym)) THEN 1 ELSE 0 END gym_match,
         CASE WHEN u.nationality IS NOT NULL AND trim(u.nationality)<>'' AND f.nationality IS NOT NULL AND trim(f.nationality)<>'' AND lower(trim(u.nationality))=lower(trim(f.nationality)) THEN 1 ELSE 0 END nationality_match,
         CASE WHEN u.height_cm IS NOT NULL AND f.height_cm IS NOT NULL AND abs(u.height_cm-f.height_cm)<=1.5 THEN 1 ELSE 0 END height_match,
         CASE WHEN u.reach_cm IS NOT NULL AND f.reach_cm IS NOT NULL AND abs(u.reach_cm-f.reach_cm)<=2.0 THEN 1 ELSE 0 END reach_match,
         CASE WHEN u.stance IS NOT NULL AND trim(u.stance)<>'' AND f.stance IS NOT NULL AND trim(f.stance)<>'' AND lower(trim(u.stance))=lower(trim(f.stance)) THEN 1 ELSE 0 END stance_match,
         (CASE WHEN u.dob IS NOT NULL AND trim(u.dob)<>'' AND f.dob IS NOT NULL AND trim(f.dob)<>'' AND substr(u.dob,1,10)=substr(f.dob,1,10) THEN 12 ELSE 0 END
          +CASE WHEN u.gym IS NOT NULL AND trim(u.gym)<>'' AND f.gym IS NOT NULL AND trim(f.gym)<>'' AND lower(trim(u.gym))=lower(trim(f.gym)) THEN 5 ELSE 0 END
          +CASE WHEN u.nationality IS NOT NULL AND trim(u.nationality)<>'' AND f.nationality IS NOT NULL AND trim(f.nationality)<>'' AND lower(trim(u.nationality))=lower(trim(f.nationality)) THEN 3 ELSE 0 END
          +CASE WHEN u.height_cm IS NOT NULL AND f.height_cm IS NOT NULL THEN CASE WHEN abs(u.height_cm-f.height_cm)<=1.5 THEN 4 WHEN abs(u.height_cm-f.height_cm)<=4 THEN 2 ELSE 0 END ELSE 0 END
          +CASE WHEN u.reach_cm IS NOT NULL AND f.reach_cm IS NOT NULL THEN CASE WHEN abs(u.reach_cm-f.reach_cm)<=2 THEN 4 WHEN abs(u.reach_cm-f.reach_cm)<=5 THEN 2 ELSE 0 END ELSE 0 END
          +CASE WHEN u.stance IS NOT NULL AND trim(u.stance)<>'' AND f.stance IS NOT NULL AND trim(f.stance)<>'' AND lower(trim(u.stance))=lower(trim(f.stance)) THEN 1 ELSE 0 END) score
  FROM unresolved u
  JOIN mma_active_fighters f ON f.normalized_name=u.normalized_name
  WHERE (u.opponent_id IS NULL OR f.source_fighter_id<>u.opponent_id)
    AND NOT (u.dob IS NOT NULL AND trim(u.dob)<>'' AND f.dob IS NOT NULL AND trim(f.dob)<>'' AND substr(u.dob,1,10)<>substr(f.dob,1,10))
    AND NOT (u.height_cm IS NOT NULL AND f.height_cm IS NOT NULL AND abs(u.height_cm-f.height_cm)>12)
    AND NOT (u.reach_cm IS NOT NULL AND f.reach_cm IS NOT NULL AND abs(u.reach_cm-f.reach_cm)>15)
), scored AS (
  SELECT *,dob_match+gym_match+nationality_match+height_match+reach_match+stance_match evidence_dimensions
  FROM candidate_base
), ranked AS (
  SELECT *,
         ROW_NUMBER() OVER(PARTITION BY source_key,snapshot_id,source_fight_id,side ORDER BY score DESC,source_fighter_id) rn,
         LEAD(score) OVER(PARTITION BY source_key,snapshot_id,source_fight_id,side ORDER BY score DESC,source_fighter_id) second_score,
         COUNT(*) OVER(PARTITION BY source_key,snapshot_id,source_fight_id,side) candidate_count
  FROM scored
)
INSERT INTO mma_participant_identity_resolutions(source_key,snapshot_id,source_fight_id,side,normalized_name,resolved_source_fighter_id,match_method,confidence,score,margin,evidence_json,status,updated_at)
SELECT source_key,snapshot_id,source_fight_id,side,normalized_name,source_fighter_id,'metadata_auto',
       CASE WHEN dob_match=1 AND score>=16 THEN 0.995 WHEN score>=14 THEN 0.99 WHEN score>=10 THEN 0.975 ELSE 0.95 END,
       score,CASE WHEN second_score IS NULL THEN score ELSE score-second_score END,
       json_object('dob_match',dob_match,'gym_match',gym_match,'nationality_match',nationality_match,'height_match',height_match,'reach_match',reach_match,'stance_match',stance_match,'evidence_dimensions',evidence_dimensions,'candidate_count',candidate_count,'second_score',second_score),
       'accepted',CURRENT_TIMESTAMP
FROM ranked
WHERE rn=1
  AND score>=7
  AND (dob_match=1 OR evidence_dimensions>=2)
  AND (second_score IS NULL OR score-second_score>=3)
ON CONFLICT(source_key,snapshot_id,source_fight_id,side) DO NOTHING;`);

const after={
  builder_existing:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='global_builder_existing'`),
  metadata_auto:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='metadata_auto'`),
  manual_verified:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='manual_verified'`),
  effective_unresolved_sides:scalar(`SELECT COUNT(*) n FROM mma_unresolved_participants`),
  effective_resolved_sides:scalar(`SELECT COUNT(*) n FROM mma_effective_participants WHERE effective_source_fighter_id IS NOT NULL`),
  unresolved_fights:scalar(`SELECT COUNT(DISTINCT source_key||'|'||snapshot_id||'|'||source_fight_id) n FROM mma_unresolved_participants`)
};
const confidenceBands=query(`SELECT CASE WHEN confidence>=0.995 THEN '99.5%+' WHEN confidence>=0.99 THEN '99-99.49%' WHEN confidence>=0.975 THEN '97.5-98.99%' ELSE '95-97.49%' END confidence_band,COUNT(*) resolutions FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='metadata_auto' GROUP BY confidence_band ORDER BY MIN(confidence) DESC`);
const highestImpact=query(`SELECT p.normalized_name,COUNT(*) unresolved_sides,(SELECT COUNT(*) FROM mma_active_fighters f WHERE f.normalized_name=p.normalized_name) master_candidates FROM mma_unresolved_participants p GROUP BY p.normalized_name ORDER BY unresolved_sides DESC,p.normalized_name LIMIT 50`);
const summary={checked_at:checkedAt,mode:remote?'remote':'local',before,after,resolved_this_layer:after.builder_existing+after.metadata_auto+after.manual_verified,confidence_bands:confidenceBands,highest_impact_remaining_names:highestImpact};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
console.log(`Participant identity overlay now resolves ${summary.resolved_this_layer} formerly ambiguous fighter sides; ${after.effective_unresolved_sides} sides remain unresolved.`);
