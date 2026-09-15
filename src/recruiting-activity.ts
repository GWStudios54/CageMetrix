import {adminAccount} from './admin-session.ts';
import {BRAND_NAME} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '—';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(raw+'T12:00:00Z'));};
const label=(value:unknown)=>String(value||'unknown').replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase());

const KIND=new Set(['all','availability','contract','representation','camp']);
const AVAILABILITY_EVENTS=new Set(['free_agency','release','expiration']);

function contractDescription(row:Row){
  const promo=row.promotion_name||row.promotion_slug;
  switch(row.event_type){
    case 'signing':return promo?`Signed with ${promo}`:'Signing reported';
    case 'extension':return promo?`Extended contract with ${promo}`:'Contract extension reported';
    case 'renewal':return promo?`Renewed contract with ${promo}`:'Contract renewal reported';
    case 'renegotiation':return promo?`Renegotiated contract with ${promo}`:'Contract renegotiation reported';
    case 'bout_agreement':return promo?`New bout agreement with ${promo}`:'Bout agreement reported';
    case 'option_exercised':return promo?`${promo} exercised contract option`:'Contract option exercised';
    case 'option_declined':return promo?`${promo} declined contract option`:'Contract option declined';
    case 'release':return promo?`Released by ${promo}`:'Release reported';
    case 'expiration':return promo?`Contract with ${promo} expired`:'Contract expiration reported';
    case 'free_agency':return 'Became a free agent';
    default:return label(row.event_type);
  }
}

async function activityRows(env:Env,kind:string,limit=75){
  const [contracts,representation,camps]=await Promise.all([
    kind==='representation'||kind==='camp'?Promise.resolve({results:[]}):env.DB.prepare(`
      SELECT e.id,e.event_type,e.status_after,e.promotion_name,e.promotion_slug,e.public_summary,
             COALESCE(e.effective_at,e.reported_at,e.signed_at,e.created_at) event_date,
             p.profile_slug,p.fighter_name,p.current_weight_class
      FROM fighter_contract_events e
      JOIN scout_public_global_profiles p ON p.source_key=e.source_key AND p.source_fighter_id=e.source_fighter_id
      ${kind==='availability'?`WHERE e.event_type IN ('free_agency','release','expiration')`:''}
      ORDER BY event_date DESC,e.id DESC LIMIT ?
    `).bind(limit).all<Row>(),
    kind==='availability'||kind==='contract'||kind==='camp'?Promise.resolve({results:[]}):env.DB.prepare(`
      SELECT h.id,h.manager_name,h.started_at,h.ended_at,h.is_current,h.verified_at,
             CASE WHEN h.is_current=1 THEN COALESCE(h.started_at,h.verified_at) ELSE COALESCE(h.ended_at,h.verified_at) END event_date,
             a.slug agency_slug,a.name agency_name,
             p.profile_slug,p.fighter_name,p.current_weight_class
      FROM fighter_management_history h
      LEFT JOIN management_agencies a ON a.id=h.agency_id
      JOIN scout_public_global_profiles p ON p.source_key=h.source_key AND p.source_fighter_id=h.source_fighter_id
      ORDER BY event_date DESC,h.id DESC LIMIT ?
    `).bind(limit).all<Row>(),
    kind==='availability'||kind==='contract'||kind==='representation'?Promise.resolve({results:[]}):env.DB.prepare(`
      SELECT h.id,h.camp_name,h.coach_name,h.started_at,h.ended_at,h.is_current,h.verified_at,
             CASE WHEN h.is_current=1 THEN COALESCE(h.started_at,h.verified_at) ELSE COALESCE(h.ended_at,h.verified_at) END event_date,
             t.slug camp_slug,t.name camp_name_resolved,
             p.profile_slug,p.fighter_name,p.current_weight_class
      FROM fighter_camp_history h
      LEFT JOIN training_camps t ON t.id=h.camp_id
      JOIN scout_public_global_profiles p ON p.source_key=h.source_key AND p.source_fighter_id=h.source_fighter_id
      ORDER BY event_date DESC,h.id DESC LIMIT ?
    `).bind(limit).all<Row>()
  ]);
  const rows:Row[]=[
    ...(contracts.results||[]).map(row=>({...row,kind:'contract'})),
    ...(representation.results||[]).map(row=>({...row,kind:'representation'})),
    ...(camps.results||[]).map(row=>({...row,kind:'camp'}))
  ];
  rows.sort((a,b)=>String(b.event_date||'').localeCompare(String(a.event_date||'')));
  return rows.slice(0,limit);
}

function activityRow(row:Row,isAdmin:boolean){
  const watchBtn=isAdmin?`<button class="button secondary" type="button" data-watch="${esc(row.profile_slug)}">☆ Watch</button>`:'';
  if(row.kind==='contract'){
    const availability=AVAILABILITY_EVENTS.has(row.event_type);
    return `<article class="activity-row${availability?' availability':''}"><div class="activity-date">${esc(pretty(row.event_date))}</div><div class="activity-body"><span class="eyebrow">${esc(row.current_weight_class||'Unknown division')}</span><h3><a href="/scout/fighters/${esc(row.profile_slug)}">${esc(row.fighter_name)}</a></h3><p>${esc(contractDescription(row))}</p>${row.public_summary?`<p class="activity-summary">${esc(row.public_summary)}</p>`:''}</div><div class="activity-meta"><span class="talent-badge${availability?' positive':''}">${esc(label(row.status_after))}</span>${watchBtn}<a class="button secondary" href="/scout/fighters/${esc(row.profile_slug)}">Fighter file →</a></div></article>`;
  }
  if(row.kind==='camp'){
    const campName=row.camp_name_resolved||row.camp_name||'Training camp';
    const desc=row.is_current?`Joined ${campName}`:`Left ${campName}`;
    return `<article class="activity-row"><div class="activity-date">${esc(pretty(row.event_date))}</div><div class="activity-body"><span class="eyebrow">${esc(row.current_weight_class||'Unknown division')}</span><h3><a href="/scout/fighters/${esc(row.profile_slug)}">${esc(row.fighter_name)}</a></h3><p>${esc(desc)}${row.coach_name?` · Coach ${esc(row.coach_name)}`:''}</p></div><div class="activity-meta"><span class="talent-badge${row.is_current?' positive':''}">${row.is_current?'Current':'Ended'}</span>${watchBtn}<a class="button secondary" href="/scout/fighters/${esc(row.profile_slug)}">Fighter file →</a></div></article>`;
  }
  const who=row.agency_name||row.manager_name||'Representation';
  const desc=row.is_current?`New representation: ${who}`:`Representation ended: ${who}`;
  return `<article class="activity-row"><div class="activity-date">${esc(pretty(row.event_date))}</div><div class="activity-body"><span class="eyebrow">${esc(row.current_weight_class||'Unknown division')}</span><h3><a href="/scout/fighters/${esc(row.profile_slug)}">${esc(row.fighter_name)}</a></h3><p>${row.agency_slug?`<a href="/management/${esc(row.agency_slug)}">${esc(desc)}</a>`:esc(desc)}</p></div><div class="activity-meta"><span class="talent-badge${row.is_current?' positive':''}">${row.is_current?'Current':'Ended'}</span>${watchBtn}<a class="button secondary" href="/scout/fighters/${esc(row.profile_slug)}">Fighter file →</a></div></article>`;
}

function shell(bodyHtml:string,script=''){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Recruiting Market Activity | ${BRAND_NAME}</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/recruiting.css?v=1"></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="recruit-main">${bodyHtml}</main><footer><span>${BRAND_NAME}</span><span>Private recruiting workspace.</span></footer>${script}</body></html>`;
}
function authPage(){
  return new Response(shell('<section class="recruit-hero"><span class="eyebrow">PRIVATE WORKSPACE</span><h1>Recruiting access required.</h1><p>This surface is restricted to authorized MMA Scouts recruiting users.</p><a class="button primary" href="/admin">Admin sign in →</a></section>'),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}

export async function recruitingActivityPage(request:Request,env:Env){
  const who=await adminAccount(request,env.DB);if(!who)return authPage();
  const url=new URL(request.url);
  const kind=KIND.has(String(url.searchParams.get('kind')||'all'))?String(url.searchParams.get('kind')||'all'):'all';
  const rows=await activityRows(env,kind);
  const rowsHtml=rows.map(row=>activityRow(row,true)).join('');
  const bodyHtml=`<section class="recruit-hero opening-hero"><a class="back-link" href="/recruiting">← Recruiting board</a><span class="eyebrow">MARKET ACTIVITY</span><h1>Who just became available.</h1><p>A chronological feed of publicly reported contract, representation and training-camp changes across every fighter MMA Scouts tracks -- new free agents, releases, expirations, signings, agency changes and camp moves -- so you don't have to already know a name to spot an opportunity.</p></section>
  <section class="intel-filter-panel"><form method="get" action="/recruiting/activity"><label>Show<select name="kind">${['all','availability','contract','representation','camp'].map(v=>`<option value="${v}"${kind===v?' selected':''}>${v==='all'?'Everything':v==='availability'?'Free agency, release & expiration':v==='contract'?'All contract events':v==='representation'?'Representation changes':'Camp/team changes'}</option>`).join('')}</select></label><button class="button primary" type="submit">Filter feed</button></form></section>
  <section class="candidate-section"><div class="section-heading"><div><span class="eyebrow">RECENT ACTIVITY</span><h2>${rows.length} event${rows.length===1?'':'s'}</h2></div><p class="queue-note">Most recent first · publicly reported evidence only · does not include unverified discovery candidates.</p></div><div class="activity-feed">${rowsHtml||'<div class="recruit-empty">No publicly reported contract or representation events match this filter yet.</div>'}</div></section>`;
  const script=`<script>(()=>{document.querySelectorAll('[data-watch]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await fetch('/api/admin/recruiting/watchlist',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({profile_slug:btn.dataset.watch})}),j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');btn.textContent='✓ Watching';}catch(err){btn.textContent='Retry';btn.disabled=false;}}));})();</script>`;
  return new Response(shell(bodyHtml,script),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}
