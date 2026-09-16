import {adminAccount,sameOrigin} from './admin-session.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const NO_STORE={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const SOURCE_TYPES=new Set(['fighter_direct','coach_or_camp_direct','promotion_direct','reputable_trade_reporting','reputable_interview','secondary_reporting_with_attribution','archived_public_statement']);
const CONFIDENCE=new Set(['A','B','C']);
const json=(value:unknown,status=200,headers=NO_STORE)=>new Response(JSON.stringify(value),{status,headers});
const text=(value:unknown,max=4000)=>String(value??'').trim().slice(0,max)||null;
function validUrl(value:unknown){if(!value)return null;try{const url=new URL(String(value));return /^https?:$/.test(url.protocol)?url.href:null}catch{return null;}}
function enumValue(set:Set<string>,value:unknown,fallback:string){const raw=String(value||'');return set.has(raw)?raw:fallback;}
async function input(request:Request){try{return await request.json() as Row}catch{return null;}}

// Coach affiliation is routine and non-stigmatizing (unlike anti-doping), so this keeps the
// source_type='verified_profile' bypass contract/camp/management/injury allow -- an admin can record
// a directly-confirmed coach without a fresh public URL -- rather than anti-doping's stricter
// no-bypass rule.
function affiliationSource(value:Row){
  const sourceUrl=validUrl(value.source_url),sourceType=String(value.source_type||'reputable_trade_reporting').trim().slice(0,80);
  if(!sourceUrl&&sourceType!=='verified_profile')return {error:'source_required'} as const;
  return {sourceUrl,sourceType};
}

export async function coachAdminApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin'},403);
  const value=await input(request);if(!value)return json({error:'invalid_json'},400);
  const profile=String(value.profile_slug||'').trim();
  const fighter=profile?await env.DB.prepare(`SELECT source_key,source_fighter_id,fighter_name FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;
  if(!fighter)return json({error:'fighter_not_found'},404);
  const source=affiliationSource(value);if('error'in source)return json({error:source.error},400);
  const coachName=text(value.coach_name,160);if(!coachName)return json({error:'coach_name_required'},400);
  const sourceType=enumValue(SOURCE_TYPES,value.source_type,'reputable_trade_reporting');
  const confidence=enumValue(CONFIDENCE,value.confidence,sourceType==='fighter_direct'||sourceType==='coach_or_camp_direct'||sourceType==='promotion_direct'?'A':'B');

  await env.DB.batch([
    env.DB.prepare(`UPDATE fighter_coach_history SET is_current=0,ended_at=COALESCE(ended_at,date('now')),last_checked_at=CURRENT_TIMESTAMP WHERE source_key=? AND source_fighter_id=? AND is_current=1`).bind(fighter.source_key,fighter.source_fighter_id),
    env.DB.prepare(`INSERT INTO fighter_coach_history(source_key,source_fighter_id,coach_name,started_at,is_current,source_url,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,1,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP,?)`).bind(fighter.source_key,fighter.source_fighter_id,coachName,text(value.started_at,40),source.sourceUrl,source.sourceType,confidence,text(value.verified_at,40),text(value.notes,2000))
  ]);
  const history=await env.DB.prepare(`SELECT id FROM fighter_coach_history WHERE source_key=? AND source_fighter_id=? AND is_current=1 LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id).first<{id:number}>();
  if(!history?.id)return json({error:'coach_history_write_failed'},500);
  if(source.sourceUrl)await env.DB.prepare(`INSERT INTO fighter_coach_evidence(coach_history_id,source_url,source_title,publisher,published_at,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP,?) ON CONFLICT(coach_history_id,source_url) DO UPDATE SET source_title=excluded.source_title,publisher=excluded.publisher,published_at=excluded.published_at,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP,notes=excluded.notes`).bind(history.id,source.sourceUrl,text(value.source_title,500),text(value.publisher,200),text(value.published_at,40),source.sourceType,confidence,text(value.verified_at,40),text(value.notes,2000)).run();
  return json({ok:true,profile_slug:profile,coach_history_id:history.id,coach_name:coachName},200);
}
