import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {MANAGEMENT_SOURCES,applyManagementAliases,normalizeManagementName,parseManagementRoster} from './lib/management-sources.mjs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local';
const cache='.cache/management';mkdirSync(cache,{recursive:true});
const aliases=JSON.parse(readFileSync('scripts/data/management-name-aliases.json','utf8'));
const checkedAt=new Date().toISOString();

const q=v=>v===null||v===undefined||v===''?'NULL':`'${String(v).replaceAll("'","''")}'`;

function wrangler(params,capture=false){
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{
    encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:30*1024*1024,env:process.env
  })||'';
}
function query(sql){
  const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  return blocks.flatMap(block=>block?.results||[]);
}
async function fetchHtml(url){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(45000),headers:{'accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts management research; +https://mmascouts.com/)'}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const agencies=[],entries=[];
for(const agency of MANAGEMENT_SOURCES){
  const sourceRows=[],profileRows=[];let rosterReachable=0,profileReachable=0;
  for(const [index,url] of (agency.urls||[]).entries()){
    try{
      const html=await fetchHtml(url);rosterReachable++;
      writeFileSync(`${cache}/${agency.slug}-roster-${index+1}.html`,html);
      const names=parseManagementRoster(html,agency);
      for(const rawName of names){
        const canonical=applyManagementAliases(rawName,aliases),normalized=normalizeManagementName(canonical);
        if(normalized)entries.push({agency_slug:agency.slug,agency_name:agency.name,confidence:agency.confidence,source_url:url,raw_name:rawName,canonical_name:canonical,normalized_name:normalized});
      }
      sourceRows.push({url,status:'ok',candidates:names.length});
    }catch(error){sourceRows.push({url,status:'error',error:error instanceof Error?error.message:String(error),candidates:0});}
  }
  for(const [index,url] of (agency.profileUrls||[]).entries()){
    try{
      const html=await fetchHtml(url);profileReachable++;
      writeFileSync(`${cache}/${agency.slug}-profile-${index+1}.html`,html);
      profileRows.push({url,status:'ok'});
    }catch(error){profileRows.push({url,status:'error',error:error instanceof Error?error.message:String(error)});}
  }
  const reachable=rosterReachable>0||profileReachable>0;
  agencies.push({...agency,reachable,rosterReachable,profileReachable,sources:sourceRows,profileSources:profileRows});
}

const deduped=[];const seen=new Set();
for(const row of entries){const key=`${row.agency_slug}:${row.normalized_name}`;if(!seen.has(key)){seen.add(key);deduped.push(row);}}
const agenciesByName=new Map();
for(const row of deduped){if(!agenciesByName.has(row.normalized_name))agenciesByName.set(row.normalized_name,new Set());agenciesByName.get(row.normalized_name).add(row.agency_slug);}
const sourceConflicts=deduped.filter(row=>(agenciesByName.get(row.normalized_name)?.size||0)>1);
const conflictNames=new Set(sourceConflicts.map(row=>row.normalized_name));
const reachableAgencies=agencies.filter(a=>a.reachable);

if(dry){
  const summary={checked_at:checkedAt,mode:'dry-run',agencies:agencies.map(a=>({slug:a.slug,name:a.name,reachable:a.reachable,roster_scope:a.rosterScope,roster_reachable:a.rosterReachable,profile_reachable:a.profileReachable,sources:a.sources,profile_sources:a.profileSources})),candidates:deduped.length,cross_agency_conflict_names:conflictNames.size,cross_agency_conflicts:sourceConflicts};
  writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
  console.log(`Management dry run parsed ${deduped.length} unique agency/name candidates across ${reachableAgencies.length}/${agencies.length} reachable verified agency profiles; ${conflictNames.size} names are claimed by multiple roster sources and will be skipped.`);
  process.exit(0);
}

const uniqueNames=[...new Set(deduped.map(row=>row.normalized_name))];
const profiles=[];
for(let i=0;i<uniqueNames.length;i+=70){
  const batch=uniqueNames.slice(i,i+70);
  if(!batch.length)continue;
  profiles.push(...query(`SELECT source_key,source_fighter_id,profile_slug,fighter_name,normalized_name,last_fight_date FROM scout_active_global_profiles WHERE normalized_name IN (${batch.map(q).join(',')})`));
}
const byName=new Map();
for(const profile of profiles){const key=String(profile.normalized_name||'');if(!byName.has(key))byName.set(key,[]);byName.get(key).push(profile);}

const matched=[],unmatched=[],ambiguous=[];
for(const row of deduped){
  if(conflictNames.has(row.normalized_name))continue;
  const hits=byName.get(row.normalized_name)||[];
  if(hits.length===1)matched.push({...row,profile:hits[0]});
  else if(hits.length>1)ambiguous.push({...row,matches:hits.map(h=>({profile_slug:h.profile_slug,fighter_name:h.fighter_name,source_fighter_id:h.source_fighter_id}))});
  else unmatched.push(row);
}

const sql=[];
for(const agency of reachableAgencies){
  sql.push(`INSERT INTO management_agencies(slug,name,country,website_url,description,active,verified_at,updated_at) VALUES(${q(agency.slug)},${q(agency.name)},${q(agency.country)},${q(agency.website)},${q(agency.description)},1,${q(checkedAt)},CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,country=excluded.country,website_url=excluded.website_url,description=excluded.description,active=1,verified_at=excluded.verified_at,updated_at=CURRENT_TIMESTAMP;`);
  for(const item of agency.profileSources.filter(source=>source.status==='ok')){
    sql.push(`INSERT OR IGNORE INTO management_agency_sources(agency_id,source_url,source_title,source_type,verified_at,last_checked_at) SELECT id,${q(item.url)},${q(`${agency.name} official profile`)},'official_profile',${q(checkedAt)},CURRENT_TIMESTAMP FROM management_agencies WHERE slug=${q(agency.slug)};`);
    sql.push(`UPDATE management_agency_sources SET source_title=${q(`${agency.name} official profile`)},source_type='official_profile',verified_at=${q(checkedAt)},last_checked_at=CURRENT_TIMESTAMP WHERE agency_id=(SELECT id FROM management_agencies WHERE slug=${q(agency.slug)} LIMIT 1) AND source_url=${q(item.url)};`);
  }
  for(const item of agency.sources.filter(source=>source.status==='ok')){
    sql.push(`INSERT OR IGNORE INTO management_agency_sources(agency_id,source_url,source_title,source_type,verified_at,last_checked_at) SELECT id,${q(item.url)},${q(`${agency.name} official fighter roster`)},'official_roster',${q(checkedAt)},CURRENT_TIMESTAMP FROM management_agencies WHERE slug=${q(agency.slug)};`);
    sql.push(`UPDATE management_agency_sources SET source_title=${q(`${agency.name} official fighter roster`)},source_type='official_roster',verified_at=${q(checkedAt)},last_checked_at=CURRENT_TIMESTAMP WHERE agency_id=(SELECT id FROM management_agencies WHERE slug=${q(agency.slug)} LIMIT 1) AND source_url=${q(item.url)};`);
  }
}
for(const row of matched){
  const p=row.profile,sourceType='official_agency_roster';
  sql.push(`UPDATE fighter_management_history SET source_url=${q(row.source_url)},source_type=${q(sourceType)},confidence=${q(row.confidence)},verified_at=${q(checkedAt)},last_checked_at=CURRENT_TIMESTAMP WHERE source_key=${q(p.source_key)} AND source_fighter_id=${q(p.source_fighter_id)} AND is_current=1 AND agency_id=(SELECT id FROM management_agencies WHERE slug=${q(row.agency_slug)} LIMIT 1);`);
  sql.push(`INSERT INTO fighter_management_history(source_key,source_fighter_id,agency_id,manager_name,started_at,ended_at,is_current,source_url,source_type,confidence,verified_at,last_checked_at,notes) SELECT ${q(p.source_key)},${q(p.source_fighter_id)},id,NULL,NULL,NULL,1,${q(row.source_url)},${q(sourceType)},${q(row.confidence)},${q(checkedAt)},CURRENT_TIMESTAMP,'Imported from official agency roster; absence from a future scrape will not automatically end representation.' FROM management_agencies WHERE slug=${q(row.agency_slug)} AND NOT EXISTS(SELECT 1 FROM fighter_management_history h WHERE h.source_key=${q(p.source_key)} AND h.source_fighter_id=${q(p.source_fighter_id)} AND h.is_current=1);`);
  sql.push(`INSERT OR IGNORE INTO fighter_management_evidence(management_history_id,source_url,source_title,publisher,source_type,confidence,verified_at,last_checked_at,notes) SELECT h.id,${q(row.source_url)},${q(`${row.agency_name} official fighter roster`)},${q(row.agency_name)},${q(sourceType)},${q(row.confidence)},${q(checkedAt)},CURRENT_TIMESTAMP,'Official agency roster evidence.' FROM fighter_management_history h JOIN management_agencies a ON a.id=h.agency_id WHERE h.source_key=${q(p.source_key)} AND h.source_fighter_id=${q(p.source_fighter_id)} AND h.is_current=1 AND a.slug=${q(row.agency_slug)} LIMIT 1;`);
  sql.push(`UPDATE fighter_management_evidence SET source_title=${q(`${row.agency_name} official fighter roster`)},publisher=${q(row.agency_name)},source_type=${q(sourceType)},confidence=${q(row.confidence)},verified_at=${q(checkedAt)},last_checked_at=CURRENT_TIMESTAMP,notes='Official agency roster evidence.' WHERE management_history_id=(SELECT h.id FROM fighter_management_history h JOIN management_agencies a ON a.id=h.agency_id WHERE h.source_key=${q(p.source_key)} AND h.source_fighter_id=${q(p.source_fighter_id)} AND h.is_current=1 AND a.slug=${q(row.agency_slug)} LIMIT 1) AND source_url=${q(row.source_url)};`);
  sql.push(`INSERT INTO fighter_opportunity_status(source_key,source_fighter_id,management_status,contract_status,open_to_fights,open_to_management,open_to_team,source_url,source_type,confidence,verified_at,last_checked_at) VALUES(${q(p.source_key)},${q(p.source_fighter_id)},'represented','unknown','unknown','unknown','unknown',${q(row.source_url)},${q(sourceType)},${q(row.confidence)},${q(checkedAt)},CURRENT_TIMESTAMP) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET management_status='represented',source_url=excluded.source_url,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);
}

writeFileSync(`${cache}/sync.sql`,sql.join('\n')+'\n');
if(sql.length)wrangler(['d1','execute','cagemetrix',target,'--file',`${cache}/sync.sql`]);
const verification=query(`SELECT a.slug,a.name,COUNT(h.id) current_fighters FROM management_agencies a LEFT JOIN fighter_management_history h ON h.agency_id=a.id AND h.is_current=1 WHERE a.active=1 GROUP BY a.id ORDER BY current_fighters DESC,a.name`);
const currentOfficial=query(`SELECT p.profile_slug,p.fighter_name,a.name current_agency,m.confidence,m.source_url,m.verified_at FROM scout_current_management m JOIN management_agencies a ON a.id=m.agency_id JOIN scout_active_global_profiles p ON p.source_key=m.source_key AND p.source_fighter_id=m.source_fighter_id WHERE m.source_type='official_agency_roster' ORDER BY a.name,p.fighter_name LIMIT 1000`);
const evidenceVerification=query(`SELECT a.slug,COUNT(DISTINCT s.id) agency_sources,COUNT(DISTINCT me.id) representation_evidence FROM management_agencies a LEFT JOIN management_agency_sources s ON s.agency_id=a.id LEFT JOIN fighter_management_history h ON h.agency_id=a.id AND h.is_current=1 LEFT JOIN fighter_management_evidence me ON me.management_history_id=h.id WHERE a.active=1 GROUP BY a.id ORDER BY a.slug`);
const summary={checked_at:checkedAt,mode:remote?'remote':'local',agencies:agencies.map(a=>({slug:a.slug,name:a.name,reachable:a.reachable,roster_scope:a.rosterScope,roster_reachable:a.rosterReachable,profile_reachable:a.profileReachable,sources:a.sources,profile_sources:a.profileSources})),candidate_names:deduped.length,matched:matched.length,unmatched:unmatched.length,ambiguous:ambiguous.length,cross_agency_conflict_names:conflictNames.size,verification,evidence_verification:evidenceVerification,matched_rows:matched.map(r=>({agency_slug:r.agency_slug,raw_name:r.raw_name,canonical_name:r.canonical_name,profile_slug:r.profile.profile_slug,fighter_name:r.profile.fighter_name,source_url:r.source_url,confidence:r.confidence})),unmatched_rows:unmatched,ambiguous_rows:ambiguous,cross_agency_conflicts:sourceConflicts,current_official_rows:currentOfficial};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(`Management sync matched ${matched.length}/${deduped.length} roster candidates (${unmatched.length} unmatched, ${ambiguous.length} ambiguous, ${conflictNames.size} cross-agency conflicts) across ${reachableAgencies.length}/${agencies.length} reachable verified agency profiles.`);
