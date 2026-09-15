import {adminAccount,sameOrigin} from './admin-session.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const confidence=(value:unknown)=>['A','B','C'].includes(String(value))?String(value):'C';

async function input(request:Request){try{return await request.json() as Row}catch{return null;}}
async function fighterFromProfile(db:D1Database,profile:string){return profile?db.prepare(`SELECT source_key,source_fighter_id FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;}
function source(value:Row){
  const sourceUrl=String(value.source_url||'').trim(),sourceType=String(value.source_type||'public_record').trim().slice(0,80);
  if(!sourceUrl&&sourceType!=='verified_profile')return {error:'source_required'} as const;
  if(sourceUrl){try{const url=new URL(sourceUrl);if(!/^https?:$/.test(url.protocol))return {error:'invalid_source_url'} as const;return {sourceUrl:url.href,sourceType};}catch{return {error:'invalid_source_url'} as const;}}
  return {sourceUrl:null,sourceType};
}
function evidenceFields(value:Row){return {title:String(value.source_title||'').trim().slice(0,500)||null,publisher:String(value.publisher||'').trim().slice(0,200)||null,publishedAt:String(value.published_at||'').trim().slice(0,40)||null,notes:String(value.evidence_notes||value.notes||'').trim().slice(0,2000)||null};}
async function addManagementEvidence(env:Env,historyId:number|null,evidence:{sourceUrl:string|null;sourceType:string},value:Row,verifiedAt:string){
  if(!historyId||!evidence.sourceUrl)return;
  const meta=evidenceFields(value),grade=confidence(value.confidence);
  try{
    await env.DB.prepare(`INSERT INTO fighter_management_evidence(management_history_id,source_url,source_title,publisher,published_at,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?) ON CONFLICT(management_history_id,source_url) DO UPDATE SET source_title=excluded.source_title,publisher=excluded.publisher,published_at=excluded.published_at,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP,notes=excluded.notes`).bind(historyId,evidence.sourceUrl,meta.title,meta.publisher,meta.publishedAt,evidence.sourceType,grade,verifiedAt,meta.notes).run();
  }catch{}
}

export async function setManagementApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin'},403);
  const value=await input(request);if(!value)return json({error:'invalid_json'},400);
  const profile=String(value.profile_slug||'').trim(),fighter=await fighterFromProfile(env.DB,profile);if(!fighter)return json({error:'fighter_not_found'},404);
  const evidence=source(value);if('error'in evidence)return json({error:evidence.error},400);
  const agencySlug=String(value.agency_slug||'').trim(),managerName=String(value.manager_name||'').trim().slice(0,160)||null;
  const agency=agencySlug?await env.DB.prepare(`SELECT id FROM management_agencies WHERE slug=? AND active=1 LIMIT 1`).bind(agencySlug).first<{id:number}>():null;
  if(agencySlug&&!agency)return json({error:'agency_not_found'},404);
  if(!agency&&!managerName)return json({error:'agency_or_manager_required'},400);
  const verifiedAt=String(value.verified_at||'').trim()||new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE fighter_management_history SET is_current=0,ended_at=COALESCE(ended_at,date('now')),last_checked_at=CURRENT_TIMESTAMP WHERE source_key=? AND source_fighter_id=? AND is_current=1`).bind(fighter.source_key,fighter.source_fighter_id),
    env.DB.prepare(`INSERT INTO fighter_management_history(source_key,source_fighter_id,agency_id,manager_name,started_at,is_current,source_url,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,1,?,?,?,?,CURRENT_TIMESTAMP,?)`).bind(fighter.source_key,fighter.source_fighter_id,agency?.id??null,managerName,String(value.started_at||'').trim()||null,evidence.sourceUrl,evidence.sourceType,confidence(value.confidence),verifiedAt,String(value.notes||'').trim().slice(0,2000)||null),
    env.DB.prepare(`INSERT INTO fighter_opportunity_status(source_key,source_fighter_id,management_status,source_url,source_type,confidence,verified_at,last_checked_at) VALUES(?,?,'represented',?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET management_status='represented',source_url=excluded.source_url,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP`).bind(fighter.source_key,fighter.source_fighter_id,evidence.sourceUrl,evidence.sourceType,confidence(value.confidence),verifiedAt)
  ]);
  const current=await env.DB.prepare(`SELECT h.id FROM fighter_management_history h WHERE h.source_key=? AND h.source_fighter_id=? AND h.is_current=1 ORDER BY h.id DESC LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id).first<{id:number}>();
  await addManagementEvidence(env,current?.id||null,evidence,value,verifiedAt);
  return json({ok:true,profile_slug:profile,management_status:'represented',agency_slug:agencySlug||null,manager_name:managerName});
}

export async function endManagementApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin'},403);
  const value=await input(request);if(!value)return json({error:'invalid_json'},400);
  const profile=String(value.profile_slug||'').trim(),fighter=await fighterFromProfile(env.DB,profile);if(!fighter)return json({error:'fighter_not_found'},404);
  const evidence=source(value);if('error'in evidence)return json({error:evidence.error},400);
  const current=await env.DB.prepare(`SELECT id FROM fighter_management_history WHERE source_key=? AND source_fighter_id=? AND is_current=1 ORDER BY id DESC LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id).first<{id:number}>();
  const endedAt=String(value.ended_at||'').trim()||new Date().toISOString().slice(0,10),verifiedAt=String(value.verified_at||'').trim()||new Date().toISOString();
  const note=String(value.notes||'').trim().slice(0,1000);
  await env.DB.batch([
    env.DB.prepare(`UPDATE fighter_management_history SET is_current=0,ended_at=?,last_checked_at=CURRENT_TIMESTAMP,notes=CASE WHEN ?<>'' THEN trim(COALESCE(notes,'') || CASE WHEN notes IS NULL OR notes='' THEN '' ELSE char(10) END || ?) ELSE notes END WHERE source_key=? AND source_fighter_id=? AND is_current=1`).bind(endedAt,note,note,fighter.source_key,fighter.source_fighter_id),
    env.DB.prepare(`INSERT INTO fighter_opportunity_status(source_key,source_fighter_id,management_status,source_url,source_type,confidence,verified_at,last_checked_at) VALUES(?,?,'unknown',?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET management_status='unknown',source_url=excluded.source_url,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP`).bind(fighter.source_key,fighter.source_fighter_id,evidence.sourceUrl,evidence.sourceType,confidence(value.confidence),verifiedAt)
  ]);
  await addManagementEvidence(env,current?.id||null,evidence,value,verifiedAt);
  return json({ok:true,profile_slug:profile,management_status:'unknown',ended_at:endedAt});
}
