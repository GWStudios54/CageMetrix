import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {PFL_LOCATION_SOURCE,extractPflCsrfToken,normalizeFighterName,parsePflAjaxPayload,parsePflProfile,parsePflRoster} from './lib/promotion-location-sources.mjs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local',cache='.cache/promotion-location';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString();
const q=value=>value===null||value===undefined||value===''?'NULL':"'" + String(value).replaceAll("'","''") + "'";

function wrangler(params,capture=false){
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:60*1024*1024,env:process.env})||'';
}
function query(sql){
  const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  return blocks.flatMap(block=>block?.results||[]);
}
async function fetchHtml(url,attempts=3){
  let last;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(35000),headers:{accept:'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts professional location research; +https://mmascouts.com/)'}});
      if(!response.ok)throw new Error('HTTP '+response.status);
      return await response.text();
    }catch(error){
      last=error;
      if(attempt<attempts)await new Promise(resolve=>setTimeout(resolve,400*attempt));
    }
  }
  throw last instanceof Error?last:new Error(String(last||'fetch failed'));
}

async function fetchSessionPage(url){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(35000),headers:{accept:'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts professional location research; +https://mmascouts.com/)'}});
  if(!response.ok)throw new Error('HTTP '+response.status);
  const setCookies=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[];
  const cookieHeader=setCookies.map(value=>String(value).split(';')[0]).filter(Boolean).join('; ');
  return {html:await response.text(),cookieHeader};
}

const source=PFL_LOCATION_SOURCE;
const sessionPage=await fetchSessionPage(source.rosterUrl);
const rosterHtml=sessionPage.html,cookieHeader=sessionPage.cookieHeader;
writeFileSync(cache+'/pfl-roster.html',rosterHtml);
const linkMap=new Map(parsePflRoster(rosterHtml,source).map(row=>[row.url,row]));
const csrf=extractPflCsrfToken(rosterHtml);
const ajaxAudit=[];
if(csrf){
  const endpoint=new URL('/ajax/query_fighters',source.rosterUrl).href;
  for(let page=2;page<=100;page++){
    try{
      const form=new FormData();
      form.append('season_type','');
      form.append('season_year','');
      form.append('weightclass','');
      form.append('gender','');
      form.append('query_s','');
      form.append('page',String(page));
      const response=await fetch(endpoint,{method:'POST',redirect:'follow',signal:AbortSignal.timeout(35000),headers:{'accept':'application/json,text/plain,*/*','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts professional location research; +https://mmascouts.com/)','x-csrf-token':csrf,'referer':source.rosterUrl,'x-requested-with':'XMLHttpRequest',...(cookieHeader?{cookie:cookieHeader}:{})},body:form});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const payload=parsePflAjaxPayload(await response.text());
      const pageLinks=parsePflRoster(payload.html,source);
      for(const row of pageLinks)linkMap.set(row.url,row);
      ajaxAudit.push({page,count:payload.count,total:payload.total,links:pageLinks.length});
      if(payload.total===0||payload.count===0)break;
    }catch(error){
      ajaxAudit.push({page,error:error instanceof Error?error.message:String(error)});
      break;
    }
  }
}
const links=[...linkMap.values()];
const candidates=[],errors=[];
for(const [index,item] of links.entries()){
  try{
    const html=await fetchHtml(item.url);
    if(index<12)writeFileSync(cache+'/pfl-profile-'+(index+1)+'.html',html);
    const profile=parsePflProfile(html,item.url);
    if(profile.normalized_name&&(profile.fighting_out_of||profile.fight_camp))candidates.push(profile);
  }catch(error){
    errors.push({url:item.url,error:error instanceof Error?error.message:String(error)});
  }
}

if(dry){
  const summary={checked_at:checkedAt,mode:'dry-run',source:source.slug,roster_links:links.length,ajax_pages:ajaxAudit,profiles_with_intel:candidates.length,with_location:candidates.filter(row=>row.fighting_out_of).length,with_team:candidates.filter(row=>row.fight_camp).length,errors};
  writeFileSync(cache+'/summary.json',JSON.stringify(summary,null,2)+'\n');
  if(!links.length)throw new Error('PFL roster returned no fighter profile links');
  console.log('PFL location probe found '+summary.with_location+' fighting-out-of and '+summary.with_team+' fight-camp profile(s) across '+links.length+' roster link(s).');
  process.exit(0);
}

const names=[...new Set(candidates.map(row=>row.normalized_name).filter(Boolean))],warehouse=[];
for(let i=0;i<names.length;i+=70){
  const batch=names.slice(i,i+70);
  warehouse.push(...query('SELECT source_key,source_fighter_id,profile_slug,fighter_name,normalized_name FROM scout_active_global_profiles WHERE normalized_name IN ('+batch.map(q).join(',')+')'));
}
const byName=new Map();
for(const row of warehouse){
  const key=String(row.normalized_name||normalizeFighterName(row.fighter_name));
  if(!byName.has(key))byName.set(key,[]);
  byName.get(key).push(row);
}

const matched=[],unmatched=[],ambiguous=[];
for(const candidate of candidates){
  const hits=byName.get(candidate.normalized_name)||[];
  if(hits.length===1)matched.push({...candidate,profile:hits[0]});
  else if(hits.length>1)ambiguous.push({...candidate,matches:hits.map(row=>({profile_slug:row.profile_slug,source_fighter_id:row.source_fighter_id}))});
  else unmatched.push(candidate);
}

const statements=[];
for(const row of matched){
  const p=row.profile,loc=row.location;
  if(row.fighting_out_of){
    statements.push(
      'INSERT INTO fighter_location_evidence(source_key,source_fighter_id,location_kind,city,region,country,raw_value,source_url,source_title,publisher,source_type,confidence,is_current,verified_at,last_checked_at,notes) VALUES('+
      [q(p.source_key),q(p.source_fighter_id),q('fighting_out_of'),q(loc.city),q(loc.region),q(loc.country),q(loc.raw_value),q(row.source_url),q(row.fighter_name+' official PFL profile'),q(source.publisher),q('promotion_direct'),q('A'),'1',q(checkedAt),q(checkedAt),q('Explicit FIGHTING OUT OF field on the official PFL fighter profile.')].join(',')+
      ') ON CONFLICT(source_key,source_fighter_id,source_url,location_kind,raw_value) DO UPDATE SET city=excluded.city,region=excluded.region,country=excluded.country,is_current=1,verified_at=excluded.verified_at,last_checked_at=excluded.last_checked_at;'
    );
  }
  if(row.fight_camp){
    const fingerprint='promotion:pfl:'+p.source_key+':'+p.source_fighter_id+':team.primary:'+normalizeFighterName(row.fight_camp);
    statements.push(
      'INSERT INTO fighter_intel_facts(fingerprint,source_key,source_fighter_id,category,fact_key,value_text,is_current,source_slug,source_url,source_type,confidence,verified_at,last_checked_at,notes) VALUES('+
      [q(fingerprint),q(p.source_key),q(p.source_fighter_id),q('team'),q('team.primary'),q(row.fight_camp),'1',q('promotion-sites'),q(row.source_url),q('promotion_direct'),q('A'),q(checkedAt),q(checkedAt),q('Explicit FIGHT CAMP field on the official PFL fighter profile.')].join(',')+
      ') ON CONFLICT(fingerprint) DO UPDATE SET value_text=excluded.value_text,is_current=1,verified_at=excluded.verified_at,last_checked_at=excluded.last_checked_at;'
    );
  }
}
if(statements.length){
  writeFileSync(cache+'/sync.sql',statements.join('\n')+'\n');
  wrangler(['d1','execute','cagemetrix',target,'--file',cache+'/sync.sql']);
}
const coverage=query("SELECT COUNT(*) fighters,ROUND(AVG(intel_coverage_pct),1) avg_coverage,SUM(CASE WHEN COALESCE(base_city,base_region,base_country) IS NOT NULL THEN 1 ELSE 0 END) base_known,SUM(CASE WHEN gym IS NOT NULL AND trim(gym)<>'' THEN 1 ELSE 0 END) gym_known FROM scout_fighter_intel_coverage")[0]||{};
const summary={checked_at:checkedAt,mode:remote?'remote':'local',source:source.slug,roster_links:links.length,ajax_pages:ajaxAudit,candidates:candidates.length,matched:matched.length,unmatched:unmatched.length,ambiguous:ambiguous.length,with_location:matched.filter(row=>row.fighting_out_of).length,with_team:matched.filter(row=>row.fight_camp).length,coverage,errors,unmatched_names:unmatched.slice(0,100).map(row=>row.fighter_name),ambiguous_names:ambiguous.map(row=>({fighter_name:row.fighter_name,matches:row.matches}))};
writeFileSync(cache+'/summary.json',JSON.stringify(summary,null,2)+'\n');
console.log('Promotion location sync matched '+matched.length+'/'+candidates.length+' profiles ('+unmatched.length+' unmatched, '+ambiguous.length+' ambiguous); base known '+Number(coverage.base_known||0)+'/'+Number(coverage.fighters||0)+'.');
