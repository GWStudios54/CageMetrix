import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {FIGHTER_CONTACT_SOURCES,normalizeFighterContactName,parse3MgtAthleteContacts} from './lib/fighter-contact-sources.mjs';

const args=process.argv.slice(2),remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local',cache='.cache/fighter-contacts';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString(),q=value=>value===null||value===undefined||value===''?'NULL':"'" + String(value).replaceAll("'","''") + "'";

function wrangler(params,capture=false){
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:40*1024*1024,env:process.env})||'';
}
function query(sql){
  const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  return blocks.flatMap(block=>block?.results||[]);
}
async function fetchHtml(url){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(35000),headers:{accept:'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts fighter contact research; +https://mmascouts.com/)'}});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return response.text();
}

const sourceAudit=[],observations=[];
for(const source of FIGHTER_CONTACT_SOURCES){
  try{
    const html=await fetchHtml(source.url);writeFileSync(cache+'/'+source.slug+'.html',html);
    const rows=parse3MgtAthleteContacts(html,source),withContact=rows.filter(row=>row.email);
    if(rows.length<Number(source.minimumRosterCount||1))throw new Error('Roster parse below healthy minimum: '+rows.length);
    if(withContact.length<Number(source.minimumContactCount||1))throw new Error('Contact parse below healthy minimum: '+withContact.length);
    observations.push(...rows.map(row=>({...row,source})));
    sourceAudit.push({slug:source.slug,publisher:source.publisher,status:'ok',roster_names:rows.length,public_contacts:withContact.length});
    console.log(source.publisher+': '+withContact.length+'/'+rows.length+' roster athletes publish fighter-specific professional contact.');
  }catch(error){
    sourceAudit.push({slug:source.slug,publisher:source.publisher,status:'error',roster_names:0,public_contacts:0,error:error instanceof Error?error.message:String(error)});
  }
}

if(dry){
  const summary={checked_at:checkedAt,mode:'dry-run',sources:sourceAudit,candidates:observations.length,with_contact:observations.filter(row=>row.email).length,rows:observations.map(row=>({fighter_name:row.fighter_name,email:row.email?row.email.replace(/^[^@]+/,'***'):null,source:row.source.slug}))};
  writeFileSync(cache+'/summary.json',JSON.stringify(summary,null,2)+'\n');
  if(!sourceAudit.some(row=>row.status==='ok'))throw new Error('All fighter contact sources failed health checks');
  console.log('Fighter contact probe found '+summary.with_contact+' public fighter-specific route(s) across '+summary.candidates+' healthy roster athlete(s).');
  process.exit(0);
}

const names=[...new Set(observations.map(row=>row.normalized_name).filter(Boolean))],profiles=[];
for(let i=0;i<names.length;i+=70){
  const batch=names.slice(i,i+70);
  profiles.push(...query('SELECT source_key,source_fighter_id,profile_slug,fighter_name,normalized_name FROM scout_active_global_profiles WHERE normalized_name IN ('+batch.map(q).join(',')+')'));
}
const byName=new Map();
for(const profile of profiles){
  const key=String(profile.normalized_name||normalizeFighterContactName(profile.fighter_name));
  if(!byName.has(key))byName.set(key,[]);
  byName.get(key).push(profile);
}

const matched=[],unmatched=[],ambiguous=[];
for(const row of observations){
  const hits=byName.get(row.normalized_name)||[];
  if(hits.length===1)matched.push({...row,profile:hits[0]});
  else if(hits.length>1)ambiguous.push({...row,matches:hits.map(hit=>({profile_slug:hit.profile_slug,source_fighter_id:hit.source_fighter_id}))});
  else unmatched.push(row);
}

const statements=[];
for(const source of FIGHTER_CONTACT_SOURCES.filter(source=>sourceAudit.some(row=>row.slug===source.slug&&row.status==='ok'))){
  statements.push("UPDATE fighter_professional_contacts SET is_current=0,last_checked_at="+q(checkedAt)+" WHERE publisher="+q(source.publisher)+" AND source_url="+q(source.url)+" AND is_current=1;");
}
for(const row of matched){
  if(!row.email)continue;
  const source=row.source,p=row.profile;
  statements.push(
    'INSERT INTO fighter_professional_contacts(source_key,source_fighter_id,contact_kind,contact_value,label,publisher,source_url,source_title,source_type,confidence,is_current,verified_at,last_checked_at,notes) VALUES('+
    [q(p.source_key),q(p.source_fighter_id),q(source.contactKind),q(row.email),q('Fighter-specific management email'),q(source.publisher),q(source.url),q(source.publisher+' official athlete roster'),q(source.sourceType),q(source.confidence),'1',q(checkedAt),q(checkedAt),q('Public professional email published beside this fighter on the official management-agency athlete roster.')].join(',')+
    ') ON CONFLICT(source_key,source_fighter_id,contact_kind,contact_value,source_url) DO UPDATE SET label=excluded.label,publisher=excluded.publisher,source_title=excluded.source_title,source_type=excluded.source_type,confidence=excluded.confidence,is_current=1,verified_at=excluded.verified_at,last_checked_at=excluded.last_checked_at,notes=excluded.notes;'
  );
}
if(statements.length){
  writeFileSync(cache+'/sync.sql',statements.join('\n')+'\n');
  wrangler(['d1','execute','cagemetrix',target,'--file',cache+'/sync.sql']);
}
const coverage=query(`SELECT
  COUNT(*) current_fighter_contacts,
  SUM(CASE WHEN cm.source_fighter_id IS NOT NULL THEN 1 ELSE 0 END) represented_with_fighter_contact
  FROM scout_current_fighter_contact fc
  LEFT JOIN scout_current_management cm ON cm.source_key=fc.source_key AND cm.source_fighter_id=fc.source_fighter_id`)[0]||{};
const summary={checked_at:checkedAt,mode:remote?'remote':'local',sources:sourceAudit,candidates:observations.length,matched:matched.length,matched_with_contact:matched.filter(row=>row.email).length,unmatched:unmatched.length,ambiguous:ambiguous.length,coverage,matched_rows:matched.filter(row=>row.email).map(row=>({fighter_name:row.fighter_name,profile_slug:row.profile.profile_slug,source:row.source.slug})),unmatched_names:unmatched.map(row=>row.fighter_name),ambiguous_names:ambiguous.map(row=>({fighter_name:row.fighter_name,matches:row.matches}))};
writeFileSync(cache+'/summary.json',JSON.stringify(summary,null,2)+'\n');
console.log('Fighter contact sync matched '+matched.filter(row=>row.email).length+'/'+observations.filter(row=>row.email).length+' published contact candidates ('+unmatched.length+' unmatched, '+ambiguous.length+' ambiguous); '+Number(coverage.current_fighter_contacts||0)+' current fighter-specific contact(s).');
