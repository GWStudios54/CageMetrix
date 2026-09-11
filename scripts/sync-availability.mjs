import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {AVAILABILITY_SOURCES,normalizeAvailabilityName,parseAkFightAvailability} from './lib/availability-sources.mjs';

const args=process.argv.slice(2),remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local',cache='.cache/availability';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString(),q=value=>value===null||value===undefined||value===''?'NULL':"'" + String(value).replaceAll("'","''") + "'";

function wrangler(params,capture=false){return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:40*1024*1024,env:process.env})||'';}
function query(sql){const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));return blocks.flatMap(block=>block?.results||[]);}
async function fetchHtml(url){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(35000),headers:{accept:'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts availability research; +https://mmascouts.com/)'}});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return response.text();
}

const discovered=[],sourceAudit=[];
for(const source of AVAILABILITY_SOURCES){
  try{
    const html=await fetchHtml(source.url);writeFileSync(cache+'/'+source.slug+'.html',html);
    const names=parseAkFightAvailability(html);
    if(!names.length)throw new Error('No explicit availability names parsed');
    for(const fighterName of names)discovered.push({source,fighterName,normalizedName:normalizeAvailabilityName(fighterName)});
    sourceAudit.push({slug:source.slug,status:'ok',candidates:names.length});
    console.log(source.publisher+': '+names.length+' explicitly available fighter(s).');
  }catch(error){
    sourceAudit.push({slug:source.slug,status:'error',error:error instanceof Error?error.message:String(error),candidates:0});
  }
}

if(dry){
  const summary={checked_at:checkedAt,mode:'dry-run',sources:sourceAudit,candidates:discovered.length,names:discovered.map(row=>row.fighterName)};
  writeFileSync(cache+'/summary.json',JSON.stringify(summary,null,2)+'\n');
  if(!sourceAudit.some(row=>row.status==='ok'))throw new Error('All availability sources failed');
  console.log('Availability probe found '+discovered.length+' explicit agency availability candidate(s).');
  process.exit(0);
}

const names=[...new Set(discovered.map(row=>row.normalizedName))],profiles=[];
for(let i=0;i<names.length;i+=70){
  const batch=names.slice(i,i+70);
  profiles.push(...query('SELECT source_key,source_fighter_id,profile_slug,fighter_name,normalized_name FROM scout_active_global_profiles WHERE normalized_name IN ('+batch.map(q).join(',')+')'));
}
const byName=new Map();
for(const profile of profiles){const key=String(profile.normalized_name||normalizeAvailabilityName(profile.fighter_name));if(!byName.has(key))byName.set(key,[]);byName.get(key).push(profile);}
const matched=[],unmatched=[],ambiguous=[];
for(const row of discovered){
  const hits=byName.get(row.normalizedName)||[];
  if(hits.length===1)matched.push({...row,profile:hits[0]});
  else if(hits.length>1)ambiguous.push({...row,matches:hits.map(hit=>({profile_slug:hit.profile_slug,source_fighter_id:hit.source_fighter_id}))});
  else unmatched.push(row);
}

for(const source of AVAILABILITY_SOURCES.filter(source=>sourceAudit.some(row=>row.slug===source.slug&&row.status==='ok'))){
  query("UPDATE fighter_availability_evidence SET is_current=0,last_checked_at=CURRENT_TIMESTAMP WHERE publisher="+q(source.publisher)+" AND availability_kind="+q(source.availabilityKind)+" AND is_current=1");
}
const sql=[];
for(const row of matched){
  const source=row.source,p=row.profile;
  sql.push('INSERT INTO fighter_availability_evidence(source_key,source_fighter_id,availability_kind,availability_status,source_url,source_title,publisher,source_type,confidence,is_current,verified_at,last_checked_at,notes) VALUES('+
    [q(p.source_key),q(p.source_fighter_id),q(source.availabilityKind),q('yes'),q(source.url),q(source.publisher+' — Looking for Opportunities'),q(source.publisher),q(source.sourceType),q(source.confidence),'1',q(checkedAt),q(checkedAt),q('Official management roster explicitly groups this athlete under Looking for Opportunities.')].join(',')+
    ') ON CONFLICT(source_key,source_fighter_id,source_url,availability_kind) DO UPDATE SET availability_status=excluded.availability_status,is_current=1,verified_at=excluded.verified_at,last_checked_at=excluded.last_checked_at,notes=excluded.notes;');
}
if(sql.length){writeFileSync(cache+'/sync.sql',sql.join('\n')+'\n');wrangler(['d1','execute','cagemetrix',target,'--file',cache+'/sync.sql']);}
const summary={checked_at:checkedAt,mode:remote?'remote':'local',sources:sourceAudit,candidates:discovered.length,matched:matched.length,unmatched:unmatched.length,ambiguous:ambiguous.length,matched_names:matched.map(row=>row.fighterName),unmatched_names:unmatched.map(row=>row.fighterName),ambiguous_names:ambiguous.map(row=>({fighter_name:row.fighterName,matches:row.matches}))};
writeFileSync(cache+'/summary.json',JSON.stringify(summary,null,2)+'\n');
console.log('Availability sync matched '+matched.length+'/'+discovered.length+' candidates ('+unmatched.length+' unmatched, '+ambiguous.length+' ambiguous).');
