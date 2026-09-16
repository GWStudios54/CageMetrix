import {adminAccount,sameOrigin} from './admin-session.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const NO_STORE={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const EVENT_TYPES=new Set(['withdrawal','injury_disclosed','cleared_to_compete','replacement_announced']);
const EVIDENCE_SOURCE_TYPES=new Set(['fighter_direct','coach_or_camp_direct','promotion_direct','reputable_trade_reporting','reputable_interview','secondary_reporting_with_attribution','archived_public_statement']);
const CONFIDENCE=new Set(['A','B','C']);
const json=(value:unknown,status=200,headers=NO_STORE)=>new Response(JSON.stringify(value),{status,headers});
const text=(value:unknown,max=4000)=>String(value??'').trim().slice(0,max)||null;
function validUrl(value:unknown){if(!value)return null;try{const url=new URL(String(value));return /^https?:$/.test(url.protocol)?url.href:null}catch{return null;}}
function enumValue(set:Set<string>,value:unknown,fallback:string){const raw=String(value||'');return set.has(raw)?raw:fallback;}
async function input(request:Request){try{return await request.json() as Row}catch{return null;}}

// Injury/availability is routine and non-stigmatizing (unlike anti-doping), so this keeps the
// source_type='verified_profile' bypass contract/camp/management allow -- an admin can record a
// directly-confirmed status without a fresh public URL -- rather than anti-doping's stricter
// no-bypass rule.
function eventSource(value:Row){
  const sourceUrl=validUrl(value.source_url),sourceType=String(value.source_type||'reputable_trade_reporting').trim().slice(0,80);
  if(!sourceUrl&&sourceType!=='verified_profile')return {error:'source_required'} as const;
  return {sourceUrl,sourceType};
}

export async function injuryAdminApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin'},403);
  const value=await input(request);if(!value)return json({error:'invalid_json'},400);
  const profile=String(value.profile_slug||'').trim();
  const fighter=profile?await env.DB.prepare(`SELECT source_key,source_fighter_id,fighter_name FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;
  if(!fighter)return json({error:'fighter_not_found'},404);
  const source=eventSource(value);if('error'in source)return json({error:source.error},400);
  const eventType=enumValue(EVENT_TYPES,value.event_type,'injury_disclosed');
  const publicSummary=text(value.public_summary,2000);if(!publicSummary)return json({error:'public_summary_required'},400);
  const evidenceSourceType=enumValue(EVIDENCE_SOURCE_TYPES,value.evidence_source_type||value.source_type,'reputable_trade_reporting');
  const confidence=enumValue(CONFIDENCE,value.confidence,evidenceSourceType==='promotion_direct'||evidenceSourceType==='fighter_direct'?'A':'B');
  const isCurrent=value.is_current===true||value.is_current===1||value.is_current==='1';

  const existing=source.sourceUrl?await env.DB.prepare(`SELECT e.id FROM fighter_injury_events e JOIN fighter_injury_evidence ev ON ev.injury_event_id=e.id WHERE e.source_key=? AND e.source_fighter_id=? AND e.event_type=? AND ev.source_url=? LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id,eventType,source.sourceUrl).first<{id:number}>():null;
  let eventId=existing?.id||null;
  if(!eventId){
    if(isCurrent)await env.DB.prepare(`UPDATE fighter_injury_events SET is_current=0,updated_at=CURRENT_TIMESTAMP WHERE source_key=? AND source_fighter_id=? AND is_current=1`).bind(fighter.source_key,fighter.source_fighter_id).run();
    const eventKey=`${fighter.source_key}:${fighter.source_fighter_id}:${crypto.randomUUID()}`;
    const result=await env.DB.prepare(`INSERT INTO fighter_injury_events(event_key,source_key,source_fighter_id,event_type,injury_description,affected_event,opponent_name,effective_at,reported_at,expected_return_at,public_summary,is_current,source_url,source_type,confidence,verified_at,last_checked_at,notes,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP) RETURNING id`).bind(eventKey,fighter.source_key,fighter.source_fighter_id,eventType,text(value.injury_description,300),text(value.affected_event,200),text(value.opponent_name,160),text(value.effective_at,40),text(value.reported_at,40),text(value.expected_return_at,40),publicSummary,isCurrent?1:0,source.sourceUrl,source.sourceType,confidence,text(value.verified_at,40),text(value.notes,2000)).first<{id:number}>();
    eventId=result?.id||null;
  }
  if(!eventId)return json({error:'injury_event_write_failed'},500);
  if(source.sourceUrl)await env.DB.prepare(`INSERT INTO fighter_injury_evidence(injury_event_id,source_url,source_title,publisher,published_at,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP,?) ON CONFLICT(injury_event_id,source_url) DO UPDATE SET source_title=excluded.source_title,publisher=excluded.publisher,published_at=excluded.published_at,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP,notes=excluded.notes`).bind(eventId,source.sourceUrl,text(value.source_title,500),text(value.publisher,200),text(value.published_at,40),evidenceSourceType,confidence,text(value.verified_at,40),text(value.notes,2000)).run();
  return json({ok:true,profile_slug:profile,injury_event_id:eventId,event_type:eventType,is_current:isCurrent},200);
}
