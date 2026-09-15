import {adminAccount,sameOrigin} from './admin-session.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const REVIEW=new Set(['pending','accepted','rejected','duplicate','needs_identity']);
async function body(request:Request){try{return await request.json() as Row}catch{return null;}}

export async function antidopingCandidatesAdminApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method==='GET'){
    const url=new URL(request.url),status=REVIEW.has(url.searchParams.get('status')||'')?url.searchParams.get('status')!:'pending';
    const limit=Math.min(250,Math.max(1,Number.parseInt(url.searchParams.get('limit')||'',10)||100));
    const rows=await env.DB.prepare(`SELECT c.id,c.candidate_key,c.source_url,c.source_title,c.publisher,c.published_at,c.source_type,c.fighter_name,c.normalized_name,c.source_key,c.source_fighter_id,c.detected_event_type,c.detected_summary,c.extraction_method,c.review_status,c.discovered_at,c.reviewed_at,c.notes,p.profile_slug
      FROM antidoping_intel_candidates c
      LEFT JOIN scout_active_global_profiles p ON p.source_key=c.source_key AND p.source_fighter_id=c.source_fighter_id
      WHERE c.review_status=? ORDER BY COALESCE(c.published_at,c.discovered_at) DESC,c.id DESC LIMIT ?`).bind(status,limit).all<Row>();
    return json({data:rows.results||[],meta:{status,limit,count:rows.results?.length||0,policy:'Discovery candidates are private review leads, not published anti-doping facts about any fighter.'}});
  }
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin'},403);
  const value=await body(request);if(!value)return json({error:'invalid_json'},400);
  const id=Number(value.id);if(!Number.isInteger(id)||id<=0)return json({error:'candidate_id_required'},400);
  const status=String(value.review_status||'');if(!REVIEW.has(status)||status==='pending')return json({error:'invalid_review_status'},400);
  const candidate=await env.DB.prepare(`SELECT id,review_status FROM antidoping_intel_candidates WHERE id=? LIMIT 1`).bind(id).first<Row>();if(!candidate)return json({error:'candidate_not_found'},404);
  await env.DB.prepare(`UPDATE antidoping_intel_candidates SET review_status=?,reviewed_at=CURRENT_TIMESTAMP,notes=? WHERE id=?`).bind(status,String(value.notes||'').trim().slice(0,2000)||null,id).run();
  return json({ok:true,id,review_status:status});
}
