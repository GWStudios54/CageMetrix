import {adminAccount} from './admin-session.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=30, s-maxage=120','x-content-type-options':'nosniff'};
const NO_STORE={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const EVENT_TYPES=new Set(['signing','extension','renewal','renegotiation','bout_agreement','option_exercised','option_declined','release','expiration','free_agency','status_update','other']);
const AGREEMENT_TYPES=new Set(['unknown','multi_fight','single_fight','developmental','exclusive','non_exclusive','tournament','short_notice','replacement']);
const STATUSES=new Set(['unknown','under_contract','non_exclusive','free_agent','released','expired']);
const YESNO=new Set(['unknown','yes','no']);
const SCOPES=new Set(['status_only','partial_terms','reported_terms']);
const SOURCE_TYPES=new Set(['fighter_direct','manager_or_agency_direct','promotion_direct','athletic_commission_record','court_record','verified_public_filing','reputable_trade_reporting','reputable_interview','secondary_reporting_with_attribution','archived_public_statement']);
const CONFIDENCE=new Set(['A','B','C']);
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const json=(value:unknown,status=200,headers=JSON_HEADERS)=>new Response(JSON.stringify(value),{status,headers});
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};
const text=(value:unknown,max=4000)=>String(value??'').trim().slice(0,max)||null;
const nonnegative=(value:unknown)=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?Math.round(n):null;};
function validUrl(value:unknown){if(!value)return null;try{const url=new URL(String(value));return /^https?:$/.test(url.protocol)?url.href:null}catch{return null;}}
function money(minor:unknown,currency:unknown){const amount=Number(minor);if(!Number.isFinite(amount))return null;const code=String(currency||'USD').toUpperCase();try{return new Intl.NumberFormat('en-US',{style:'currency',currency:code,maximumFractionDigits:0}).format(amount/100);}catch{return `${code} ${(amount/100).toLocaleString('en-US')}`;}}
function label(value:unknown){return String(value||'unknown').replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase());}

async function profileForSlug(env:Env,slug:string){return env.DB.prepare(`SELECT source_key,source_fighter_id,profile_slug,fighter_name FROM scout_public_global_profiles WHERE profile_slug=? LIMIT 1`).bind(slug).first<Row>();}

function groupContracts(rows:Row[]){
  const map=new Map<number,Row>();
  for(const row of rows){
    const id=Number(row.id);let event=map.get(id);
    if(!event){event={...row,evidence:[]};delete event.evidence_id;delete event.evidence_source_url;delete event.evidence_source_title;delete event.evidence_publisher;delete event.evidence_published_at;delete event.evidence_source_type;delete event.evidence_confidence;delete event.evidence_verified_at;map.set(id,event);}
    if(row.evidence_id)event.evidence.push({id:row.evidence_id,source_url:row.evidence_source_url,source_title:row.evidence_source_title,publisher:row.evidence_publisher,published_at:row.evidence_published_at,source_type:row.evidence_source_type,confidence:row.evidence_confidence,verified_at:row.evidence_verified_at});
  }
  return [...map.values()];
}
function groupRepresentation(rows:Row[]){
  const map=new Map<number,Row>();
  for(const row of rows){
    const id=Number(row.id);let item=map.get(id);
    if(!item){item={...row,evidence:[]};for(const key of ['evidence_id','evidence_source_url','evidence_source_title','evidence_publisher','evidence_published_at','evidence_source_type','evidence_confidence','evidence_verified_at'])delete item[key];map.set(id,item);}
    if(row.evidence_id)item.evidence.push({id:row.evidence_id,source_url:row.evidence_source_url,source_title:row.evidence_source_title,publisher:row.evidence_publisher,published_at:row.evidence_published_at,source_type:row.evidence_source_type,confidence:row.evidence_confidence,verified_at:row.evidence_verified_at});
  }
  return [...map.values()];
}

export async function fighterContractData(env:Env,slug:string){
  const fighter=await profileForSlug(env,slug);if(!fighter)return null;
  const opportunity=await env.DB.prepare(`SELECT contract_status,source_url,source_type,confidence,verified_at FROM fighter_opportunity_status WHERE source_key=? AND source_fighter_id=? LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id).first<Row>();
  let contracts:Row[]=[];
  let representation:Row[]=[];
  try{
    const result=await env.DB.prepare(`SELECT e.*,
      ev.id evidence_id,ev.source_url evidence_source_url,ev.source_title evidence_source_title,ev.publisher evidence_publisher,
      ev.published_at evidence_published_at,ev.source_type evidence_source_type,ev.confidence evidence_confidence,ev.verified_at evidence_verified_at
      FROM fighter_contract_events e
      LEFT JOIN fighter_contract_evidence ev ON ev.contract_event_id=e.id
      WHERE e.source_key=? AND e.source_fighter_id=?
      ORDER BY COALESCE(e.effective_at,e.reported_at,e.signed_at,e.created_at) DESC,e.id DESC,
               CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC`).bind(fighter.source_key,fighter.source_fighter_id).all<Row>();
    contracts=groupContracts(result.results||[]);
  }catch{}
  try{
    const result=await env.DB.prepare(`SELECT h.id,h.manager_name,h.started_at,h.ended_at,h.is_current,h.source_type,h.confidence,h.verified_at,h.notes,
      a.slug agency_slug,a.name agency_name,a.website_url agency_website,
      ev.id evidence_id,ev.source_url evidence_source_url,ev.source_title evidence_source_title,ev.publisher evidence_publisher,
      ev.published_at evidence_published_at,ev.source_type evidence_source_type,ev.confidence evidence_confidence,ev.verified_at evidence_verified_at
      FROM fighter_management_history h
      LEFT JOIN management_agencies a ON a.id=h.agency_id
      LEFT JOIN fighter_management_evidence ev ON ev.management_history_id=h.id
      WHERE h.source_key=? AND h.source_fighter_id=?
      ORDER BY h.is_current DESC,COALESCE(h.started_at,h.verified_at) DESC,h.id DESC,
               CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC`).bind(fighter.source_key,fighter.source_fighter_id).all<Row>();
    representation=groupRepresentation(result.results||[]);
  }catch{
    const fallback=await env.DB.prepare(`SELECT h.id,h.manager_name,h.started_at,h.ended_at,h.is_current,h.source_type,h.confidence,h.verified_at,h.notes,h.source_url,
      a.slug agency_slug,a.name agency_name,a.website_url agency_website
      FROM fighter_management_history h LEFT JOIN management_agencies a ON a.id=h.agency_id
      WHERE h.source_key=? AND h.source_fighter_id=? ORDER BY h.is_current DESC,COALESCE(h.started_at,h.verified_at) DESC,h.id DESC`).bind(fighter.source_key,fighter.source_fighter_id).all<Row>();
    representation=(fallback.results||[]).map(row=>({...row,evidence:row.source_url?[{source_url:row.source_url,source_type:row.source_type,confidence:row.confidence,verified_at:row.verified_at}]:[]}));
  }
  return {fighter,opportunity:opportunity||{contract_status:'unknown'},contracts,representation};
}

export async function fighterContractApi(request:Request,env:Env,slug:string){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const data=await fighterContractData(env,slug);if(!data)return json({error:'fighter_not_found'},404);
  return json({data,policy:'Contract and representation fields are published only when public evidence supports them. Missing information remains unknown; release/expiration alone never implies global free agency.'});
}

function eventTerms(row:Row){
  const terms:string[]=[];
  if(row.fights_total!==null&&row.fights_total!==undefined)terms.push(`${Number(row.fights_total)}-fight deal reported`);
  if(row.fights_remaining_reported!==null&&row.fights_remaining_reported!==undefined)terms.push(`${Number(row.fights_remaining_reported)} fight${Number(row.fights_remaining_reported)===1?'':'s'} reported remaining`);
  if(row.term_months!==null&&row.term_months!==undefined)terms.push(`${Number(row.term_months)}-month term reported`);
  if(row.expires_at)terms.push(`Reported expiration ${pretty(row.expires_at)||row.expires_at}`);
  if(row.exclusive!=='unknown')terms.push(`Exclusive: ${row.exclusive}`);
  if(row.matching_rights!=='unknown')terms.push(`Matching rights: ${row.matching_rights}`);
  if(row.champion_clause!=='unknown')terms.push(`Champion clause: ${row.champion_clause}`);
  if(row.extension_option!=='unknown')terms.push(`Extension option: ${row.extension_option}`);
  const guarantee=money(row.guaranteed_pay_minor,row.currency),bonus=money(row.win_bonus_minor,row.currency);
  if(guarantee)terms.push(`Reported guaranteed pay ${guarantee}`);
  if(bonus)terms.push(`Reported win bonus ${bonus}`);
  return terms;
}
function sourceLinks(evidence:Row[]){return evidence.map(item=>`<a class="contract-source" href="${esc(item.source_url)}" rel="nofollow noopener"><strong>${esc(item.source_title||item.publisher||'Public source')}</strong><small>${esc(item.publisher||label(item.source_type))}${item.published_at?` · ${esc(pretty(item.published_at)||item.published_at)}`:''} · Grade ${esc(item.confidence||'C')}</small></a>`).join('');}
function contractCard(row:Row){
  const when=pretty(row.effective_at||row.signed_at||row.reported_at)||'Date not publicly established';
  const terms=eventTerms(row);
  return `<article class="contract-record${row.is_current?' current':''}"><div class="contract-record-head"><div><span class="eyebrow">${esc(label(row.event_type))}${row.is_current?' · CURRENT':''}</span><h3>${esc(row.promotion_name||row.promotion_slug||'Promotion not specified')}</h3></div><span class="talent-badge">${esc(label(row.status_after))}</span></div><p>${esc(row.public_summary)}</p><div class="contract-meta"><span>${esc(when)}</span><span>${esc(label(row.agreement_type))}</span><span>${esc(label(row.disclosure_scope))}</span></div>${terms.length?`<ul class="contract-terms">${terms.map(term=>`<li>${esc(term)}</li>`).join('')}</ul>`:''}${row.evidence?.length?`<div class="contract-sources"><strong>Sources</strong>${sourceLinks(row.evidence)}</div>`:''}</article>`;
}
function representationCard(row:Row){
  const title=row.agency_name||row.manager_name||'Representation';
  const date=[row.started_at?`Started ${pretty(row.started_at)||row.started_at}`:null,row.ended_at?`Ended ${pretty(row.ended_at)||row.ended_at}`:row.is_current?'Current':null].filter(Boolean).join(' · ');
  return `<article class="representation-record"><div><span class="eyebrow">${row.is_current?'CURRENT REPRESENTATION':'REPRESENTATION HISTORY'}</span><h3>${row.agency_slug?`<a href="/management/${esc(row.agency_slug)}">${esc(title)}</a>`:esc(title)}</h3>${row.manager_name&&row.agency_name?`<p>Manager / agent: ${esc(row.manager_name)}</p>`:''}<small>${esc(date||'Dates not publicly established')} · Evidence grade ${esc(row.confidence||'C')}</small></div>${row.evidence?.length?`<div class="contract-sources">${sourceLinks(row.evidence)}</div>`:''}</article>`;
}

export async function enhanceFighterContractContext(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const data=await fighterContractData(env,slug);if(!data)return response;
  const current=data.contracts.filter(row=>row.is_current),history=data.contracts.filter(row=>!row.is_current);
  const scalar=String(data.opportunity?.contract_status||'unknown');
  const status=current.length?current.map(row=>label(row.status_after)).filter((value,index,all)=>all.indexOf(value)===index).join(' · '):label(scalar);
  const contractBody=current.length||history.length?`${current.map(contractCard).join('')}${history.length?`<div class="contract-history-head"><span class="eyebrow">HISTORY</span><h3>Reported contract events</h3></div>${history.map(contractCard).join('')}`:''}`:`<div class="talent-empty"><strong>No public contract terms verified yet.</strong><p>MMA Scouts has not found enough public evidence to publish a deal length, remaining fights, expiration or free-agency date for this fighter. That does not mean no contract exists.</p></div>`;
  const representation=data.representation.length?data.representation.map(representationCard).join(''):`<div class="talent-empty"><strong>Representation is not publicly verified.</strong><p>No management record is treated as unknown—not unmanaged.</p></div>`;
  const section=`<section class="contract-intelligence"><div class="talent-section-head"><span class="eyebrow">CONTRACT & REPRESENTATION INTELLIGENCE</span><h2>What is publicly known</h2><p>Current contract status: <strong>${esc(status)}</strong>. Public MMA contract reporting is often incomplete, so MMA Scouts separates reported facts from unknown terms and links every published claim to its evidence.</p></div><div class="contract-columns"><div><h3>Contract file</h3>${contractBody}</div><div><h3>Representation file</h3>${representation}</div></div><p class="talent-policy"><strong>Evidence rule:</strong> release or contract expiration with one promotion does not automatically mean global free agency. Exact expirations, remaining fights, purse terms and unmanaged/free-agent labels appear only when a public source explicitly supports them.</p></section>`;
  return new HTMLRewriter().on('.talent-dossier',{element(el){el.after(section,{html:true});}}).transform(response);
}

async function input(request:Request){try{return await request.json() as Row}catch{return null;}}
function enumValue(set:Set<string>,value:unknown,fallback:string){const v=String(value||fallback);return set.has(v)?v:fallback;}

export async function contractAdminApi(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return json({error:'unauthorized'},401,NO_STORE);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405,NO_STORE);
  const value=await input(request);if(!value)return json({error:'invalid_json'},400,NO_STORE);
  const profile=String(value.profile_slug||'').trim(),fighter=profile?await env.DB.prepare(`SELECT source_key,source_fighter_id,fighter_name FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;
  if(!fighter)return json({error:'fighter_not_found'},404,NO_STORE);
  const sourceUrl=validUrl(value.source_url);if(!sourceUrl)return json({error:'source_required'},400,NO_STORE);
  const sourceType=enumValue(SOURCE_TYPES,value.source_type,'reputable_trade_reporting');
  const evidenceConfidence=enumValue(CONFIDENCE,value.confidence,sourceType==='fighter_direct'||sourceType==='manager_or_agency_direct'||sourceType==='promotion_direct'||sourceType==='athletic_commission_record'||sourceType==='court_record'?'A':'B');
  const eventType=enumValue(EVENT_TYPES,value.event_type,'status_update'),agreementType=enumValue(AGREEMENT_TYPES,value.agreement_type,'unknown'),statusAfter=enumValue(STATUSES,value.status_after,'unknown');
  const publicSummary=text(value.public_summary,2000);if(!publicSummary)return json({error:'public_summary_required'},400,NO_STORE);
  if(statusAfter==='free_agent'&&sourceType==='secondary_reporting_with_attribution'&&evidenceConfidence==='C')return json({error:'free_agent_requires_stronger_source'},400,NO_STORE);
  const promotionSlug=text(value.promotion_slug,100),promotionName=text(value.promotion_name,160);
  const existing=await env.DB.prepare(`SELECT e.id FROM fighter_contract_events e JOIN fighter_contract_evidence ev ON ev.contract_event_id=e.id WHERE e.source_key=? AND e.source_fighter_id=? AND e.event_type=? AND ev.source_url=? LIMIT 1`).bind(fighter.source_key,fighter.source_fighter_id,eventType,sourceUrl).first<{id:number}>();
  let eventId=existing?.id||null;
  const isCurrent=value.is_current===true||value.is_current===1||value.is_current==='1';
  if(!eventId){
    if(isCurrent&&promotionSlug)await env.DB.prepare(`UPDATE fighter_contract_events SET is_current=0,updated_at=CURRENT_TIMESTAMP WHERE source_key=? AND source_fighter_id=? AND promotion_slug=? AND is_current=1`).bind(fighter.source_key,fighter.source_fighter_id,promotionSlug).run();
    const eventKey=`${fighter.source_key}:${fighter.source_fighter_id}:${crypto.randomUUID()}`;
    const result=await env.DB.prepare(`INSERT INTO fighter_contract_events(event_key,source_key,source_fighter_id,promotion_slug,promotion_name,event_type,agreement_type,status_after,signed_at,effective_at,reported_at,expires_at,fights_total,fights_remaining_reported,term_months,exclusive,matching_rights,champion_clause,extension_option,guaranteed_pay_minor,win_bonus_minor,currency,disclosure_scope,public_summary,is_current,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING id`).bind(eventKey,fighter.source_key,fighter.source_fighter_id,promotionSlug,promotionName,eventType,agreementType,statusAfter,text(value.signed_at,40),text(value.effective_at,40),text(value.reported_at,40),text(value.expires_at,40),nonnegative(value.fights_total),nonnegative(value.fights_remaining_reported),nonnegative(value.term_months),enumValue(YESNO,value.exclusive,'unknown'),enumValue(YESNO,value.matching_rights,'unknown'),enumValue(YESNO,value.champion_clause,'unknown'),enumValue(YESNO,value.extension_option,'unknown'),nonnegative(value.guaranteed_pay_minor),nonnegative(value.win_bonus_minor),text(value.currency,8)?.toUpperCase()||null,enumValue(SCOPES,value.disclosure_scope,'status_only'),publicSummary,isCurrent?1:0).first<{id:number}>();
    eventId=result?.id||null;
  }
  if(!eventId)return json({error:'contract_event_write_failed'},500,NO_STORE);
  await env.DB.prepare(`INSERT INTO fighter_contract_evidence(contract_event_id,source_url,source_title,publisher,published_at,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP,?) ON CONFLICT(contract_event_id,source_url) DO UPDATE SET source_title=excluded.source_title,publisher=excluded.publisher,published_at=excluded.published_at,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP,notes=excluded.notes`).bind(eventId,sourceUrl,text(value.source_title,500),text(value.publisher,200),text(value.published_at,40),sourceType,evidenceConfidence,text(value.verified_at,40),text(value.notes,2000)).run();
  if(isCurrent&&(statusAfter==='under_contract'||statusAfter==='non_exclusive'||statusAfter==='free_agent')){
    await env.DB.prepare(`INSERT INTO fighter_opportunity_status(source_key,source_fighter_id,contract_status,source_url,source_type,confidence,verified_at,last_checked_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET contract_status=excluded.contract_status,source_url=excluded.source_url,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP`).bind(fighter.source_key,fighter.source_fighter_id,statusAfter,sourceUrl,sourceType,evidenceConfidence).run();
  }
  return json({ok:true,profile_slug:profile,contract_event_id:eventId,event_type:eventType,status_after:statusAfter,is_current:isCurrent},200,NO_STORE);
}
