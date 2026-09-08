import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local');
if(Number(remote)+Number(local)!==1)throw new Error('Choose exactly one of --remote or --local');
const target=remote?'--remote':'--local';
const cache='.cache/participant-identity';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString();
const BATCH_ROWS=5000;
const MAX_FINGERPRINT_PASSES=4;

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
const active=`EXISTS(SELECT 1 FROM mma_source_registry s WHERE s.source_key=p.source_key AND s.active_snapshot_id=p.snapshot_id)`;
const acceptedOverlayCount=()=>scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted'`);

function refreshSeedFacts(){
  // Materialize the tiny accepted-identity fact set once per propagation pass. Joining every
  // unresolved batch back through the full participant table caused D1 CPU resets even when
  // the unresolved side itself was rowid-bounded.
  run(`DELETE FROM mma_participant_identity_seed_facts;`);
  run(`INSERT OR REPLACE INTO mma_participant_identity_seed_facts(
      source_key,snapshot_id,source_fight_id,side,normalized_name,resolved_source_fighter_id,
      dob,gym,nationality,height_cm,reach_cm,stance,updated_at)
    SELECT r.source_key,r.snapshot_id,r.source_fight_id,r.side,r.normalized_name,r.resolved_source_fighter_id,
           sp.dob,sp.gym,sp.nationality,sp.height_cm,sp.reach_cm,sp.stance,CURRENT_TIMESTAMP
    FROM mma_participant_identity_resolutions r
    JOIN mma_source_registry registry ON registry.source_key=r.source_key AND registry.active_snapshot_id=r.snapshot_id
    JOIN mma_fight_participants sp
      ON sp.source_key=r.source_key AND sp.snapshot_id=r.snapshot_id AND sp.source_fight_id=r.source_fight_id AND sp.side=r.side
    WHERE r.status='accepted';`);
  return scalar(`SELECT COUNT(*) n FROM mma_participant_identity_seed_facts`);
}

const rawUnresolved=scalar(`SELECT COUNT(*) n FROM mma_fight_participants p WHERE p.source_fighter_id IS NULL AND ${active}`);
const existingOverlay=acceptedOverlayCount();
const range=query(`SELECT MIN(p.rowid) min_rowid,MAX(p.rowid) max_rowid FROM mma_fight_participants p WHERE p.source_fighter_id IS NULL AND ${active}`)[0]||{};
const minRow=Number(range.min_rowid||0),maxRow=Number(range.max_rowid||0);
const before={raw_unresolved_sides:rawUnresolved,existing_overlay_resolutions:existingOverlay,min_unresolved_rowid:minRow,max_unresolved_rowid:maxRow,batch_rows:BATCH_ROWS};

// Auto resolutions are reproducible derivations of the current active source snapshot.
// Rebuild them each run, but never overwrite a manual verified decision.
run(`DELETE FROM mma_participant_identity_resolutions
WHERE match_method IN ('global_builder_existing','metadata_auto')
  AND EXISTS(SELECT 1 FROM mma_source_registry s WHERE s.source_key=mma_participant_identity_resolutions.source_key AND s.active_snapshot_id=mma_participant_identity_resolutions.snapshot_id);`);

let batches=0;
for(let lo=minRow;lo&&lo<=maxRow;lo+=BATCH_ROWS){
  const hi=Math.min(maxRow,lo+BATCH_ROWS-1);batches+=1;
  console.log(`Resolving participant identity batch ${batches}: rowid ${lo}-${hi}`);

  run(`WITH matches AS (
    SELECT p.source_key,p.snapshot_id,p.source_fight_id,p.side,p.normalized_name,g.source_fighter_id,
           COUNT(*) OVER(PARTITION BY p.source_key,p.snapshot_id,p.source_fight_id,p.side) match_count
    FROM mma_fight_participants p
    JOIN scout_global_fights g
      ON g.source_key=p.source_key AND g.snapshot_id=p.snapshot_id AND g.source_fight_id=p.source_fight_id
    JOIN mma_fighters f
      ON f.source_key=g.source_key AND f.snapshot_id=g.snapshot_id AND f.source_fighter_id=g.source_fighter_id
    WHERE p.rowid BETWEEN ${lo} AND ${hi}
      AND p.source_fighter_id IS NULL
      AND ${active}
      AND f.normalized_name=p.normalized_name
  )
  INSERT INTO mma_participant_identity_resolutions(source_key,snapshot_id,source_fight_id,side,normalized_name,resolved_source_fighter_id,match_method,confidence,score,margin,evidence_json,status,updated_at)
  SELECT source_key,snapshot_id,source_fight_id,side,normalized_name,source_fighter_id,'global_builder_existing',0.999,100,100,
         json_object('basis','existing materialized global-builder identity','matching_materialized_candidates',match_count),'accepted',CURRENT_TIMESTAMP
  FROM matches
  WHERE match_count=1
  ON CONFLICT(source_key,snapshot_id,source_fight_id,side) DO NOTHING;`);

  run(`WITH unresolved AS (
    SELECT p.*,
           COALESCE(o.source_fighter_id,orr.resolved_source_fighter_id) opponent_id
    FROM mma_fight_participants p
    JOIN mma_source_registry s ON s.source_key=p.source_key AND s.active_snapshot_id=p.snapshot_id
    JOIN mma_fight_participants o
      ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
    LEFT JOIN mma_participant_identity_resolutions orr
      ON orr.source_key=o.source_key AND orr.snapshot_id=o.snapshot_id AND orr.source_fight_id=o.source_fight_id AND orr.side=o.side AND orr.status='accepted'
    WHERE p.rowid BETWEEN ${lo} AND ${hi}
      AND p.source_fighter_id IS NULL
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
    JOIN mma_fighters f
      ON f.source_key=u.source_key AND f.snapshot_id=u.snapshot_id AND f.normalized_name=u.normalized_name
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
         json_object('basis','master_profile_metadata','dob_match',dob_match,'gym_match',gym_match,'nationality_match',nationality_match,'height_match',height_match,'reach_match',reach_match,'stance_match',stance_match,'evidence_dimensions',evidence_dimensions,'candidate_count',candidate_count,'second_score',second_score),
         'accepted',CURRENT_TIMESTAMP
  FROM ranked
  WHERE rn=1
    AND score>=7
    AND (dob_match=1 OR evidence_dimensions>=2)
    AND (second_score IS NULL OR score-second_score>=3)
  ON CONFLICT(source_key,snapshot_id,source_fight_id,side) DO NOTHING;`);
}

// A safely resolved ambiguous row is useful evidence for other rows carrying the exact same
// normalized name. Propagate only hard biography fingerprints from accepted rows. The seed
// facts are materialized and indexed before each pass so each 5k D1 query touches a compact
// candidate set instead of rebuilding a CTE over the full participant table.
let fingerprintPasses=0;
let fingerprintAdded=0;
let maxSeedFacts=0;
for(let pass=1;pass<=MAX_FINGERPRINT_PASSES;pass+=1){
  const passBefore=acceptedOverlayCount();
  const seedFacts=refreshSeedFacts();
  maxSeedFacts=Math.max(maxSeedFacts,seedFacts);
  if(seedFacts===0)break;
  console.log(`History-fingerprint pass ${pass} using ${seedFacts} indexed seed facts.`);

  for(let lo=minRow;lo&&lo<=maxRow;lo+=BATCH_ROWS){
    const hi=Math.min(maxRow,lo+BATCH_ROWS-1);
    run(`WITH unresolved AS (
      SELECT p.*,
             COALESCE(o.source_fighter_id,orr.resolved_source_fighter_id) opponent_id
      FROM mma_fight_participants p
      JOIN mma_source_registry registry ON registry.source_key=p.source_key AND registry.active_snapshot_id=p.snapshot_id
      JOIN mma_fight_participants o
        ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
      LEFT JOIN mma_participant_identity_resolutions orr
        ON orr.source_key=o.source_key AND orr.snapshot_id=o.snapshot_id AND orr.source_fight_id=o.source_fight_id AND orr.side=o.side AND orr.status='accepted'
      WHERE p.rowid BETWEEN ${lo} AND ${hi}
        AND p.source_fighter_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM mma_participant_identity_resolutions existing WHERE existing.source_key=p.source_key AND existing.snapshot_id=p.snapshot_id AND existing.source_fight_id=p.source_fight_id AND existing.side=p.side AND existing.status='accepted')
    ), candidate_evidence AS (
      SELECT u.source_key,u.snapshot_id,u.source_fight_id,u.side,u.normalized_name,u.opponent_id,
             s.resolved_source_fighter_id source_fighter_id,
             MAX(CASE WHEN u.dob IS NOT NULL AND trim(u.dob)<>'' AND s.dob IS NOT NULL AND trim(s.dob)<>'' AND substr(u.dob,1,10)=substr(s.dob,1,10) THEN 1 ELSE 0 END) dob_match,
             MAX(CASE WHEN u.dob IS NOT NULL AND trim(u.dob)<>'' AND s.dob IS NOT NULL AND trim(s.dob)<>'' AND substr(u.dob,1,10)<>substr(s.dob,1,10) THEN 1 ELSE 0 END) dob_conflict,
             MAX(CASE WHEN u.gym IS NOT NULL AND trim(u.gym)<>'' AND s.gym IS NOT NULL AND trim(s.gym)<>'' AND lower(trim(u.gym))=lower(trim(s.gym)) THEN 1 ELSE 0 END) gym_match,
             MAX(CASE WHEN u.nationality IS NOT NULL AND trim(u.nationality)<>'' AND s.nationality IS NOT NULL AND trim(s.nationality)<>'' AND lower(trim(u.nationality))=lower(trim(s.nationality)) THEN 1 ELSE 0 END) nationality_match,
             MAX(CASE WHEN u.height_cm IS NOT NULL AND s.height_cm IS NOT NULL AND abs(u.height_cm-s.height_cm)<=1.5 THEN 1 ELSE 0 END) height_match,
             MAX(CASE WHEN u.height_cm IS NOT NULL AND s.height_cm IS NOT NULL AND abs(u.height_cm-s.height_cm)>12 THEN 1 ELSE 0 END) height_conflict,
             MAX(CASE WHEN u.reach_cm IS NOT NULL AND s.reach_cm IS NOT NULL AND abs(u.reach_cm-s.reach_cm)<=2 THEN 1 ELSE 0 END) reach_match,
             MAX(CASE WHEN u.reach_cm IS NOT NULL AND s.reach_cm IS NOT NULL AND abs(u.reach_cm-s.reach_cm)>15 THEN 1 ELSE 0 END) reach_conflict,
             MAX(CASE WHEN u.stance IS NOT NULL AND trim(u.stance)<>'' AND s.stance IS NOT NULL AND trim(s.stance)<>'' AND lower(trim(u.stance))=lower(trim(s.stance)) THEN 1 ELSE 0 END) stance_match
      FROM unresolved u
      JOIN mma_participant_identity_seed_facts s
        ON s.source_key=u.source_key AND s.snapshot_id=u.snapshot_id AND s.normalized_name=u.normalized_name
      WHERE u.opponent_id IS NULL OR s.resolved_source_fighter_id<>u.opponent_id
      GROUP BY u.source_key,u.snapshot_id,u.source_fight_id,u.side,u.normalized_name,u.opponent_id,s.resolved_source_fighter_id
    ), scored AS (
      SELECT *,
             dob_match+gym_match+nationality_match+height_match+reach_match+stance_match evidence_dimensions,
             12*dob_match+5*gym_match+3*nationality_match+4*height_match+4*reach_match+stance_match score
      FROM candidate_evidence
      WHERE dob_conflict=0 AND height_conflict=0 AND reach_conflict=0
    ), ranked AS (
      SELECT *,
             ROW_NUMBER() OVER(PARTITION BY source_key,snapshot_id,source_fight_id,side ORDER BY score DESC,source_fighter_id) rn,
             LEAD(score) OVER(PARTITION BY source_key,snapshot_id,source_fight_id,side ORDER BY score DESC,source_fighter_id) second_score,
             COUNT(*) OVER(PARTITION BY source_key,snapshot_id,source_fight_id,side) candidate_count
      FROM scored
    )
    INSERT INTO mma_participant_identity_resolutions(source_key,snapshot_id,source_fight_id,side,normalized_name,resolved_source_fighter_id,match_method,confidence,score,margin,evidence_json,status,updated_at)
    SELECT source_key,snapshot_id,source_fight_id,side,normalized_name,source_fighter_id,'metadata_auto',
           CASE WHEN dob_match=1 AND score>=16 THEN 0.995 WHEN score>=14 THEN 0.99 WHEN score>=10 THEN 0.98 ELSE 0.96 END,
           score,CASE WHEN second_score IS NULL THEN score ELSE score-second_score END,
           json_object('basis','resolved_history_fingerprint','dob_match',dob_match,'gym_match',gym_match,'nationality_match',nationality_match,'height_match',height_match,'reach_match',reach_match,'stance_match',stance_match,'evidence_dimensions',evidence_dimensions,'candidate_count',candidate_count,'second_score',second_score),
           'accepted',CURRENT_TIMESTAMP
    FROM ranked
    WHERE rn=1
      AND score>=8
      AND (dob_match=1 OR evidence_dimensions>=2)
      AND (second_score IS NULL OR score-second_score>=4)
    ON CONFLICT(source_key,snapshot_id,source_fight_id,side) DO NOTHING;`);
  }

  const passAfter=acceptedOverlayCount();
  const added=Math.max(0,passAfter-passBefore);
  fingerprintPasses=pass;
  fingerprintAdded+=added;
  console.log(`History-fingerprint pass ${pass} added ${added} accepted participant identities.`);
  if(added===0)break;
}

const overlayResolved=scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id JOIN mma_fight_participants p ON p.source_key=r.source_key AND p.snapshot_id=r.snapshot_id AND p.source_fight_id=r.source_fight_id AND p.side=r.side WHERE r.status='accepted' AND p.source_fighter_id IS NULL`);
const rawResolved=scalar(`SELECT COUNT(*) n FROM mma_fight_participants p WHERE p.source_fighter_id IS NOT NULL AND ${active}`);
const totalActive=scalar(`SELECT COUNT(*) n FROM mma_fight_participants p WHERE ${active}`);
const after={
  builder_existing:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='global_builder_existing'`),
  metadata_auto:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='metadata_auto'`),
  master_profile_metadata_auto:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='metadata_auto' AND json_extract(r.evidence_json,'$.basis')='master_profile_metadata'`),
  history_fingerprint_auto:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='metadata_auto' AND json_extract(r.evidence_json,'$.basis')='resolved_history_fingerprint'`),
  manual_verified:scalar(`SELECT COUNT(*) n FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='manual_verified'`),
  overlay_resolved_sides:overlayResolved,
  effective_unresolved_sides:Math.max(0,rawUnresolved-overlayResolved),
  effective_resolved_sides:rawResolved+overlayResolved,
  active_participant_sides:totalActive,
  batches_processed:batches,
  fingerprint_passes:fingerprintPasses,
  fingerprint_added:fingerprintAdded,
  max_seed_facts:maxSeedFacts
};

const confidenceBands=query(`SELECT CASE WHEN confidence>=0.995 THEN '99.5%+' WHEN confidence>=0.99 THEN '99-99.49%' WHEN confidence>=0.975 THEN '97.5-98.99%' ELSE '95-97.49%' END confidence_band,COUNT(*) resolutions FROM mma_participant_identity_resolutions r JOIN mma_source_registry s ON s.source_key=r.source_key AND s.active_snapshot_id=r.snapshot_id WHERE r.status='accepted' AND r.match_method='metadata_auto' GROUP BY confidence_band ORDER BY MIN(confidence) DESC`);

const backlogByName=new Map();
for(let lo=minRow;lo&&lo<=maxRow;lo+=BATCH_ROWS){
  const hi=Math.min(maxRow,lo+BATCH_ROWS-1);
  const rows=query(`SELECT p.source_key,p.snapshot_id,p.normalized_name,MIN(p.fighter_name) fighter_name,COUNT(*) unresolved_sides,
      SUM(CASE WHEN f.outcome<>'unknown' AND f.event_date<=date('now') AND p.result IN ('W','L','D','NC') THEN 1 ELSE 0 END) completed_sides,
      SUM(CASE WHEN COALESCE(o.source_fighter_id,orr.resolved_source_fighter_id) IS NOT NULL THEN 1 ELSE 0 END) known_opponent_sides,
      SUM(CASE WHEN ((p.dob IS NOT NULL AND trim(p.dob)<>'')+(p.gym IS NOT NULL AND trim(p.gym)<>'')+(p.nationality IS NOT NULL AND trim(p.nationality)<>'')+(p.height_cm IS NOT NULL)+(p.reach_cm IS NOT NULL)+(p.stance IS NOT NULL AND trim(p.stance)<>''))>=2 THEN 1 ELSE 0 END) sides_with_2plus_bio_dimensions,
      (SELECT COUNT(*) FROM mma_fighters mf WHERE mf.source_key=p.source_key AND mf.snapshot_id=p.snapshot_id AND mf.normalized_name=p.normalized_name) master_candidates,
      MIN(f.event_date) first_event_date,MAX(f.event_date) last_event_date
    FROM mma_fight_participants p
    JOIN mma_source_registry registry ON registry.source_key=p.source_key AND registry.active_snapshot_id=p.snapshot_id
    JOIN mma_fights f ON f.source_key=p.source_key AND f.snapshot_id=p.snapshot_id AND f.source_fight_id=p.source_fight_id
    JOIN mma_fight_participants o ON o.source_key=p.source_key AND o.snapshot_id=p.snapshot_id AND o.source_fight_id=p.source_fight_id AND o.side<>p.side
    LEFT JOIN mma_participant_identity_resolutions r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fight_id=p.source_fight_id AND r.side=p.side AND r.status='accepted'
    LEFT JOIN mma_participant_identity_resolutions orr ON orr.source_key=o.source_key AND orr.snapshot_id=o.snapshot_id AND orr.source_fight_id=o.source_fight_id AND orr.side=o.side AND orr.status='accepted'
    WHERE p.rowid BETWEEN ${lo} AND ${hi} AND p.source_fighter_id IS NULL AND r.source_fight_id IS NULL
    GROUP BY p.source_key,p.snapshot_id,p.normalized_name`);
  for(const row of rows){
    const key=`${row.source_key}|${row.snapshot_id}|${row.normalized_name}`;
    const current=backlogByName.get(key)||{source_key:String(row.source_key||''),snapshot_id:String(row.snapshot_id||''),normalized_name:String(row.normalized_name||''),fighter_name:String(row.fighter_name||''),unresolved_sides:0,completed_sides:0,known_opponent_sides:0,sides_with_2plus_bio_dimensions:0,master_candidates:Number(row.master_candidates||0),first_event_date:null,last_event_date:null};
    current.unresolved_sides+=Number(row.unresolved_sides||0);
    current.completed_sides+=Number(row.completed_sides||0);
    current.known_opponent_sides+=Number(row.known_opponent_sides||0);
    current.sides_with_2plus_bio_dimensions+=Number(row.sides_with_2plus_bio_dimensions||0);
    current.master_candidates=Math.max(current.master_candidates,Number(row.master_candidates||0));
    const first=String(row.first_event_date||'');const last=String(row.last_event_date||'');
    if(first&&(!current.first_event_date||first<current.first_event_date))current.first_event_date=first;
    if(last&&(!current.last_event_date||last>current.last_event_date))current.last_event_date=last;
    backlogByName.set(key,current);
  }
}
const backlogNames=[...backlogByName.values()];
const category=(predicate)=>backlogNames.filter(predicate).reduce((acc,row)=>({names:acc.names+1,unresolved_sides:acc.unresolved_sides+row.unresolved_sides,completed_sides:acc.completed_sides+row.completed_sides,known_opponent_sides:acc.known_opponent_sides+row.known_opponent_sides,sides_with_2plus_bio_dimensions:acc.sides_with_2plus_bio_dimensions+row.sides_with_2plus_bio_dimensions}),{names:0,unresolved_sides:0,completed_sides:0,known_opponent_sides:0,sides_with_2plus_bio_dimensions:0});
const backlog={
  no_master_candidate:category(row=>row.master_candidates===0),
  single_master_candidate_anomaly:category(row=>row.master_candidates===1),
  ambiguous_master_candidates:category(row=>row.master_candidates>=2),
  top_completed_history_holes:backlogNames.filter(row=>row.completed_sides>0).sort((a,b)=>b.completed_sides-a.completed_sides||b.known_opponent_sides-a.known_opponent_sides||a.normalized_name.localeCompare(b.normalized_name)).slice(0,75)
};

const summary={checked_at:checkedAt,mode:remote?'remote':'local',before,after,resolved_this_layer:overlayResolved,confidence_bands:confidenceBands,remaining_backlog:backlog};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
console.log(`Participant identity overlay resolves ${overlayResolved} formerly ambiguous fighter sides; ${after.effective_unresolved_sides} sides remain unresolved.`);
console.log(`Remaining completed-history holes: ${backlog.no_master_candidate.completed_sides} sides have no fighter-master candidate; ${backlog.ambiguous_master_candidates.completed_sides} sides have multiple same-name candidates.`);
