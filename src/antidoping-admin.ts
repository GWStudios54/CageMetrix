import {adminAccount,sameOrigin} from './admin-session.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const NO_STORE={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const EVENT_TYPES=new Set(['flagged','positive_test','suspended','cleared','reinstated','status_update']);
const SOURCE_TYPES=new Set(['promotion_direct','sanctioning_body_direct','athletic_commission_record','fighter_direct','reputable_trade_reporting','reputable_interview','secondary_reporting_with_attribution']);
const CONFIDENCE=new Set(['A','B','C']);
const json=(value:unknown,status=200,headers=NO_STORE)=>new Response(JSON.stringify(value),{status,headers});
const text=(value:unknown,max=4000)=>String(value??'').trim().slice(0,max)||null;
const nonnegative=(value:unknown)=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?Math.round(n):null;};
function validUrl(value:unknown){if(!value)return null;try{const url=new URL(String(value));return /^https?:$/.test(url.protocol)?url.href:null}catch{return null;}}
function enumValue(set:Set<string>,value:unknown,fallback:string){const raw=String(value||'');return set.has(raw)?raw:fallback;}
async function input(request:Request){try{return await request.json() as Row}catch{return null;}}

// Anti-doping events carry more reputational weight than any other intel category in this system, so
// unlike contract/management/camp there is no source_type='verified_profile' shortcut and every write
// requires a real source_url -- enforced here, not just documented in the schema comment.
export async function antidopingAdminApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin'},403);
  const value=await input(request);if(!value)return json({error:'invalid_json'},400);
  const profile=String(value.profile_slug||'').trim();
  const fighter=profile?await env.DB.prepare(`SELECT source_key,source_fighter_id,fighter_name FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;
  if(!fighter)return json({error:'fighter_not_found'},404);
  const sourceUrl=validUrl(value.source_url);if(!sourceUrl)return json({error:'source_required'},400);
  const eventType=enumValue(EVENT_TYPES,value.event_type,'status_update');
  const publicSummary=text(value.public_summary,2000);if(!publicSummary)return json({error:'public_summary_required'},400);
  const sourceType=enumValue(SOURCE_TYPES,value.source_type,'reputable_trade_reporting');
  const confidence=enumValue(CONFIDENCE,value.confidence,sourceType==='promotion_direct'||sourceType==='sanctioning_body_direct'||sourceType==='athletic_commission_record'?'A':'B');
  const isCurrent=value.is_current===true||value.is_current===1||value.is_current==='1';

  const existing=await env.DB.prepare(`SELECT e.id FROM fighter_antidoping_events e JOIN fighter_antidoping_evidence ev ON ev.antidoping_event_id=e.id WHERE e.source_key=? AND e.source_fighter_id=? AND e.event_type=? AND ev.source_url=? LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id,eventType,sourceUrl).first<{id:number}>();
  let eventId=existing?.id||null;
  if(!eventId){
    if(isCurrent)await env.DB.prepare(`UPDATE fighter_antidoping_events SET is_current=0,updated_at=CURRENT_TIMESTAMP WHERE source_key=? AND source_fighter_id=? AND is_current=1`).bind(fighter.source_key,fighter.source_fighter_id).run();
    const eventKey=`${fighter.source_key}:${fighter.source_fighter_id}:${crypto.randomUUID()}`;
    const result=await env.DB.prepare(`INSERT INTO fighter_antidoping_events(event_key,source_key,source_fighter_id,event_type,substance,sanctioning_body,suspension_months,effective_at,reported_at,expires_at,public_summary,is_current,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING id`).bind(eventKey,fighter.source_key,fighter.source_fighter_id,eventType,text(value.substance,160),text(value.sanctioning_body,160),nonnegative(value.suspension_months),text(value.effective_at,40),text(value.reported_at,40),text(value.expires_at,40),publicSummary,isCurrent?1:0).first<{id:number}>();
    eventId=result?.id||null;
  }
  if(!eventId)return json({error:'antidoping_event_write_failed'},500);
  await env.DB.prepare(`INSERT INTO fighter_antidoping_evidence(antidoping_event_id,source_url,source_title,publisher,published_at,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP,?) ON CONFLICT(antidoping_event_id,source_url) DO UPDATE SET source_title=excluded.source_title,publisher=excluded.publisher,published_at=excluded.published_at,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP,notes=excluded.notes`).bind(eventId,sourceUrl,text(value.source_title,500),text(value.publisher,200),text(value.published_at,40),sourceType,confidence,text(value.verified_at,40),text(value.notes,2000)).run();
  return json({ok:true,profile_slug:profile,antidoping_event_id:eventId,event_type:eventType,is_current:isCurrent},200);
}
