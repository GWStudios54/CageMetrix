import {adminAccount} from './admin-session.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});

export async function endManagementApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  let input:Row;try{input=await request.json() as Row}catch{return json({error:'invalid_json'},400);}
  const profile=String(input.profile_slug||'').trim();
  const fighter=profile?await env.DB.prepare(`SELECT source_key,source_fighter_id FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;
  if(!fighter)return json({error:'fighter_not_found'},404);
  const sourceUrl=String(input.source_url||'').trim();
  const sourceType=String(input.source_type||'public_record').trim().slice(0,80);
  if(!sourceUrl&&sourceType!=='verified_profile')return json({error:'source_required'},400);
  if(sourceUrl){try{const u=new URL(sourceUrl);if(!/^https?:$/.test(u.protocol))return json({error:'invalid_source_url'},400);}catch{return json({error:'invalid_source_url'},400);}}
  const endedAt=String(input.ended_at||'').trim()||new Date().toISOString().slice(0,10);
  const verifiedAt=String(input.verified_at||'').trim()||new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE fighter_management_history SET is_current=0,ended_at=?,last_checked_at=CURRENT_TIMESTAMP,notes=CASE WHEN ?<>'' THEN trim(COALESCE(notes,'') || CASE WHEN notes IS NULL OR notes='' THEN '' ELSE char(10) END || ?) ELSE notes END WHERE source_key=? AND source_fighter_id=? AND is_current=1`).bind(endedAt,String(input.notes||'').trim().slice(0,1000),String(input.notes||'').trim().slice(0,1000),fighter.source_key,fighter.source_fighter_id),
    env.DB.prepare(`INSERT INTO fighter_opportunity_status(source_key,source_fighter_id,management_status,source_url,source_type,confidence,verified_at,last_checked_at) VALUES(?,?,'unknown',?,?,?, ?,CURRENT_TIMESTAMP) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET management_status='unknown',source_url=excluded.source_url,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP`).bind(fighter.source_key,fighter.source_fighter_id,sourceUrl||null,sourceType,['A','B','C'].includes(String(input.confidence))?String(input.confidence):'C',verifiedAt)
  ]);
  return json({ok:true,profile_slug:profile,management_status:'unknown',ended_at:endedAt});
}
