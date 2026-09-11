import {adminAccount,sameOrigin} from './admin-session.ts';
import {BRAND_NAME} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;

const GLOBAL_MODEL='global-1.0.0';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'};
const OPENING_STATUS=new Set(['open','paused','filled','closed']);
const CANDIDATE_STATUS=new Set(['suggested','shortlisted','contacted','passed','declined','booked']);
const MANAGEMENT=new Set(['any','unknown','represented','unmanaged']);
const CONTRACT=new Set(['any','unknown','under_contract','free_agent','non_exclusive']);
const OPPORTUNITY=new Set(['any','fights','management','team']);

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const text=(value:unknown,max=2000)=>{const out=String(value??'').trim();return out?out.slice(0,max):null;};
const int=(value:unknown,min:number,max:number)=>{if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):null;};
const num=(value:unknown,min:number,max:number)=>{if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):null;};
const date=(value:unknown)=>{const raw=String(value??'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:null;};
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '—';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(raw+'T12:00:00Z'));};
const score=(value:unknown)=>Number.isFinite(Number(value))?Number(value).toFixed(1):'—';
const pct=(value:unknown)=>Number.isFinite(Number(value))?Math.round(Number(value))+'%':'—';
const age=(dob:unknown)=>{const raw=String(dob||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;const born=new Date(raw+'T00:00:00Z'),today=new Date();let n=today.getUTCFullYear()-born.getUTCFullYear();if(today.getUTCMonth()<born.getUTCMonth()||(today.getUTCMonth()===born.getUTCMonth()&&today.getUTCDate()<born.getUTCDate()))n--;return n;};
const record=(r:Row)=>`${Number(r.career_wins||0)}-${Number(r.career_losses||0)}${Number(r.career_draws||0)?'-'+Number(r.career_draws):''}`;

async function body(request:Request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))return null;
  const raw=await request.text();if(new TextEncoder().encode(raw).length>12000)return null;
  try{return JSON.parse(raw) as Row}catch{return null;}
}
async function admin(request:Request,env:Env){return adminAccount(request,env.DB);}
function guardMutation(request:Request){return sameOrigin(request);}

function sanitizeOpening(input:Row){
  const management=String(input.management_filter||'any'),contract=String(input.contract_filter||'any'),opportunity=String(input.opportunity_filter||'any'),status=String(input.status||'open');
  return {
    title:text(input.title,160),
    promotion_name:text(input.promotion_name,160),
    weight_class:text(input.weight_class,80),
    target_date:date(input.target_date),
    event_city:text(input.event_city,120),
    event_region:text(input.event_region,120),
    event_country:text(input.event_country,120),
    age_min:int(input.age_min,14,60),
    age_max:int(input.age_max,14,60),
    min_wins:int(input.min_wins,0,100),
    min_rating:num(input.min_rating,0,100),
    min_evidence:num(input.min_evidence,0,100),
    active_months:int(input.active_months,1,60),
    management_filter:MANAGEMENT.has(management)?management:'any',
    contract_filter:CONTRACT.has(contract)?contract:'any',
    opportunity_filter:OPPORTUNITY.has(opportunity)?opportunity:'any',
    status:OPENING_STATUS.has(status)?status:'open',
    notes:text(input.notes,4000)
  };
}

async function ownedOpening(env:Env,ownerId:number,id:number){
  return env.DB.prepare('SELECT * FROM recruiting_openings WHERE id=? AND owner_account_id=? LIMIT 1').bind(id,ownerId).first<Row>();
}

async function openingCounts(env:Env,ownerId:number){
  const rows=(await env.DB.prepare(`SELECT o.id,o.title,o.promotion_name,o.weight_class,o.target_date,o.event_city,o.event_region,o.event_country,o.status,o.updated_at,
      COUNT(c.id) candidate_count,
      SUM(CASE WHEN c.status='shortlisted' THEN 1 ELSE 0 END) shortlisted_count,
      SUM(CASE WHEN c.status='contacted' THEN 1 ELSE 0 END) contacted_count,
      SUM(CASE WHEN c.status='booked' THEN 1 ELSE 0 END) booked_count
    FROM recruiting_openings o
    LEFT JOIN recruiting_opening_candidates c ON c.opening_id=o.id
    WHERE o.owner_account_id=?
    GROUP BY o.id
    ORDER BY CASE o.status WHEN 'open' THEN 0 WHEN 'paused' THEN 1 WHEN 'filled' THEN 2 ELSE 3 END,o.updated_at DESC`).bind(ownerId).all<Row>()).results||[];
  return rows;
}

function managementExpr(){return `CASE WHEN cm.source_fighter_id IS NOT NULL THEN 'represented' ELSE COALESCE(o.management_status,'unknown') END`;}
function availabilityExpr(){return `CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.open_to_fights ELSE COALESCE(ca.open_to_fights,'unknown') END`;}
function baseCityExpr(){return `CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_city ELSE cl.base_city END`;}
function baseRegionExpr(){return `CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_region ELSE cl.base_region END`;}
function baseCountryExpr(){return `CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_country ELSE cl.base_country END`;}
function agencyContactHref(row:Row){
  const value=String(row.agency_contact_value||'').trim();
  if(!value)return null;
  if(row.agency_contact_kind==='booking_email'||row.agency_contact_kind==='general_email'){
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)?'mailto:'+value:null;
  }
  try{const url=new URL(value);return url.protocol==='https:'?url.href:null}catch{return null;}
}
function agencyContactLabel(kind:unknown){
  if(kind==='booking_email')return 'Agency booking email';
  if(kind==='general_email')return 'Agency email';
  if(kind==='booking_form')return 'Agency booking form';
  if(kind==='contact_form')return 'Agency contact form';
  return 'Agency contact';
}

function candidateQuery(opening:Row,limit=100){
  const clauses=[`COALESCE(controls.public_status,'public')='public'`,`r.model_version=?`];
  const binds:any[]=[GLOBAL_MODEL];
  if(opening.weight_class){clauses.push('p.current_weight_class=?');binds.push(opening.weight_class);}
  if(opening.age_min!==null){clauses.push(`p.dob IS NOT NULL AND CAST((julianday('now')-julianday(substr(p.dob,1,10)))/365.2425 AS INTEGER)>=?`);binds.push(opening.age_min);}
  if(opening.age_max!==null){clauses.push(`p.dob IS NOT NULL AND CAST((julianday('now')-julianday(substr(p.dob,1,10)))/365.2425 AS INTEGER)<=?`);binds.push(opening.age_max);}
  if(opening.min_wins!==null){clauses.push('p.career_wins>=?');binds.push(opening.min_wins);}
  if(opening.min_rating!==null){clauses.push('r.scout_rating>=?');binds.push(opening.min_rating);}
  if(opening.min_evidence!==null){clauses.push('r.evidence_strength>=?');binds.push(opening.min_evidence);}
  if(opening.active_months!==null){clauses.push(`p.last_fight_date IS NOT NULL AND date(substr(p.last_fight_date,1,10))>=date('now',?)`);binds.push('-'+Math.round(Number(opening.active_months))+' months');}
  if(opening.management_filter!=='any'){clauses.push(managementExpr()+'=?');binds.push(opening.management_filter);}
  if(opening.contract_filter!=='any'){clauses.push(`COALESCE(o.contract_status,'unknown')=?`);binds.push(opening.contract_filter);}
  if(opening.opportunity_filter==='fights')clauses.push(availabilityExpr()+"='yes'");
  if(opening.opportunity_filter==='management')clauses.push(`o.open_to_management='yes'`);
  if(opening.opportunity_filter==='team')clauses.push(`o.open_to_team='yes'`);
  binds.push(limit);
  return {sql:`
    SELECT p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,p.dob,p.nationality,p.gym,p.current_weight_class,p.current_promotion_slug,
           p.last_fight_date,p.career_wins,p.career_losses,p.career_draws,
           r.scout_rating global_rating,r.evidence_strength,
           sp.name promotion_name,
           ${managementExpr()} management_status,cm.agency_name,cm.agency_website,cm.agency_contact_kind,cm.agency_contact_value,cm.agency_contact_label,cm.agency_contact_verified_at,cm.manager_name,cm.verified_at management_verified_at,
           COALESCE(o.contract_status,'unknown') contract_status,${availabilityExpr()} open_to_fights,
           ${baseCityExpr()} base_city,${baseRegionExpr()} base_region,${baseCountryExpr()} base_country,
           o.public_contact_url,o.verified_at opportunity_verified_at,
           CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.verified_at ELSE ca.verified_at END availability_verified_at,
           CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.verified_at ELSE cl.verified_at END base_verified_at
    FROM scout_public_global_profiles p
    LEFT JOIN scout_promotions sp ON sp.slug=p.current_promotion_slug
    LEFT JOIN scout_active_global_ratings r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id
    LEFT JOIN fighter_publication_controls controls ON controls.source_key=p.source_key AND controls.source_fighter_id=p.source_fighter_id
    LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_availability ca ON ca.source_key=p.source_key AND ca.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_location cl ON cl.source_key=p.source_key AND cl.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY r.scout_rating IS NULL,r.scout_rating DESC,r.evidence_strength DESC,p.last_fight_date DESC,p.fighter_name
    LIMIT ?`,binds};
}

function intelligenceGaps(row:Row){
  const gaps:string[]=[];
  if(row.management_status==='unknown')gaps.push('management');
  if(row.contract_status==='unknown')gaps.push('contract');
  if(!row.base_city&&!row.base_region&&!row.base_country)gaps.push('base');
  if(!row.public_contact_url&&!row.agency_contact_value)gaps.push('contact');
  if(row.open_to_fights==='unknown')gaps.push('availability');
  const stale=(value:unknown,days:number)=>{const t=Date.parse(String(value||''));return !Number.isFinite(t)||Date.now()-t>days*86400000;};
  if(row.management_status!=='unknown'&&stale(row.management_verified_at,180))gaps.push('management stale');
  if(row.contract_status!=='unknown'&&stale(row.opportunity_verified_at,120))gaps.push('contract stale');
  if(row.open_to_fights!=='unknown'&&stale(row.availability_verified_at||row.opportunity_verified_at,90))gaps.push('availability stale');
  if((row.base_city||row.base_region||row.base_country)&&stale(row.base_verified_at||row.opportunity_verified_at,180))gaps.push('base stale');
  if(row.agency_contact_value&&stale(row.agency_contact_verified_at,180))gaps.push('contact stale');
  if(!Number.isFinite(Number(row.evidence_strength))||Number(row.evidence_strength)<50)gaps.push('performance evidence');
  return gaps;
}

async function candidateRows(env:Env,openingId:number){
  const rows=(await env.DB.prepare(`
    SELECT c.id candidate_id,c.status candidate_status,c.priority,c.notes candidate_notes,c.contacted_at,c.last_reviewed_at,c.updated_at candidate_updated_at,
           p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,p.dob,p.nationality,p.gym,p.current_weight_class,p.current_promotion_slug,
           p.last_fight_date,p.career_wins,p.career_losses,p.career_draws,
           r.scout_rating global_rating,r.evidence_strength,
           sp.name promotion_name,
           ${managementExpr()} management_status,cm.agency_name,cm.agency_website,cm.agency_contact_kind,cm.agency_contact_value,cm.agency_contact_label,cm.agency_contact_verified_at,cm.manager_name,cm.verified_at management_verified_at,
           COALESCE(o.contract_status,'unknown') contract_status,${availabilityExpr()} open_to_fights,
           ${baseCityExpr()} base_city,${baseRegionExpr()} base_region,${baseCountryExpr()} base_country,
           o.public_contact_url,o.verified_at opportunity_verified_at,
           CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.verified_at ELSE ca.verified_at END availability_verified_at,
           CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.verified_at ELSE cl.verified_at END base_verified_at
    FROM recruiting_opening_candidates c
    JOIN scout_public_global_profiles p ON p.source_key=c.source_key AND p.source_fighter_id=c.source_fighter_id
    LEFT JOIN scout_active_global_ratings r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    LEFT JOIN scout_promotions sp ON sp.slug=p.current_promotion_slug
    LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_availability ca ON ca.source_key=p.source_key AND ca.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_location cl ON cl.source_key=p.source_key AND cl.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
    WHERE c.opening_id=?
    ORDER BY CASE c.status WHEN 'booked' THEN 0 WHEN 'contacted' THEN 1 WHEN 'shortlisted' THEN 2 WHEN 'suggested' THEN 3 WHEN 'declined' THEN 4 ELSE 5 END,
             c.priority DESC,r.scout_rating IS NULL,r.scout_rating DESC,r.evidence_strength DESC,p.fighter_name`).bind(GLOBAL_MODEL,openingId).all<Row>()).results||[];
  return rows.map(row=>({...row,intelligence_gaps:intelligenceGaps(row),age:age(row.dob)}));
}

export async function recruitingOpeningsApi(request:Request,env:Env){
  const who=await admin(request,env);if(!who)return json({error:'unauthorized'},401);
  if(request.method==='GET')return json({data:await openingCounts(env,Number(who.id))});
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!guardMutation(request))return json({error:'cross_origin'},403);
  const input=await body(request);if(!input)return json({error:'invalid_json'},400);
  const o=sanitizeOpening(input);if(!o.title)return json({error:'title_required'},400);
  if(o.age_min!==null&&o.age_max!==null&&o.age_min>o.age_max)return json({error:'age_range_invalid'},400);
  const result=await env.DB.prepare(`INSERT INTO recruiting_openings(
      owner_account_id,title,promotion_name,weight_class,target_date,event_city,event_region,event_country,
      age_min,age_max,min_wins,min_rating,min_evidence,active_months,management_filter,contract_filter,opportunity_filter,status,notes
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      who.id,o.title,o.promotion_name,o.weight_class,o.target_date,o.event_city,o.event_region,o.event_country,
      o.age_min,o.age_max,o.min_wins,o.min_rating,o.min_evidence,o.active_months,o.management_filter,o.contract_filter,o.opportunity_filter,o.status,o.notes
    ).run();
  return json({ok:true,id:Number(result.meta.last_row_id)},201);
}

export async function recruitingOpeningApi(request:Request,env:Env,id:number){
  const who=await admin(request,env);if(!who)return json({error:'unauthorized'},401);
  const current=await ownedOpening(env,Number(who.id),id);if(!current)return json({error:'opening_not_found'},404);
  if(request.method==='GET')return json({data:current,candidates:await candidateRows(env,id)});
  if(request.method!=='PATCH')return json({error:'method_not_allowed'},405);
  if(!guardMutation(request))return json({error:'cross_origin'},403);
  const input=await body(request);if(!input)return json({error:'invalid_json'},400);
  const merged=sanitizeOpening({...current,...input});if(!merged.title)return json({error:'title_required'},400);
  if(merged.age_min!==null&&merged.age_max!==null&&merged.age_min>merged.age_max)return json({error:'age_range_invalid'},400);
  await env.DB.prepare(`UPDATE recruiting_openings SET title=?,promotion_name=?,weight_class=?,target_date=?,event_city=?,event_region=?,event_country=?,
      age_min=?,age_max=?,min_wins=?,min_rating=?,min_evidence=?,active_months=?,management_filter=?,contract_filter=?,opportunity_filter=?,status=?,notes=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND owner_account_id=?`).bind(
      merged.title,merged.promotion_name,merged.weight_class,merged.target_date,merged.event_city,merged.event_region,merged.event_country,
      merged.age_min,merged.age_max,merged.min_wins,merged.min_rating,merged.min_evidence,merged.active_months,merged.management_filter,merged.contract_filter,merged.opportunity_filter,merged.status,merged.notes,id,who.id
    ).run();
  return json({ok:true,data:await ownedOpening(env,Number(who.id),id)});
}

export async function generateRecruitingCandidatesApi(request:Request,env:Env,id:number){
  const who=await admin(request,env);if(!who)return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!guardMutation(request))return json({error:'cross_origin'},403);
  const opening=await ownedOpening(env,Number(who.id),id);if(!opening)return json({error:'opening_not_found'},404);
  const query=candidateQuery(opening,100);
  const matches=(await env.DB.prepare(query.sql).bind(...query.binds).all<Row>()).results||[];
  if(matches.length){
    const statements=matches.map(row=>env.DB.prepare(`INSERT OR IGNORE INTO recruiting_opening_candidates(opening_id,source_key,source_fighter_id,profile_slug)
      VALUES(?,?,?,?)`).bind(id,row.source_key,row.source_fighter_id,row.profile_slug));
    await env.DB.batch(statements);
  }
  await env.DB.prepare('UPDATE recruiting_openings SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_account_id=?').bind(id,who.id).run();
  return json({ok:true,matched:matches.length,candidates:await candidateRows(env,id)});
}

export async function recruitingCandidateApi(request:Request,env:Env,candidateId:number){
  const who=await admin(request,env);if(!who)return json({error:'unauthorized'},401);
  const candidate=await env.DB.prepare(`SELECT c.*,o.owner_account_id FROM recruiting_opening_candidates c JOIN recruiting_openings o ON o.id=c.opening_id
    WHERE c.id=? AND o.owner_account_id=? LIMIT 1`).bind(candidateId,who.id).first<Row>();
  if(!candidate)return json({error:'candidate_not_found'},404);
  if(request.method!=='PATCH')return json({error:'method_not_allowed'},405);
  if(!guardMutation(request))return json({error:'cross_origin'},403);
  const input=await body(request);if(!input)return json({error:'invalid_json'},400);
  const nextStatus=CANDIDATE_STATUS.has(String(input.status))?String(input.status):String(candidate.status);
  const priority=int(input.priority,0,5)??Number(candidate.priority||0);
  const notes=input.notes===undefined?candidate.notes:text(input.notes,4000);
  const contacted=nextStatus==='contacted'&&!candidate.contacted_at?new Date().toISOString():candidate.contacted_at;
  await env.DB.prepare(`UPDATE recruiting_opening_candidates SET status=?,priority=?,notes=?,contacted_at=?,last_reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(nextStatus,priority,notes,contacted,candidateId).run();
  return json({ok:true});
}

function openingBrief(o:Row){
  const bits=[o.weight_class||'Any division'];
  if(o.age_min!==null||o.age_max!==null)bits.push('Age '+(o.age_min??'any')+'–'+(o.age_max??'any'));
  if(o.min_wins!==null)bits.push(o.min_wins+'+ wins');
  if(o.min_rating!==null)bits.push('Rating '+Number(o.min_rating).toFixed(0)+'+');
  if(o.active_months!==null)bits.push('Fought in last '+o.active_months+' mo');
  return bits.join(' · ');
}
function candidateCard(row:Row){
  const gaps=row.intelligence_gaps as string[];
  const agencyHref=agencyContactHref(row);
  const contact=row.public_contact_url?`<a href="${esc(row.public_contact_url)}" rel="nofollow noopener" target="_blank">Direct public contact ↗</a>`:agencyHref?`<a href="${esc(agencyHref)}" rel="nofollow noopener">${esc(agencyContactLabel(row.agency_contact_kind))} ↗</a>`:row.agency_website?`<a href="${esc(row.agency_website)}" rel="nofollow noopener" target="_blank">Agency website ↗</a>`:'No public contact path';
  const rep=row.management_status==='represented'?(row.agency_name||row.manager_name||'Represented'):row.management_status==='unmanaged'?'Verified unmanaged':'Management unknown';
  const base=[row.base_city,row.base_region,row.base_country].filter(Boolean).join(', ')||'Base unknown';
  return `<article class="recruit-candidate" data-candidate="${row.candidate_id}">
    <div class="recruit-candidate-head"><div><span class="eyebrow">${esc(row.current_weight_class||'Unknown division')}${row.promotion_name?' · '+esc(row.promotion_name):''}</span><h3><a href="/scout/fighters/${esc(row.profile_slug)}">${esc(row.fighter_name)}</a></h3><p>${esc(record(row))}${row.age!==null?' · Age '+row.age:''}${row.last_fight_date?' · Last fight '+esc(pretty(row.last_fight_date)):''}</p></div><div class="recruit-score"><small>GLOBAL RATING</small><strong>${score(row.global_rating)}</strong><span>Evidence ${pct(row.evidence_strength)}</span></div></div>
    <div class="recruit-facts"><span>${esc(rep)}</span><span>Contract: ${esc(String(row.contract_status||'unknown').replaceAll('_',' '))}</span><span>${esc(base)}</span><span>${contact}</span></div>
    <div class="recruit-gaps"><strong>Intel gaps</strong>${gaps.length?gaps.map(g=>`<span>${esc(g)}</span>`).join(''):'<span class="complete">Core recruiting intel covered</span>'}</div>
    <div class="recruit-actions">
      <select data-status aria-label="Candidate status">${['suggested','shortlisted','contacted','passed','declined','booked'].map(v=>`<option value="${v}"${row.candidate_status===v?' selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select>
      <select data-priority aria-label="Priority">${[0,1,2,3,4,5].map(v=>`<option value="${v}"${Number(row.priority)===v?' selected':''}>Priority ${v}</option>`).join('')}</select>
      <button class="button secondary" type="button" data-save-candidate>Save</button>
      <a class="button secondary" href="/scout/fighters/${esc(row.profile_slug)}">Recruiting file →</a>
    </div>
    <textarea data-candidate-notes maxlength="4000" placeholder="Internal recruiting notes…">${esc(row.candidate_notes||'')}</textarea>
  </article>`;
}

function shell(bodyHtml:string,script=''){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Recruiting Workspace | ${BRAND_NAME}</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/recruiting.css?v=1"></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="recruit-main">${bodyHtml}</main><footer><span>${BRAND_NAME}</span><span>Private recruiting workspace.</span></footer>${script}</body></html>`;
}
function authPage(){
  return new Response(shell('<section class="recruit-hero"><span class="eyebrow">PRIVATE WORKSPACE</span><h1>Recruiting access required.</h1><p>This surface is restricted to authorized MMA Scouts recruiting users.</p><a class="button primary" href="/admin">Admin sign in →</a></section>'),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}

export async function recruitingPage(request:Request,env:Env){
  const who=await admin(request,env);if(!who)return authPage();
  const openings=await openingCounts(env,Number(who.id));
  const cards=openings.map(o=>`<a class="opening-card" href="/recruiting/openings/${o.id}"><div><span class="eyebrow">${esc(String(o.status).toUpperCase())}</span><h2>${esc(o.title)}</h2><p>${esc(openingBrief(o))}</p></div><div class="opening-counts"><span><strong>${Number(o.candidate_count||0)}</strong> candidates</span><span><strong>${Number(o.shortlisted_count||0)}</strong> shortlisted</span><span><strong>${Number(o.contacted_count||0)}</strong> contacted</span></div></a>`).join('');
  const bodyHtml=`<section class="recruit-hero"><span class="eyebrow">RECRUITING WORKSPACE</span><h1>Openings, shortlists, and the intel behind the call.</h1><p>Create a recruiting need, generate candidates from the verified fighter graph, then track review, outreach and intelligence gaps privately.</p><div class="hero-actions"><a class="button primary" href="/recruiting/intel">Open intelligence queue →</a><a class="button secondary" href="/recruiting/contracts">Review contract leads →</a></div></section>
  <section class="recruit-layout"><div><div class="section-heading"><div><span class="eyebrow">ACTIVE BOARD</span><h2>Your openings</h2></div></div><div class="opening-grid">${cards||'<div class="recruit-empty">No recruiting openings yet.</div>'}</div></div>
  <aside class="opening-create"><span class="eyebrow">NEW OPENING</span><h2>Create a recruiting brief</h2><form id="opening-create-form">
    <label>Title<input name="title" required maxlength="160" placeholder="Lightweight for Nov. 14"></label>
    <label>Promotion<input name="promotion_name" maxlength="160" placeholder="Promotion / client"></label>
    <label>Division<input name="weight_class" maxlength="80" placeholder="Lightweight"></label>
    <label>Target date<input name="target_date" type="date"></label>
    <div class="form-pair"><label>Min age<input name="age_min" type="number" min="14" max="60"></label><label>Max age<input name="age_max" type="number" min="14" max="60"></label></div>
    <div class="form-pair"><label>Min wins<input name="min_wins" type="number" min="0"></label><label>Active months<input name="active_months" type="number" min="1" max="60" placeholder="12"></label></div>
    <div class="form-pair"><label>Min rating<input name="min_rating" type="number" min="0" max="100"></label><label>Min evidence<input name="min_evidence" type="number" min="0" max="100"></label></div>
    <label>Event city<input name="event_city" maxlength="120"></label><label>Event region/state<input name="event_region" maxlength="120"></label><label>Event country<input name="event_country" maxlength="120"></label>
    <label>Management<select name="management_filter"><option value="any">Any</option><option value="represented">Represented</option><option value="unmanaged">Verified unmanaged</option><option value="unknown">Unknown</option></select></label>
    <label>Contract<select name="contract_filter"><option value="any">Any</option><option value="free_agent">Verified free agent</option><option value="non_exclusive">Non-exclusive</option><option value="under_contract">Under contract</option><option value="unknown">Unknown</option></select></label>
    <label>Opportunity<select name="opportunity_filter"><option value="any">Any</option><option value="fights">Open to fights</option><option value="management">Open to management</option><option value="team">Open to teams</option></select></label>
    <label>Notes<textarea name="notes" maxlength="4000" placeholder="Internal constraints, travel, opponent profile, etc."></textarea></label>
    <button class="button primary" type="submit">Create opening</button><p class="form-status" data-form-status></p>
  </form></aside></section>`;
  const script=`<script>(()=>{const f=document.querySelector('#opening-create-form'),s=document.querySelector('[data-form-status]');f?.addEventListener('submit',async e=>{e.preventDefault();s.textContent='Creating…';const fd=new FormData(f),payload=Object.fromEntries(fd.entries());for(const k of ['age_min','age_max','min_wins','active_months','min_rating','min_evidence'])if(payload[k]==='')payload[k]=null;try{const r=await fetch('/api/admin/recruiting/openings',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');location.href='/recruiting/openings/'+j.id;}catch(err){s.textContent=err.message||'Could not create opening.';}});})();</script>`;
  return new Response(shell(bodyHtml,script),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}

const INTEL_GAPS=new Set(['all','management','contract','availability','base','contact']);

export async function recruitingIntelQueuePage(request:Request,env:Env){
  const who=await admin(request,env);if(!who)return authPage();
  const url=new URL(request.url),gap=INTEL_GAPS.has(String(url.searchParams.get('gap')||'all'))?String(url.searchParams.get('gap')||'all'):'all';
  const division=String(url.searchParams.get('weight_class')||'').trim().slice(0,80);
  const minRating=num(url.searchParams.get('min_rating'),0,100);
  const clauses=[`(c.management_status='unknown' OR c.contract_status='unknown' OR c.open_to_fights='unknown' OR COALESCE(c.base_city,c.base_region,c.base_country) IS NULL OR (c.public_contact_url IS NULL AND cm.agency_contact_value IS NULL))`];
  const binds:any[]=[GLOBAL_MODEL];
  if(gap==='management')clauses.push(`c.management_status='unknown'`);
  if(gap==='contract')clauses.push(`c.contract_status='unknown'`);
  if(gap==='availability')clauses.push(`c.open_to_fights='unknown'`);
  if(gap==='base')clauses.push(`COALESCE(c.base_city,c.base_region,c.base_country) IS NULL`);
  if(gap==='contact')clauses.push(`c.public_contact_url IS NULL AND cm.agency_contact_value IS NULL`);
  if(division){clauses.push('c.current_weight_class=?');binds.push(division);}
  if(minRating!==null){clauses.push('r.scout_rating>=?');binds.push(minRating);}
  const rows=(await env.DB.prepare(`
    SELECT c.*,r.scout_rating global_rating,r.evidence_strength,
           COALESCE(o.public_contact_url,c.public_contact_url,cm.agency_contact_value) resolved_contact_evidence_url,
           COALESCE(o.public_contact_url,c.public_contact_url,cm.agency_contact_value,cm.agency_website) resolved_contact_url
    FROM scout_fighter_intel_coverage c
    JOIN scout_public_global_profiles p ON p.source_key=c.source_key AND p.source_fighter_id=c.source_fighter_id
    LEFT JOIN scout_active_global_ratings r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    LEFT JOIN fighter_opportunity_status o ON o.source_key=c.source_key AND o.source_fighter_id=c.source_fighter_id
    LEFT JOIN scout_current_management cm ON cm.source_key=c.source_key AND cm.source_fighter_id=c.source_fighter_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY CASE WHEN c.last_fight_date IS NOT NULL AND date(substr(c.last_fight_date,1,10))>=date('now','-18 months') THEN 0 ELSE 1 END,
             r.scout_rating IS NULL,r.scout_rating DESC,r.evidence_strength DESC,c.last_fight_date DESC,c.fighter_name
    LIMIT 300`).bind(...binds).all<Row>()).results||[];
  const cards=rows.map(row=>{
    const gaps=[];if(row.management_status==='unknown')gaps.push('management');if(row.contract_status==='unknown')gaps.push('contract');if(row.open_to_fights==='unknown')gaps.push('availability');if(!row.base_city&&!row.base_region&&!row.base_country)gaps.push('base');if(!row.resolved_contact_evidence_url)gaps.push('contact');
    return `<article class="intel-queue-card"><div class="recruit-candidate-head"><div><span class="eyebrow">${esc(row.current_weight_class||'Unknown division')}${row.current_organization?' · '+esc(row.current_organization):''}</span><h3><a href="/scout/fighters/${esc(row.profile_slug)}">${esc(row.fighter_name)}</a></h3><p>${row.last_fight_date?'Last fight '+esc(pretty(row.last_fight_date)):'No recorded fight date'} · Coverage ${Number(row.intel_coverage_pct||0).toFixed(1)}%</p></div><div class="recruit-score"><small>GLOBAL RATING</small><strong>${score(row.global_rating)}</strong><span>Evidence ${pct(row.evidence_strength)}</span></div></div><div class="recruit-gaps"><strong>Research next</strong>${gaps.map(g=>`<span>${esc(g)}</span>`).join('')}</div><div class="intel-queue-actions"><a class="button secondary" href="/scout/fighters/${esc(row.profile_slug)}">Open fighter intel →</a><a class="button secondary" href="/talent?q=${encodeURIComponent(String(row.fighter_name||''))}">Recruiting search →</a></div></article>`;
  }).join('');
  const bodyHtml=`<section class="recruit-hero"><a class="back-link" href="/recruiting">← Recruiting board</a><span class="eyebrow">INTELLIGENCE OPERATIONS</span><h1>Close the gaps that block recruiting decisions.</h1><p>This queue prioritizes useful, active fighter files with unresolved recruiting intelligence. Ordering uses existing performance/evidence data only; missing management, contract, availability, base or contact information never changes Global Rating.</p></section>
  <section class="intel-filter-panel"><form method="get" action="/recruiting/intel"><label>Gap<select name="gap">${['all','management','contract','availability','base','contact'].map(v=>`<option value="${v}"${gap===v?' selected':''}>${v==='all'?'Any recruiting gap':v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></label><label>Division<input name="weight_class" value="${esc(division)}" placeholder="Lightweight"></label><label>Min Global Rating<input name="min_rating" type="number" min="0" max="100" value="${minRating??''}" placeholder="70"></label><button class="button primary" type="submit">Build intel queue</button></form></section>
  <section class="candidate-section"><div class="section-heading"><div><span class="eyebrow">RESEARCH QUEUE</span><h2>${rows.length} fighter files</h2></div><p class="queue-note">Up to 300 files · active/recent fighters first · no composite recruitability score.</p></div><div class="candidate-grid">${cards||'<div class="recruit-empty">No fighter files match that intelligence-gap filter.</div>'}</div></section>`;
  return new Response(shell(bodyHtml),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}

export async function recruitingOpeningPage(request:Request,env:Env,id:number){
  const who=await admin(request,env);if(!who)return authPage();
  const opening=await ownedOpening(env,Number(who.id),id);if(!opening)return new Response(shell('<section class="recruit-hero"><h1>Opening not found.</h1><a href="/recruiting">Back to recruiting →</a></section>'),{status:404,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store'}});
  const rows=await candidateRows(env,id);
  const gapCounts=new Map<string,number>();for(const row of rows)for(const g of row.intelligence_gaps as string[])gapCounts.set(g,(gapCounts.get(g)||0)+1);
  const gapHtml=[...gapCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([g,n])=>`<span><strong>${n}</strong> ${esc(g)}</span>`).join('');
  const bodyHtml=`<section class="recruit-hero opening-hero"><a class="back-link" href="/recruiting">← Recruiting board</a><span class="eyebrow">${esc(String(opening.status).toUpperCase())}</span><h1>${esc(opening.title)}</h1><p>${esc(openingBrief(opening))}</p><div class="opening-meta">${opening.promotion_name?'<span>'+esc(opening.promotion_name)+'</span>':''}${opening.target_date?'<span>Target '+esc(pretty(opening.target_date))+'</span>':''}${opening.event_city||opening.event_region||opening.event_country?'<span>'+esc([opening.event_city,opening.event_region,opening.event_country].filter(Boolean).join(', '))+'</span>':''}</div><div class="hero-actions"><button class="button primary" type="button" data-generate>Generate / refresh candidates</button><span data-generate-status></span></div></section>
  <section class="intel-queue"><div><span class="eyebrow">INTELLIGENCE QUEUE</span><h2>What we still need to know</h2><p>These are recruiting-data gaps, not rating penalties. They prioritize research without changing Global Rating.</p></div><div class="intel-gap-summary">${gapHtml||'<span class="complete">No core gaps in the current candidate set.</span>'}</div></section>
  <section class="candidate-section"><div class="section-heading"><div><span class="eyebrow">CANDIDATES</span><h2>${rows.length} on this board</h2></div><div class="candidate-filter"><button type="button" data-filter="all" class="active">All</button><button type="button" data-filter="shortlisted">Shortlisted</button><button type="button" data-filter="contacted">Contacted</button><button type="button" data-filter="suggested">Suggested</button></div></div><div class="candidate-grid" data-candidate-grid>${rows.map(candidateCard).join('')||'<div class="recruit-empty">Generate candidates from this opening to start the board.</div>'}</div></section>`;
  const script=`<script>(()=>{const id=${id};const gs=document.querySelector('[data-generate-status]');document.querySelector('[data-generate]')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;gs.textContent='Refreshing candidate pool…';try{const r=await fetch('/api/admin/recruiting/openings/'+id+'/generate',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'}),j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');location.reload();}catch(err){gs.textContent=err.message||'Could not generate candidates.';e.currentTarget.disabled=false;}});
  document.querySelectorAll('[data-save-candidate]').forEach(btn=>btn.addEventListener('click',async()=>{const card=btn.closest('[data-candidate]'),candidateId=card.dataset.candidate;btn.disabled=true;const payload={status:card.querySelector('[data-status]').value,priority:Number(card.querySelector('[data-priority]').value),notes:card.querySelector('[data-candidate-notes]').value};try{const r=await fetch('/api/admin/recruiting/candidates/'+candidateId,{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');btn.textContent='Saved';setTimeout(()=>btn.textContent='Save',1000);}catch(err){btn.textContent='Retry';}finally{btn.disabled=false;}}));
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));const v=b.dataset.filter;document.querySelectorAll('[data-candidate]').forEach(card=>card.hidden=v!=='all'&&card.querySelector('[data-status]').value!==v);}));})();</script>`;
  return new Response(shell(bodyHtml,script),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}
