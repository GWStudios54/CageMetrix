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

export async function campAdminApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin'},403);
  const value=await input(request);if(!value)return json({error:'invalid_json'},400);
  const profile=String(value.profile_slug||'').trim();
  const fighter=profile?await env.DB.prepare(`SELECT source_key,source_fighter_id,fighter_name FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;
  if(!fighter)return json({error:'fighter_not_found'},404);
  const sourceUrl=validUrl(value.source_url);if(!sourceUrl)return json({error:'source_required'},400);
  const campSlug=text(value.camp_slug,120),campName=text(value.camp_name,200);
  if(!campSlug&&!campName)return json({error:'camp_required'},400);
  const camp=campSlug?await env.DB.prepare(`SELECT id,slug,name FROM training_camps WHERE slug=? AND active=1 LIMIT 1`).bind(campSlug).first<Row>():null;
  if(campSlug&&!camp)return json({error:'camp_not_found'},404);
  const sourceType=enumValue(SOURCE_TYPES,value.source_type,'reputable_trade_reporting');
  const confidence=enumValue(CONFIDENCE,value.confidence,sourceType==='fighter_direct'||sourceType==='coach_or_camp_direct'||sourceType==='promotion_direct'?'A':'B');
  const coachName=text(value.coach_name,160);

  await env.DB.batch([
    env.DB.prepare(`UPDATE fighter_camp_history SET is_current=0,ended_at=COALESCE(ended_at,date('now')),last_checked_at=CURRENT_TIMESTAMP WHERE source_key=? AND source_fighter_id=? AND is_current=1`).bind(fighter.source_key,fighter.source_fighter_id),
    env.DB.prepare(`INSERT INTO fighter_camp_history(source_key,source_fighter_id,camp_id,camp_name,coach_name,started_at,is_current,source_url,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,?,1,?,?,?,?,CURRENT_TIMESTAMP,?)`).bind(fighter.source_key,fighter.source_fighter_id,camp?.id??null,camp?.name||campName,coachName,text(value.started_at,40),sourceUrl,sourceType,confidence,text(value.verified_at,40)||new Date().toISOString(),text(value.notes,2000))
  ]);
  const history=await env.DB.prepare(`SELECT id FROM fighter_camp_history WHERE source_key=? AND source_fighter_id=? AND is_current=1 LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id).first<{id:number}>();
  if(!history?.id)return json({error:'camp_history_write_failed'},500);
  await env.DB.prepare(`INSERT INTO fighter_camp_evidence(camp_history_id,source_url,source_title,publisher,published_at,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP,?) ON CONFLICT(camp_history_id,source_url) DO UPDATE SET source_title=excluded.source_title,publisher=excluded.publisher,published_at=excluded.published_at,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP,notes=excluded.notes`).bind(history.id,sourceUrl,text(value.source_title,500),text(value.publisher,200),text(value.published_at,40),sourceType,confidence,text(value.verified_at,40),text(value.notes,2000)).run();
  return json({ok:true,profile_slug:profile,camp_history_id:history.id,camp_slug:camp?.slug??campSlug??null},200);
}
