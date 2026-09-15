import {adminAccount,sameOrigin} from './admin-session.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const confidence=(value:unknown)=>['A','B','C'].includes(String(value))?String(value):'C';
const count=(value:unknown)=>{const n=Number.parseInt(String(value??'0'),10);return Number.isFinite(n)&&n>=0?n:0;};

async function input(request:Request){try{return await request.json() as Row}catch{return null;}}
async function fighterFromProfile(db:D1Database,profile:string){return profile?db.prepare(`SELECT source_key,source_fighter_id FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;}
function source(value:Row){
  const sourceUrl=String(value.source_url||'').trim(),sourceType=String(value.source_type||'public_record').trim().slice(0,80);
  if(!sourceUrl&&sourceType!=='verified_profile')return {error:'source_required'} as const;
  if(sourceUrl){try{const url=new URL(sourceUrl);if(!/^https?:$/.test(url.protocol))return {error:'invalid_source_url'} as const;return {sourceUrl:url.href,sourceType};}catch{return {error:'invalid_source_url'} as const;}}
  return {sourceUrl:null,sourceType};
}
function evidenceFields(value:Row){return {title:String(value.source_title||'').trim().slice(0,500)||null,publisher:String(value.publisher||'').trim().slice(0,200)||null,publishedAt:String(value.published_at||'').trim().slice(0,40)||null,notes:String(value.evidence_notes||value.notes||'').trim().slice(0,2000)||null};}
async function addEvidence(env:Env,recordId:number|null,evidence:{sourceUrl:string|null;sourceType:string},value:Row,verifiedAt:string){
  if(!recordId||!evidence.sourceUrl)return;
  const meta=evidenceFields(value),grade=confidence(value.confidence);
  try{
    await env.DB.prepare(`INSERT INTO fighter_amateur_record_evidence(amateur_record_id,source_url,source_title,publisher,published_at,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?) ON CONFLICT(amateur_record_id,source_url) DO UPDATE SET source_title=excluded.source_title,publisher=excluded.publisher,published_at=excluded.published_at,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP,notes=excluded.notes`).bind(recordId,evidence.sourceUrl,meta.title,meta.publisher,meta.publishedAt,evidence.sourceType,grade,verifiedAt,meta.notes).run();
  }catch{}
}

// Manual, evidence-backed entry only -- there is no real news feed of "amateur record"
// announcements to build a discovery/candidate pipeline against (see migrations/0046). An admin
// looks the fact up per fighter (promotion bio, Sherdog/Tapology profile, regional sanctioning body
// results) and enters it here with its source, same shape as setManagementApi.
export async function setAmateurRecordApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin'},403);
  const value=await input(request);if(!value)return json({error:'invalid_json'},400);
  const profile=String(value.profile_slug||'').trim(),fighter=await fighterFromProfile(env.DB,profile);if(!fighter)return json({error:'fighter_not_found'},404);
  const wins=count(value.wins),losses=count(value.losses),draws=count(value.draws),noContests=count(value.no_contests);
  if(wins+losses+draws+noContests<=0)return json({error:'record_required'},400);
  const evidence=source(value);if('error'in evidence)return json({error:evidence.error},400);
  const promotionOrBody=String(value.promotion_or_body||'').trim().slice(0,200)||null;
  const turnedPro=String(value.turned_pro_date||'').trim()||null;
  const verifiedAt=String(value.verified_at||'').trim()||new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO fighter_amateur_record(source_key,source_fighter_id,wins,losses,draws,no_contests,promotion_or_body,turned_pro_date,source_url,source_type,confidence,verified_at,last_checked_at,notes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
    ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET
      wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,no_contests=excluded.no_contests,
      promotion_or_body=excluded.promotion_or_body,turned_pro_date=excluded.turned_pro_date,
      source_url=excluded.source_url,source_type=excluded.source_type,confidence=excluded.confidence,
      verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP,notes=excluded.notes
  `).bind(fighter.source_key,fighter.source_fighter_id,wins,losses,draws,noContests,promotionOrBody,turnedPro,evidence.sourceUrl,evidence.sourceType,confidence(value.confidence),verifiedAt,String(value.notes||'').trim().slice(0,2000)||null).run();
  const record=await env.DB.prepare(`SELECT id FROM fighter_amateur_record WHERE source_key=? AND source_fighter_id=? LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id).first<{id:number}>();
  await addEvidence(env,record?.id||null,evidence,value,verifiedAt);
  return json({ok:true,profile_slug:profile,wins,losses,draws,no_contests:noContests});
}
