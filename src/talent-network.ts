import {adminAccount} from './admin-session.ts';
import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const GLOBAL_MODEL='global-1.0.0';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=30, s-maxage=120','x-content-type-options':'nosniff'};
const NO_STORE={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
const json=(value:unknown,status=200,headers=JSON_HEADERS)=>new Response(JSON.stringify(value),{status,headers});
const limit=(value:string|null,fallback=25,max=100)=>Math.min(max,Math.max(1,Number.parseInt(value||'',10)||fallback));
const offset=(value:string|null)=>Math.max(0,Number.parseInt(value||'',10)||0);
const number=(value:string|null,min:number,max:number)=>{if(value===null||value.trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):null;};
const slugify=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120);
const score=(value:unknown)=>value===null||value===undefined||value===''?'—':Number.isFinite(Number(value))?Number(value).toFixed(1):'—';
const percent=(value:unknown)=>value===null||value===undefined||value===''?'—':Number.isFinite(Number(value))?`${Math.round(Number(value))}%`:'—';
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '—';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};
const record=(row:Row)=>`${Number(row.career_wins||0)}-${Number(row.career_losses||0)}${Number(row.career_draws||0)?`-${Number(row.career_draws)}`:''}`;

const MANAGEMENT=new Set(['unknown','represented','unmanaged']);
const CONTRACT=new Set(['unknown','under_contract','free_agent','non_exclusive']);
const YESNO=new Set(['unknown','yes','no']);
const CONFIDENCE=new Set(['A','B','C']);

function canonical(path:string){return `${SITE_ORIGIN}${path}`;}
function shell(title:string,description:string,path:string,body:string){
  const url=canonical(path);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${SITE_ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/talent.css?v=2"></head><body><header class="topbar"><a class="brand" href="/" aria-label="${BRAND_NAME} home"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="talent-main">${body}</main><footer><span>${BRAND_NAME}</span><span>The MMA research engine.</span></footer></body></html>`;
}

function managementExpression(){return `CASE WHEN cm.source_fighter_id IS NOT NULL THEN 'represented' ELSE COALESCE(o.management_status,'unknown') END`;}

function talentWhere(url:URL){
  const clauses=['1=1'];const binds:any[]=[GLOBAL_MODEL];
  const q=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,100);
  const division=(url.searchParams.get('weight_class')||'').trim().slice(0,80);
  const promotion=(url.searchParams.get('promotion')||'').trim().slice(0,100);
  const region=(url.searchParams.get('region')||'').trim().slice(0,80);
  const country=(url.searchParams.get('country')||'').trim().slice(0,100);
  const management=(url.searchParams.get('management')||'').trim();
  const contract=(url.searchParams.get('contract')||'').trim();
  const opportunity=(url.searchParams.get('opportunity')||'').trim();
  const ageMax=number(url.searchParams.get('age_max'),14,60),ageMin=number(url.searchParams.get('age_min'),14,60);
  const minRating=number(url.searchParams.get('min_rating'),0,100),minEvidence=number(url.searchParams.get('min_evidence'),0,100),minWins=number(url.searchParams.get('min_wins'),0,100);
  if(q){clauses.push(`(instr(p.normalized_name,?)>0 OR instr(lower(COALESCE(p.gym,'')),?)>0)`);binds.push(q,q);}
  if(division){clauses.push('p.current_weight_class=?');binds.push(division);}
  if(promotion){clauses.push('p.current_promotion_slug=?');binds.push(promotion);}
  if(region){clauses.push('sp.region=?');binds.push(region);}
  if(country){clauses.push(`lower(COALESCE(NULLIF(o.base_country,''),p.nationality,''))=lower(?)`);binds.push(country);}
  if(MANAGEMENT.has(management)){clauses.push(`${managementExpression()}=?`);binds.push(management);}
  if(CONTRACT.has(contract)){clauses.push(`COALESCE(o.contract_status,'unknown')=?`);binds.push(contract);}
  if(opportunity==='fights')clauses.push(`o.open_to_fights='yes'`);
  if(opportunity==='management')clauses.push(`o.open_to_management='yes'`);
  if(opportunity==='team')clauses.push(`o.open_to_team='yes'`);
  if(ageMax!==null){clauses.push(`p.dob IS NOT NULL AND CAST((julianday('now')-julianday(substr(p.dob,1,10)))/365.2425 AS INTEGER)<=?`);binds.push(ageMax);}
  if(ageMin!==null){clauses.push(`p.dob IS NOT NULL AND CAST((julianday('now')-julianday(substr(p.dob,1,10)))/365.2425 AS INTEGER)>=?`);binds.push(ageMin);}
  if(minRating!==null){clauses.push('r.scout_rating>=?');binds.push(minRating);}
  if(minEvidence!==null){clauses.push('r.evidence_strength>=?');binds.push(minEvidence);}
  if(minWins!==null){clauses.push('p.career_wins>=?');binds.push(minWins);}
  return {clauses,binds,filters:{q:q||null,division:division||null,promotion:promotion||null,region:region||null,country:country||null,management:management||null,contract:contract||null,opportunity:opportunity||null,age_max:ageMax,age_min:ageMin,min_rating:minRating,min_evidence:minEvidence,min_wins:minWins}};
}

async function talentRows(request:Request,env:Env){
  const url=new URL(request.url),take=limit(url.searchParams.get('limit'),25,100),skip=offset(url.searchParams.get('offset'));
  const {clauses,binds,filters}=talentWhere(url);
  if(Object.values(filters).every(value=>value===null)){
    const rows=await env.DB.prepare(`
      WITH ranked AS MATERIALIZED (
        SELECT p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,p.dob,p.nationality,p.gym,p.current_weight_class,
               p.current_promotion_slug,p.last_fight_date,p.career_wins,p.career_losses,p.career_draws,p.career_bouts,p.data_completeness,
               r.scout_rating global_rating,r.evidence_strength,r.global_rank,r.division_rank
        FROM scout_global_ratings AS r INDEXED BY idx_scout_global_rating_division
        JOIN mma_source_registry registry
          ON registry.source_key=r.source_key AND registry.active_snapshot_id=r.snapshot_id
        JOIN scout_global_profiles p
          ON p.source_key=r.source_key AND p.snapshot_id=r.snapshot_id AND p.source_fighter_id=r.source_fighter_id
        LEFT JOIN fighter_publication_controls controls
          ON controls.source_key=p.source_key AND controls.source_fighter_id=p.source_fighter_id
        WHERE r.model_version=? AND COALESCE(controls.public_status,'public')='public'
        ORDER BY r.scout_rating DESC,r.evidence_strength DESC
        LIMIT ? OFFSET ?
      )
      SELECT ranked.*,sp.name promotion_name,sp.region,
             CASE WHEN cm.source_fighter_id IS NOT NULL THEN 'represented' ELSE COALESCE(o.management_status,'unknown') END management_status,
             cm.agency_slug,cm.agency_name,cm.manager_name,cm.confidence management_confidence,cm.verified_at management_verified_at,
             COALESCE(o.contract_status,'unknown') contract_status,COALESCE(o.open_to_fights,'unknown') open_to_fights,
             COALESCE(o.open_to_management,'unknown') open_to_management,COALESCE(o.open_to_team,'unknown') open_to_team,
             o.preferred_weight_class,o.base_city,o.base_region,o.base_country,o.public_contact_url,o.availability_note,
             o.confidence opportunity_confidence,o.verified_at opportunity_verified_at
      FROM ranked
      LEFT JOIN scout_promotions sp ON sp.slug=ranked.current_promotion_slug
      LEFT JOIN fighter_opportunity_status o ON o.source_key=ranked.source_key AND o.source_fighter_id=ranked.source_fighter_id
      LEFT JOIN scout_current_management cm ON cm.source_key=ranked.source_key AND cm.source_fighter_id=ranked.source_fighter_id
      ORDER BY ranked.global_rating DESC,ranked.evidence_strength DESC,ranked.last_fight_date DESC,ranked.fighter_name
    `).bind(GLOBAL_MODEL,take,skip).all<Row>();
    return {rows:rows.results||[],filters,take,skip};
  }
  binds.push(take,skip);
  const rows=await env.DB.prepare(`
    SELECT p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,p.dob,p.nationality,p.gym,p.current_weight_class,
           p.current_promotion_slug,p.last_fight_date,p.career_wins,p.career_losses,p.career_draws,p.career_bouts,p.data_completeness,
           sp.name promotion_name,sp.region,
           r.scout_rating global_rating,r.evidence_strength,r.global_rank,r.division_rank,
           ${managementExpression()} management_status,cm.agency_slug,cm.agency_name,cm.manager_name,cm.confidence management_confidence,cm.verified_at management_verified_at,
           COALESCE(o.contract_status,'unknown') contract_status,COALESCE(o.open_to_fights,'unknown') open_to_fights,
           COALESCE(o.open_to_management,'unknown') open_to_management,COALESCE(o.open_to_team,'unknown') open_to_team,
           o.preferred_weight_class,o.base_city,o.base_region,o.base_country,o.public_contact_url,o.availability_note,
           o.confidence opportunity_confidence,o.verified_at opportunity_verified_at
    FROM scout_public_global_profiles p
    LEFT JOIN scout_promotions sp ON sp.slug=p.current_promotion_slug
    LEFT JOIN scout_active_global_ratings r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY r.scout_rating IS NULL,r.scout_rating DESC,r.evidence_strength DESC,p.last_fight_date DESC,p.fighter_name
    LIMIT ? OFFSET ?
  `).bind(...binds).all<Row>();
  return {rows:rows.results||[],filters,take,skip};
}

export async function talentSearchApi(request:Request,env:Env){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const result=await talentRows(request,env);
  return json({data:result.rows,meta:{model_version:GLOBAL_MODEL,filters:result.filters,limit:result.take,offset:result.skip,policy:'Missing public evidence remains unknown; MMA Scouts does not infer free-agent or unmanaged status.'}});
}

function statusLabel(row:Row){
  if(row.management_status==='unmanaged')return '<span class="talent-badge positive">Verified unmanaged</span>';
  if(row.management_status==='represented')return `<span class="talent-badge">Represented${row.agency_name?` · ${esc(row.agency_name)}`:row.manager_name?` · ${esc(row.manager_name)}`:''}</span>`;
  return '<span class="talent-badge muted">Management unknown</span>';
}
function contractLabel(value:unknown){
  if(value==='free_agent')return '<span class="talent-badge positive">Publicly verified free agent</span>';
  if(value==='non_exclusive')return '<span class="talent-badge">Non-exclusive status</span>';
  if(value==='under_contract')return '<span class="talent-badge">Under contract</span>';
  return '<span class="talent-badge muted">Contract unknown</span>';
}
function opportunityTags(row:Row){const tags=[];if(row.open_to_fights==='yes')tags.push('Open to fights');if(row.open_to_management==='yes')tags.push('Open to management');if(row.open_to_team==='yes')tags.push('Open to teams');return tags.map(v=>`<span class="talent-opportunity">${esc(v)}</span>`).join('');}
function age(dob:unknown){const raw=String(dob||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;const born=new Date(`${raw}T00:00:00Z`),today=new Date();let value=today.getUTCFullYear()-born.getUTCFullYear();if(today.getUTCMonth()<born.getUTCMonth()||(today.getUTCMonth()===born.getUTCMonth()&&today.getUTCDate()<born.getUTCDate()))value--;return value;}

export async function talentPage(request:Request,env:Env){
  const url=new URL(request.url);url.searchParams.set('limit','50');
  const {rows}=await talentRows(new Request(url,{method:'GET'}),env);
  const promotions=(await env.DB.prepare(`SELECT slug,name FROM scout_promotions WHERE active=1 ORDER BY name`).all<Row>()).results||[];
  const get=(key:string)=>new URL(request.url).searchParams.get(key)||'';
  const selected=(key:string,value:string)=>get(key)===value?' selected':'';
  const cards=rows.map(row=>`<article class="talent-card"><div class="talent-card-main"><div><span class="eyebrow">${esc(row.current_weight_class||'Unknown division')}${row.promotion_name?` · ${esc(row.promotion_name)}`:''}</span><h2><a href="/scout/fighters/${esc(row.profile_slug)}">${esc(row.fighter_name)}</a></h2><p>${esc(record(row))}${age(row.dob)!==null?` · Age ${age(row.dob)}`:''}${row.gym?` · ${esc(row.gym)}`:''}</p></div><div class="talent-rating"><small>GLOBAL RATING</small><strong>${score(row.global_rating)}</strong><span>Evidence ${percent(row.evidence_strength)}</span></div></div><div class="talent-statuses">${statusLabel(row)}${contractLabel(row.contract_status)}${opportunityTags(row)}</div>${row.agency_slug?`<p class="talent-management-link">Management: <a href="/management/${esc(row.agency_slug)}">${esc(row.agency_name)}</a></p>`:''}${row.base_country||row.base_city?`<p class="talent-location">Base: ${esc([row.base_city,row.base_region,row.base_country].filter(Boolean).join(', '))}</p>`:''}</article>`).join('');
  const body=`<section class="talent-hero"><span class="eyebrow">MMA TALENT NETWORK</span><h1>Find fighters worth calling.</h1><p>Search the global fight graph by performance, age, division, geography, representation and explicitly verified opportunity status. Unknown stays unknown.</p><div class="talent-hero-links"><a class="button secondary" href="/management">Management directory</a><a class="button secondary" href="/promotions">Promotion network</a></div></section>
  <section class="talent-search-panel"><form class="talent-form" method="get" action="/talent"><label>Name or gym<input name="q" value="${esc(get('q'))}" placeholder="Fighter or gym"></label><label>Division<input name="weight_class" value="${esc(get('weight_class'))}" placeholder="Lightweight"></label><label>Promotion<select name="promotion"><option value="">Any promotion</option>${promotions.map(p=>`<option value="${esc(p.slug)}"${selected('promotion',p.slug)}>${esc(p.name)}</option>`).join('')}</select></label><label>Region<select name="region"><option value="">Any region</option>${['United States','Europe','Asia'].map(v=>`<option${selected('region',v)}>${esc(v)}</option>`).join('')}</select></label><label>Max age<input name="age_max" type="number" min="14" max="60" value="${esc(get('age_max'))}" placeholder="25"></label><label>Min Global Rating<input name="min_rating" type="number" min="0" max="100" step="1" value="${esc(get('min_rating'))}" placeholder="70"></label><label>Management<select name="management"><option value="">Any status</option><option value="unmanaged"${selected('management','unmanaged')}>Verified unmanaged</option><option value="represented"${selected('management','represented')}>Represented</option><option value="unknown"${selected('management','unknown')}>Unknown</option></select></label><label>Contract<select name="contract"><option value="">Any status</option><option value="free_agent"${selected('contract','free_agent')}>Verified free agent</option><option value="non_exclusive"${selected('contract','non_exclusive')}>Non-exclusive</option><option value="under_contract"${selected('contract','under_contract')}>Under contract</option><option value="unknown"${selected('contract','unknown')}>Unknown</option></select></label><label>Opportunity<select name="opportunity"><option value="">Any</option><option value="fights"${selected('opportunity','fights')}>Open to fights</option><option value="management"${selected('opportunity','management')}>Open to management</option><option value="team"${selected('opportunity','team')}>Open to teams</option></select></label><button class="button primary" type="submit">Search talent</button></form><p class="talent-policy"><strong>Verification rule:</strong> absence of a management or contract record never means unmanaged or free agent. Those labels only appear when a public source or verified profile explicitly supports them.</p></section>
  <section class="talent-results"><div class="talent-section-head"><span class="eyebrow">SEARCH RESULTS</span><h2>${rows.length} fighters shown</h2></div>${cards||'<div class="talent-empty">No fighters match those verified filters yet. Try removing an opportunity-status filter.</div>'}</section>`;
  return new Response(shell('MMA Talent Search for Promotions, Managers & Teams | MMA Scouts','Search MMA fighters by Global Rating, age, division, promotion, representation and verified availability on MMA Scouts.','/talent',body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=30, s-maxage=120'}});
}

function average(values:number[]){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;}
function rosterMix(rows:Row[],key:string,labelKey?:string){
  const map=new Map<string,{key:string;name:string;count:number}>();
  for(const row of rows){const value=String(row[key]||'').trim();if(!value)continue;const name=String(labelKey?row[labelKey]:value||value).trim()||value;const current=map.get(value)||{key:value,name,count:0};current.count++;map.set(value,current);}
  return [...map.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
}
function agencyRosterSummary(rows:Row[]){
  const now=Date.now(),year=365.2425*86400000;
  const ratings=rows.map(row=>Number(row.global_rating)).filter(Number.isFinite);
  const evidence=rows.map(row=>Number(row.evidence_strength)).filter(Number.isFinite);
  const active=rows.filter(row=>{const time=Date.parse(String(row.last_fight_date||''));return Number.isFinite(time)&&now-time<=year;}).length;
  const under26=rows.filter(row=>{const value=age(row.dob);return value!==null&&value<26;}).length;
  const managers=[...new Set(rows.map(row=>String(row.manager_name||'').trim()).filter(Boolean))].sort();
  const verified=rows.map(row=>String(row.verified_at||'')).filter(Boolean).sort().at(-1)||null;
  return {count:rows.length,active_last_12_months:active,under_26:under26,average_global_rating:average(ratings),top_global_rating:ratings.length?Math.max(...ratings):null,average_evidence:average(evidence),promotions:rosterMix(rows,'current_promotion_slug','promotion_name'),divisions:rosterMix(rows,'current_weight_class'),managers,latest_verified_at:verified};
}

async function agencyRows(env:Env){
  return (await env.DB.prepare(`
    SELECT a.id,a.slug,a.name,a.country,a.website_url,a.description,a.verified_at,
           COUNT(p.source_fighter_id) represented_fighters,
           SUM(CASE WHEN p.last_fight_date>=date('now','-365 day') THEN 1 ELSE 0 END) active_last_12_months,
           COUNT(DISTINCT NULLIF(p.current_promotion_slug,'')) promotion_count,
           COUNT(DISTINCT NULLIF(p.current_weight_class,'')) division_count,
           ROUND(AVG(r.scout_rating),2) average_global_rating,ROUND(MAX(r.scout_rating),2) top_global_rating,
           ROUND(AVG(r.evidence_strength),2) average_evidence
    FROM management_agencies a
    LEFT JOIN scout_current_management cm ON cm.agency_id=a.id
    LEFT JOIN scout_public_global_profiles p ON p.source_key=cm.source_key AND p.source_fighter_id=cm.source_fighter_id
    LEFT JOIN scout_active_global_ratings r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    WHERE a.active=1
    GROUP BY a.id,a.slug,a.name,a.country,a.website_url,a.description,a.verified_at
    ORDER BY represented_fighters DESC,a.name
  `).bind(GLOBAL_MODEL).all<Row>()).results||[];
}

export async function managementAgenciesApi(request:Request,env:Env){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const rows=await agencyRows(env);return json({data:rows,meta:{count:rows.length,policy:'Verified fighter counts reflect source-backed relationships in MMA Scouts, not an estimate of an agency’s complete client roster.'}});
}

export async function managementAgencyApi(request:Request,env:Env,slug:string){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const agency=await env.DB.prepare(`SELECT * FROM management_agencies WHERE slug=? AND active=1 LIMIT 1`).bind(slug).first<Row>();
  if(!agency)return json({error:'agency_not_found'},404);
  const roster=(await env.DB.prepare(`
    SELECT p.profile_slug,p.fighter_name,p.dob,p.nationality,p.gym,p.current_weight_class,p.current_promotion_slug,p.career_wins,p.career_losses,p.career_draws,p.last_fight_date,
           sp.name promotion_name,r.scout_rating global_rating,r.evidence_strength,cm.manager_name,cm.started_at,cm.confidence,cm.verified_at,cm.source_url management_source_url
    FROM scout_current_management cm
    JOIN scout_public_global_profiles p ON p.source_key=cm.source_key AND p.source_fighter_id=cm.source_fighter_id
    LEFT JOIN scout_promotions sp ON sp.slug=p.current_promotion_slug
    LEFT JOIN scout_active_global_ratings r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    WHERE cm.agency_id=?
    ORDER BY r.scout_rating IS NULL,r.scout_rating DESC,p.fighter_name
  `).bind(GLOBAL_MODEL,agency.id).all<Row>()).results||[];
  return json({agency,data:roster,meta:{...agencyRosterSummary(roster),model_version:GLOBAL_MODEL,policy:'A verified roster is only the set of current relationships supported by MMA Scouts sources; it may be incomplete.'}});
}

export async function managementAgenciesPage(_request:Request,env:Env){
  const rows=await agencyRows(env);
  const cards=rows.map(row=>{
    const count=Number(row.represented_fighters||0);
    const rosterStat=count?`<span><strong>${count}</strong> verified fighters</span><span><strong>${Number(row.active_last_12_months||0)}</strong> active / 12 mo</span>`:`<span><strong>Profile verified</strong> roster not publicly ingested</span>`;
    return `<a class="agency-card" href="/management/${esc(row.slug)}"><span class="eyebrow">${esc(row.country||'GLOBAL')}</span><h2>${esc(row.name)}</h2><div>${rosterStat}${count?`<span><strong>${score(row.average_global_rating)}</strong> avg rating</span><span><strong>${score(row.top_global_rating)}</strong> top rating</span>`:''}</div><p>${esc(row.description||'')}</p><small>Profile checked ${esc(pretty(row.verified_at))}</small></a>`;
  }).join('');
  const body=`<section class="talent-hero"><span class="eyebrow">REPRESENTATION INTELLIGENCE</span><h1>MMA management directory.</h1><p>Research verified agency profiles, source-backed fighter relationships, roster strength, activity and organizational footprint. Agency affiliation is context only and never increases a fighter's rating.</p><a class="button primary" href="/talent?management=unmanaged">Find verified unmanaged talent</a></section><section class="agency-grid">${cards||'<div class="talent-empty"><strong>No management agencies are published yet.</strong><p>Agency profiles appear only after an official source is verified.</p></div>'}</section><p class="talent-policy"><strong>Roster rule:</strong> a displayed fighter count is the number of source-backed relationships MMA Scouts can currently verify. It is not a claim that the agency has no other clients.</p>`;
  return new Response(shell('MMA Management Agencies, Rosters & Representation Intelligence | MMA Scouts','Research MMA management agencies, verified fighter rosters, roster strength, activity and representation intelligence on MMA Scouts.','/management',body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'}});
}

export async function managementAgencyPage(request:Request,env:Env,slug:string){
  const response=await managementAgencyApi(new Request(request.url,{method:'GET'}),env,slug);
  if(!response.ok)return new Response('Not found',{status:404});
  const payload:any=await response.json(),agency:Row=payload.agency,rows:Row[]=payload.data||[],meta:Row=payload.meta||{};
  const roster=rows.map(row=>`<a class="agency-fighter" href="/scout/fighters/${esc(row.profile_slug)}"><span><strong>${esc(row.fighter_name)}</strong><small>${esc(row.current_weight_class||'Unknown')} · ${esc(record(row))}${age(row.dob)!==null?` · Age ${age(row.dob)}`:''}${row.promotion_name?` · ${esc(row.promotion_name)}`:''}</small></span><span><small>Global Rating</small><b>${score(row.global_rating)}</b><em>Evidence ${percent(row.evidence_strength)}</em></span></a>`).join('');
  const stats=rows.length?`<section class="agency-grid"><div class="agency-card"><span class="eyebrow">VERIFIED ROSTER</span><h2>${rows.length}</h2><p>Source-backed current fighter relationships.</p></div><div class="agency-card"><span class="eyebrow">ACTIVE / 12 MONTHS</span><h2>${Number(meta.active_last_12_months||0)}</h2><p>Verified roster fighters with a recorded bout in the last year.</p></div><div class="agency-card"><span class="eyebrow">AVERAGE RATING</span><h2>${score(meta.average_global_rating)}</h2><p>Average Global Rating across rated roster fighters.</p></div><div class="agency-card"><span class="eyebrow">TOP RATING</span><h2>${score(meta.top_global_rating)}</h2><p>Highest current Global Rating on the verified roster.</p></div><div class="agency-card"><span class="eyebrow">AVERAGE EVIDENCE</span><h2>${percent(meta.average_evidence)}</h2><p>Average evidence strength behind the current ratings.</p></div><div class="agency-card"><span class="eyebrow">UNDER 26</span><h2>${Number(meta.under_26||0)}</h2><p>Younger fighters on the verified roster; not a prospect ranking.</p></div></section>`:'';
  const promotions=(meta.promotions||[]).map((item:Row)=>`<span class="talent-badge">${esc(item.name||item.key)} · ${Number(item.count||0)}</span>`).join('');
  const divisions=(meta.divisions||[]).map((item:Row)=>`<span class="talent-badge">${esc(item.name||item.key)} · ${Number(item.count||0)}</span>`).join('');
  const managers=(meta.managers||[]).map((name:string)=>`<span class="talent-badge">${esc(name)}</span>`).join('');
  const footprint=rows.length?`<section class="talent-results"><div class="talent-section-head"><span class="eyebrow">ROSTER FOOTPRINT</span><h2>Where the verified roster competes</h2></div>${promotions?`<h3>Promotions</h3><div class="talent-statuses">${promotions}</div>`:''}${divisions?`<h3>Divisions</h3><div class="talent-statuses">${divisions}</div>`:''}${managers?`<h3>Named managers</h3><div class="talent-statuses">${managers}</div>`:''}</section>`:'';
  const empty=`<div class="talent-empty"><strong>Agency profile verified; complete roster not publicly ingested.</strong><p>MMA Scouts does not interpret an empty verified roster as zero clients. Fighter relationships will appear only when an official roster or another sufficiently strong public source supports them.</p></div>`;
  const body=`<section class="talent-hero"><a class="directory-back" href="/management">← Management directory</a><span class="eyebrow">REPRESENTATION INTELLIGENCE</span><h1>${esc(agency.name)}</h1><p>${esc(agency.country||'')}${agency.website_url?` · <a href="${esc(agency.website_url)}" rel="nofollow noopener">Official site ↗</a>`:''}${agency.verified_at?` · Profile checked ${esc(pretty(agency.verified_at))}`:''}</p><p>${esc(agency.description||'')}</p></section>${stats}${footprint}<section class="talent-results"><div class="talent-section-head"><span class="eyebrow">SOURCE-BACKED ROSTER</span><h2>${rows.length?`${rows.length} verified fighter${rows.length===1?'':'s'}`:'No complete verified roster yet'}</h2></div>${roster||empty}</section><p class="talent-policy"><strong>Verification rule:</strong> roster membership is published only when a source supports the relationship. Missing public evidence never means a fighter is unmanaged, and a missing fighter never automatically ends historical representation.</p>`;
  return new Response(shell(`${agency.name} MMA Management Intelligence | MMA Scouts`,`Source-backed ${agency.name} agency profile, verified MMA roster, Global Ratings, activity and promotion/division footprint on MMA Scouts.`,`/management/${slug}`,body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'}});
}

async function fighterTalent(env:Env,slug:string){
  return env.DB.prepare(`
    SELECT p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,
           ${managementExpression()} management_status,cm.agency_slug,cm.agency_name,cm.agency_website,cm.manager_name,cm.source_url management_source_url,cm.source_type management_source_type,cm.confidence management_confidence,cm.verified_at management_verified_at,
           COALESCE(o.contract_status,'unknown') contract_status,COALESCE(o.open_to_fights,'unknown') open_to_fights,
           COALESCE(o.open_to_management,'unknown') open_to_management,COALESCE(o.open_to_team,'unknown') open_to_team,
           o.preferred_weight_class,o.base_city,o.base_region,o.base_country,o.public_contact_url,o.availability_note,o.source_url opportunity_source_url,o.source_type opportunity_source_type,o.confidence opportunity_confidence,o.verified_at opportunity_verified_at
    FROM scout_public_global_profiles p
    LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
    WHERE p.profile_slug=? LIMIT 1
  `).bind(slug).first<Row>();
}

export async function fighterTalentApi(request:Request,env:Env,slug:string){if(request.method!=='GET')return json({error:'method_not_allowed'},405);const row=await fighterTalent(env,slug);return row?json({data:row,policy:'Unknown is not unmanaged or free agent.'}):json({error:'fighter_not_found'},404);}

export async function enhanceFighterTalentContext(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const row=await fighterTalent(env,slug);if(!row)return response;
  const management=row.management_status==='represented'?(row.agency_name?`<a href="/management/${esc(row.agency_slug)}">${esc(row.agency_name)}</a>`:esc(row.manager_name||'Represented')):row.management_status==='unmanaged'?'Verified unmanaged':'Unknown';
  const contract=row.contract_status==='free_agent'?'Publicly verified free agent':row.contract_status==='non_exclusive'?'Non-exclusive':row.contract_status==='under_contract'?'Under contract':'Unknown';
  const open=[row.open_to_fights==='yes'?'Fights':null,row.open_to_management==='yes'?'Management':null,row.open_to_team==='yes'?'Teams':null].filter(Boolean);
  const verified=row.opportunity_verified_at||row.management_verified_at;
  const source=row.opportunity_source_url||row.management_source_url;
  const section=`<section class="dossier-grid talent-dossier"><div class="dossier-panel"><span class="eyebrow">CAREER & REPRESENTATION</span><h2>Opportunity file</h2><div class="dossier-facts"><div><small>Management</small><strong>${management}</strong></div><div><small>Contract</small><strong>${esc(contract)}</strong></div><div><small>Open to</small><strong>${open.length?esc(open.join(' · ')):'Not publicly verified'}</strong></div>${row.base_country||row.base_city?`<div><small>Base</small><strong>${esc([row.base_city,row.base_region,row.base_country].filter(Boolean).join(', '))}</strong></div>`:''}</div>${row.availability_note?`<p class="dossier-note">${esc(row.availability_note)}</p>`:''}${row.public_contact_url?`<p><a class="button secondary" href="${esc(row.public_contact_url)}" rel="nofollow noopener">Public contact channel ↗</a></p>`:''}</div><div class="dossier-panel"><span class="eyebrow">VERIFICATION</span><h2>What we actually know</h2><p class="dossier-note">Missing public evidence stays unknown. MMA Scouts never labels a fighter unmanaged or a free agent just because no contract or agency record was found.</p><div class="dossier-facts">${verified?`<div><small>Last verified</small><strong>${esc(pretty(verified))}</strong></div>`:''}${row.management_confidence||row.opportunity_confidence?`<div><small>Evidence grade</small><strong>${esc(row.opportunity_confidence||row.management_confidence)}</strong></div>`:''}</div>${source?`<p><a href="${esc(source)}" rel="nofollow noopener">Verification source ↗</a></p>`:''}</div></section>`;
  return new HTMLRewriter().on('.dossier-component-grid',{element(el){el.after(section,{html:true});}}).transform(response);
}

async function requireAdmin(request:Request,env:Env){return !!await adminAccount(request,env.DB);}
async function body(request:Request){try{return await request.json() as Row}catch{return null;}}
function validUrl(value:unknown){if(!value)return null;try{const url=new URL(String(value));return /^https?:$/.test(url.protocol)?url.href:null}catch{return null;}}
function validPublicContact(value:unknown){if(!value)return null;try{const url=new URL(String(value));return url.protocol==='https:'?url.href:null}catch{return null;}}

export async function talentAdminApi(request:Request,env:Env,action:string){
  if(!await requireAdmin(request,env))return json({error:'unauthorized'},401,NO_STORE);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405,NO_STORE);
  const input=await body(request);if(!input)return json({error:'invalid_json'},400,NO_STORE);
  if(action==='agency'){
    const name=String(input.name||'').trim().slice(0,160),slug=slugify(String(input.slug||name));if(!name||!slug)return json({error:'name_required'},400,NO_STORE);
    const website=validUrl(input.website_url);
    await env.DB.prepare(`INSERT INTO management_agencies(slug,name,country,website_url,description,active,verified_at,updated_at) VALUES(?,?,?,?,?,1,COALESCE(?,CURRENT_TIMESTAMP),CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,country=excluded.country,website_url=excluded.website_url,description=excluded.description,active=1,verified_at=COALESCE(excluded.verified_at,management_agencies.verified_at),updated_at=CURRENT_TIMESTAMP`).bind(slug,name,String(input.country||'').trim()||null,website,String(input.description||'').trim().slice(0,2000)||null,String(input.verified_at||'').trim()||null).run();
    return json({ok:true,slug},200,NO_STORE);
  }
  const profile=String(input.profile_slug||'').trim();
  const fighter=profile?await env.DB.prepare(`SELECT source_key,source_fighter_id,profile_slug,fighter_name FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;
  if(!fighter)return json({error:'fighter_not_found'},404,NO_STORE);
  if(action==='management'){
    const agencySlug=String(input.agency_slug||'').trim(),managerName=String(input.manager_name||'').trim().slice(0,160)||null;
    const agency=agencySlug?await env.DB.prepare(`SELECT id FROM management_agencies WHERE slug=? AND active=1 LIMIT 1`).bind(agencySlug).first<{id:number}>():null;
    if(!agency&&!managerName)return json({error:'agency_or_manager_required'},400,NO_STORE);
    const confidence=CONFIDENCE.has(String(input.confidence))?String(input.confidence):'C';
    const statements=[
      env.DB.prepare(`UPDATE fighter_management_history SET is_current=0,ended_at=COALESCE(ended_at,date('now')),last_checked_at=CURRENT_TIMESTAMP WHERE source_key=? AND source_fighter_id=? AND is_current=1`).bind(fighter.source_key,fighter.source_fighter_id),
      env.DB.prepare(`INSERT INTO fighter_management_history(source_key,source_fighter_id,agency_id,manager_name,started_at,is_current,source_url,source_type,confidence,verified_at,last_checked_at,notes) VALUES(?,?,?,?,?,1,?,?,?,?,CURRENT_TIMESTAMP,?)`).bind(fighter.source_key,fighter.source_fighter_id,agency?.id??null,managerName,String(input.started_at||'').trim()||null,validUrl(input.source_url),String(input.source_type||'public_record').trim().slice(0,80),confidence,String(input.verified_at||'').trim()||new Date().toISOString(),String(input.notes||'').trim().slice(0,2000)||null),
      env.DB.prepare(`INSERT INTO fighter_opportunity_status(source_key,source_fighter_id,management_status,source_url,source_type,confidence,verified_at,last_checked_at) VALUES(?,?,'represented',?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET management_status='represented',source_url=COALESCE(excluded.source_url,fighter_opportunity_status.source_url),source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP`).bind(fighter.source_key,fighter.source_fighter_id,validUrl(input.source_url),String(input.source_type||'public_record').trim().slice(0,80),confidence,String(input.verified_at||'').trim()||new Date().toISOString())
    ];
    await env.DB.batch(statements);return json({ok:true,profile_slug:profile,management_status:'represented'},200,NO_STORE);
  }
  if(action==='opportunity'){
    const management=MANAGEMENT.has(String(input.management_status))?String(input.management_status):'unknown';
    const contract=CONTRACT.has(String(input.contract_status))?String(input.contract_status):'unknown';
    const fights=YESNO.has(String(input.open_to_fights))?String(input.open_to_fights):'unknown';
    const mgmt=YESNO.has(String(input.open_to_management))?String(input.open_to_management):'unknown';
    const team=YESNO.has(String(input.open_to_team))?String(input.open_to_team):'unknown';
    const confidence=CONFIDENCE.has(String(input.confidence))?String(input.confidence):'C';
    if(management==='unmanaged'&&!validUrl(input.source_url)&&String(input.source_type||'')!=='verified_profile')return json({error:'unmanaged_requires_source'},400,NO_STORE);
    if(contract==='free_agent'&&!validUrl(input.source_url)&&String(input.source_type||'')!=='verified_profile')return json({error:'free_agent_requires_source'},400,NO_STORE);
    const publicContact=validPublicContact(input.public_contact_url);if(input.public_contact_url&&!publicContact)return json({error:'public_contact_requires_https_url'},400,NO_STORE);
    await env.DB.prepare(`INSERT INTO fighter_opportunity_status(source_key,source_fighter_id,management_status,contract_status,open_to_fights,open_to_management,open_to_team,preferred_weight_class,base_city,base_region,base_country,public_contact_url,availability_note,source_url,source_type,confidence,verified_at,last_checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET management_status=excluded.management_status,contract_status=excluded.contract_status,open_to_fights=excluded.open_to_fights,open_to_management=excluded.open_to_management,open_to_team=excluded.open_to_team,preferred_weight_class=excluded.preferred_weight_class,base_city=excluded.base_city,base_region=excluded.base_region,base_country=excluded.base_country,public_contact_url=excluded.public_contact_url,availability_note=excluded.availability_note,source_url=excluded.source_url,source_type=excluded.source_type,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP`).bind(fighter.source_key,fighter.source_fighter_id,management,contract,fights,mgmt,team,String(input.preferred_weight_class||'').trim().slice(0,80)||null,String(input.base_city||'').trim().slice(0,120)||null,String(input.base_region||'').trim().slice(0,120)||null,String(input.base_country||'').trim().slice(0,120)||null,publicContact,String(input.availability_note||'').trim().slice(0,1000)||null,validUrl(input.source_url),String(input.source_type||'public_record').trim().slice(0,80),confidence,String(input.verified_at||'').trim()||new Date().toISOString()).run();
    return json({ok:true,profile_slug:profile,management_status:management,contract_status:contract},200,NO_STORE);
  }
  return json({error:'unknown_action'},404,NO_STORE);
}
