import {adminAccount,sameOrigin} from './admin-session.ts';
import {BRAND_NAME} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;

const GLOBAL_MODEL='global-1.0.0';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'};
const STATUS=new Set(['watching','contacted','passed','signed']);

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const text=(value:unknown,max=2000)=>{const out=String(value??'').trim();return out?out.slice(0,max):null;};
const int=(value:unknown,min:number,max:number)=>{if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):null;};
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '—';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(raw+'T12:00:00Z'));};
const score=(value:unknown)=>Number.isFinite(Number(value))?Number(value).toFixed(1):'—';
const pct=(value:unknown)=>Number.isFinite(Number(value))?Math.round(Number(value))+'%':'—';
const age=(dob:unknown)=>{const raw=String(dob||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;const born=new Date(raw+'T00:00:00Z'),today=new Date();let n=today.getUTCFullYear()-born.getUTCFullYear();if(today.getUTCMonth()<born.getUTCMonth()||(today.getUTCMonth()===born.getUTCMonth()&&today.getUTCDate()<born.getUTCDate()))n--;return n;};
const record=(r:Row)=>`${Number(r.career_wins||0)}-${Number(r.career_losses||0)}${Number(r.career_draws||0)?'-'+Number(r.career_draws):''}`;

async function body(request:Request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))return null;
  const raw=await request.text();if(new TextEncoder().encode(raw).length>4000)return null;
  try{return JSON.parse(raw) as Row}catch{return null;}
}
async function admin(request:Request,env:Env){return adminAccount(request,env.DB);}
function guardMutation(request:Request){return sameOrigin(request);}

function managementExpr(){return `CASE WHEN cm.source_fighter_id IS NOT NULL THEN 'represented' ELSE COALESCE(o.management_status,'unknown') END`;}
function availabilityExpr(){return `CASE WHEN COALESCE(o.open_to_fights,'unknown')<>'unknown' THEN o.open_to_fights ELSE COALESCE(ca.open_to_fights,'unknown') END`;}
function baseCityExpr(){return `CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_city ELSE cl.base_city END`;}
function baseRegionExpr(){return `CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_region ELSE cl.base_region END`;}
function baseCountryExpr(){return `CASE WHEN COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL THEN o.base_country ELSE cl.base_country END`;}
function agencyContactHref(row:Row){
  const value=String(row.agency_contact_value||'').trim();if(!value)return null;
  if(row.agency_contact_kind==='booking_email'||row.agency_contact_kind==='general_email')return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)?'mailto:'+value:null;
  try{const url=new URL(value);return url.protocol==='https:'?url.href:null}catch{return null;}
}
function agencyContactLabel(kind:unknown){
  if(kind==='booking_email')return 'Agency booking email';
  if(kind==='general_email')return 'Agency email';
  if(kind==='booking_form')return 'Agency booking form';
  if(kind==='contact_form')return 'Agency contact form';
  return 'Agency contact';
}
function fightProfileFacts(row:Row){
  const facts:string[]=[];
  const wins=Number(row.career_wins||0),ko=Number(row.ko_tko_wins||0),sub=Number(row.submission_wins||0);
  if(wins>0){const finishPct=Math.round(((ko+sub)/wins)*100);facts.push(`${finishPct}% finish rate (${ko} KO/TKO · ${sub} SUB)`);}
  const titleBouts=Number(row.title_fight_bouts||0);
  if(titleBouts>0)facts.push(`Title fights: ${Number(row.title_fight_wins||0)}-${titleBouts-Number(row.title_fight_wins||0)}`);
  const l5w=Number(row.last_five_wins||0),l5l=Number(row.last_five_losses||0);
  if(l5w+l5l>0)facts.push(`Last 5: ${l5w}-${l5l}`);
  return facts.map(v=>`<span>${esc(v)}</span>`).join('');
}

async function fighterFromProfile(db:D1Database,profile:string){
  return profile?db.prepare(`SELECT source_key,source_fighter_id FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profile).first<Row>():null;
}
async function currentStatus(db:D1Database,sourceKey:string,sourceFighterId:string){
  return db.prepare(`
    SELECT ${managementExpr()} management_status,COALESCE(o.contract_status,'unknown') contract_status,${availabilityExpr()} open_to_fights
    FROM scout_public_global_profiles p
    LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_availability ca ON ca.source_key=p.source_key AND ca.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
    WHERE p.source_key=? AND p.source_fighter_id=? LIMIT 1
  `).bind(sourceKey,sourceFighterId).first<Row>();
}
async function ownedEntry(env:Env,ownerId:number,id:number){
  return env.DB.prepare('SELECT * FROM recruiting_watchlist WHERE id=? AND owner_account_id=? LIMIT 1').bind(id,ownerId).first<Row>();
}

async function watchlistRows(env:Env,ownerId:number){
  const rows=(await env.DB.prepare(`
    SELECT w.*,p.fighter_name,p.dob,p.nationality,p.gym,p.current_weight_class,p.current_promotion_slug,
           p.last_fight_date,p.career_wins,p.career_losses,p.career_draws,
           p.ko_tko_wins,p.submission_wins,p.title_fight_bouts,p.title_fight_wins,p.last_five_wins,p.last_five_losses,
           r.scout_rating global_rating,r.evidence_strength,
           sp.name promotion_name,
           ${managementExpr()} management_status,cm.agency_slug,cm.agency_name,cm.agency_website,cm.agency_contact_kind,cm.agency_contact_value,cm.manager_name,
           COALESCE(o.contract_status,'unknown') contract_status,${availabilityExpr()} open_to_fights,
           ${baseCityExpr()} base_city,${baseRegionExpr()} base_region,${baseCountryExpr()} base_country,o.public_contact_url
    FROM recruiting_watchlist w
    JOIN scout_public_global_profiles p ON p.source_key=w.source_key AND p.source_fighter_id=w.source_fighter_id
    LEFT JOIN scout_active_global_ratings r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    LEFT JOIN scout_promotions sp ON sp.slug=p.current_promotion_slug
    LEFT JOIN fighter_opportunity_status o ON o.source_key=p.source_key AND o.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_availability ca ON ca.source_key=p.source_key AND ca.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_location cl ON cl.source_key=p.source_key AND cl.source_fighter_id=p.source_fighter_id
    LEFT JOIN scout_current_management cm ON cm.source_key=p.source_key AND cm.source_fighter_id=p.source_fighter_id
    WHERE w.owner_account_id=?
    ORDER BY CASE w.status WHEN 'watching' THEN 0 WHEN 'contacted' THEN 1 WHEN 'signed' THEN 2 ELSE 3 END,w.priority DESC,w.updated_at DESC
  `).bind(GLOBAL_MODEL,ownerId).all<Row>()).results||[];
  return rows.map(row=>({
    ...row,
    age:age(row.dob),
    status_changed:Boolean(row.snapshot_management_status)&&(
      row.snapshot_management_status!==row.management_status||
      row.snapshot_contract_status!==row.contract_status||
      row.snapshot_open_to_fights!==row.open_to_fights
    )
  }));
}

export async function watchlistApi(request:Request,env:Env){
  const who=await admin(request,env);if(!who)return json({error:'unauthorized'},401);
  if(request.method==='GET')return json({data:await watchlistRows(env,Number(who.id))});
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!guardMutation(request))return json({error:'cross_origin'},403);
  const input=await body(request);if(!input)return json({error:'invalid_json'},400);
  const profile=String(input.profile_slug||'').trim();
  const fighter=await fighterFromProfile(env.DB,profile);if(!fighter)return json({error:'fighter_not_found'},404);
  const status=await currentStatus(env.DB,fighter.source_key,fighter.source_fighter_id);
  await env.DB.prepare(`INSERT INTO recruiting_watchlist(owner_account_id,source_key,source_fighter_id,profile_slug,snapshot_management_status,snapshot_contract_status,snapshot_open_to_fights)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_account_id,source_key,source_fighter_id) DO NOTHING`)
    .bind(who.id,fighter.source_key,fighter.source_fighter_id,profile,status?.management_status||'unknown',status?.contract_status||'unknown',status?.open_to_fights||'unknown').run();
  return json({ok:true},201);
}

export async function watchlistItemApi(request:Request,env:Env,id:number){
  const who=await admin(request,env);if(!who)return json({error:'unauthorized'},401);
  const current=await ownedEntry(env,Number(who.id),id);if(!current)return json({error:'entry_not_found'},404);
  if(request.method==='DELETE'){
    if(!guardMutation(request))return json({error:'cross_origin'},403);
    await env.DB.prepare('DELETE FROM recruiting_watchlist WHERE id=? AND owner_account_id=?').bind(id,who.id).run();
    return json({ok:true});
  }
  if(request.method!=='PATCH')return json({error:'method_not_allowed'},405);
  if(!guardMutation(request))return json({error:'cross_origin'},403);
  const input=await body(request);if(!input)return json({error:'invalid_json'},400);
  if(input.reviewed===true){
    const status=await currentStatus(env.DB,current.source_key,current.source_fighter_id);
    await env.DB.prepare(`UPDATE recruiting_watchlist SET snapshot_management_status=?,snapshot_contract_status=?,snapshot_open_to_fights=?,last_reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(status?.management_status||'unknown',status?.contract_status||'unknown',status?.open_to_fights||'unknown',id).run();
    return json({ok:true});
  }
  const nextStatus=STATUS.has(String(input.status))?String(input.status):String(current.status);
  const priority=int(input.priority,0,5)??Number(current.priority||0);
  const notes=input.notes===undefined?current.notes:text(input.notes,2000);
  await env.DB.prepare(`UPDATE recruiting_watchlist SET status=?,priority=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(nextStatus,priority,notes,id).run();
  return json({ok:true});
}

export async function promoteWatchlistItemApi(request:Request,env:Env,id:number){
  const who=await admin(request,env);if(!who)return json({error:'unauthorized'},401);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!guardMutation(request))return json({error:'cross_origin'},403);
  const entry=await ownedEntry(env,Number(who.id),id);if(!entry)return json({error:'entry_not_found'},404);
  const input=await body(request);if(!input)return json({error:'invalid_json'},400);
  const openingId=int(input.opening_id,1,Number.MAX_SAFE_INTEGER);if(!openingId)return json({error:'opening_id_required'},400);
  const opening=await env.DB.prepare('SELECT id FROM recruiting_openings WHERE id=? AND owner_account_id=? LIMIT 1').bind(openingId,who.id).first<Row>();
  if(!opening)return json({error:'opening_not_found'},404);
  await env.DB.prepare(`INSERT OR IGNORE INTO recruiting_opening_candidates(opening_id,source_key,source_fighter_id,profile_slug) VALUES(?,?,?,?)`)
    .bind(openingId,entry.source_key,entry.source_fighter_id,entry.profile_slug).run();
  return json({ok:true,opening_id:openingId});
}

function shell(bodyHtml:string,script=''){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Recruiting Watchlist | ${BRAND_NAME}</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/recruiting.css?v=1"></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="recruit-main">${bodyHtml}</main><footer><span>${BRAND_NAME}</span><span>Private recruiting workspace.</span></footer>${script}</body></html>`;
}
function authPage(){
  return new Response(shell('<section class="recruit-hero"><span class="eyebrow">PRIVATE WORKSPACE</span><h1>Recruiting access required.</h1><p>This surface is restricted to authorized MMA Scouts recruiting users.</p><a class="button primary" href="/admin">Admin sign in →</a></section>'),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}

function watchlistCard(row:Row,openings:Row[]){
  const agencyHref=agencyContactHref(row);
  const contact=row.public_contact_url?`<a href="${esc(row.public_contact_url)}" rel="nofollow noopener" target="_blank">Direct public contact ↗</a>`:agencyHref?`<a href="${esc(agencyHref)}" rel="nofollow noopener">${esc(agencyContactLabel(row.agency_contact_kind))} ↗</a>`:row.agency_website?`<a href="${esc(row.agency_website)}" rel="nofollow noopener" target="_blank">Agency website ↗</a>`:'No public contact path';
  const rep=row.management_status==='represented'?(row.agency_name||row.manager_name||'Represented'):row.management_status==='unmanaged'?'Verified unmanaged':'Management unknown';
  const base=[row.base_city,row.base_region,row.base_country].filter(Boolean).join(', ')||'Base unknown';
  const changedBanner=row.status_changed?`<div class="watchlist-changed">Status changed since last reviewed: management ${esc(row.snapshot_management_status)} → ${esc(row.management_status)} · contract ${esc(row.snapshot_contract_status)} → ${esc(row.contract_status)} · availability ${esc(row.snapshot_open_to_fights)} → ${esc(row.open_to_fights)}</div>`:'';
  const openingOptions=openings.map(o=>`<option value="${o.id}">${esc(o.title)}</option>`).join('');
  return `<article class="recruit-candidate" data-watch-entry="${row.id}">
    ${changedBanner}
    <div class="recruit-candidate-head"><div><span class="eyebrow">${esc(row.current_weight_class||'Unknown division')}${row.promotion_name?' · '+esc(row.promotion_name):''}</span><h3><a href="/scout/fighters/${esc(row.profile_slug)}">${esc(row.fighter_name)}</a></h3><p>${esc(record(row))}${row.age!==null?' · Age '+row.age:''}${row.last_fight_date?' · Last fight '+esc(pretty(row.last_fight_date)):''}</p></div><div class="recruit-score"><small>GLOBAL RATING</small><strong>${score(row.global_rating)}</strong><span>Evidence ${pct(row.evidence_strength)}</span></div></div>
    <div class="recruit-facts"><span>${esc(rep)}</span><span>Contract: ${esc(String(row.contract_status||'unknown').replaceAll('_',' '))}</span><span>${esc(base)}</span><span>${contact}</span>${fightProfileFacts(row)}</div>
    <div class="recruit-actions">
      <select data-status aria-label="Watchlist status">${['watching','contacted','passed','signed'].map(v=>`<option value="${v}"${row.status===v?' selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select>
      <select data-priority aria-label="Priority">${[0,1,2,3,4,5].map(v=>`<option value="${v}"${Number(row.priority)===v?' selected':''}>Priority ${v}</option>`).join('')}</select>
      <button class="button secondary" type="button" data-save>Save</button>
      <button class="button secondary" type="button" data-reviewed>Mark reviewed</button>
    </div>
    <textarea data-notes maxlength="2000" placeholder="Why you're watching this fighter…">${esc(row.notes||'')}</textarea>
    <div class="recruit-actions watchlist-promote-row">
      <select data-promote-opening aria-label="Promote to opening"><option value="">Promote to opening…</option>${openingOptions}</select>
      <button class="button secondary" type="button" data-promote>Add to opening</button>
      <a class="button secondary" href="/scout/fighters/${esc(row.profile_slug)}">Fighter file →</a>
      <button class="button secondary" type="button" data-remove>Remove</button>
    </div>
  </article>`;
}

export async function watchlistPage(request:Request,env:Env){
  const who=await admin(request,env);if(!who)return authPage();
  const [rows,openings]=await Promise.all([
    watchlistRows(env,Number(who.id)),
    env.DB.prepare(`SELECT id,title FROM recruiting_openings WHERE owner_account_id=? AND status IN ('open','paused') ORDER BY updated_at DESC`).bind(who.id).all<Row>().then(r=>r.results||[])
  ]);
  const changedCount=rows.filter(r=>r.status_changed).length;
  const cards=rows.map(row=>watchlistCard(row,openings)).join('');
  const bodyHtml=`<section class="recruit-hero opening-hero"><a class="back-link" href="/recruiting">← Recruiting board</a><span class="eyebrow">GLOBAL WATCHLIST</span><h1>Fighters you're tracking, across every opening.</h1><p>Add a fighter here from a search result or intel queue card to keep an eye on them even without an opening to match. ${changedCount?`<strong>${changedCount} fighter${changedCount===1?'':'s'}</strong> changed status since you last reviewed them.`:'No status changes since your last review.'}</p></section>
  <section class="candidate-section"><div class="section-heading"><div><span class="eyebrow">WATCHED FIGHTERS</span><h2>${rows.length} on your list</h2></div></div><div class="candidate-grid">${cards||'<div class="recruit-empty">Nothing on your watchlist yet. Use the ☆ Watch button on /talent or the intelligence queue to add a fighter.</div>'}</div></section>`;
  const script=`<script>(()=>{
  async function call(url,payload){const r=await fetch(url,{method:payload?(payload.method||'PATCH'):'DELETE',credentials:'same-origin',headers:{'content-type':'application/json'},body:payload?JSON.stringify(payload.body||{}):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed');return j;}
  document.querySelectorAll('[data-watch-entry]').forEach(card=>{
    const id=card.dataset.watchEntry;
    card.querySelector('[data-save]')?.addEventListener('click',async btn=>{const b=btn.currentTarget;b.disabled=true;try{await call('/api/admin/recruiting/watchlist/'+id,{method:'PATCH',body:{status:card.querySelector('[data-status]').value,priority:Number(card.querySelector('[data-priority]').value),notes:card.querySelector('[data-notes]').value}});b.textContent='Saved';setTimeout(()=>b.textContent='Save',1000);}catch(e){b.textContent='Retry';}finally{b.disabled=false;}});
    card.querySelector('[data-reviewed]')?.addEventListener('click',async btn=>{const b=btn.currentTarget;b.disabled=true;try{await call('/api/admin/recruiting/watchlist/'+id,{method:'PATCH',body:{reviewed:true}});location.reload();}catch(e){b.disabled=false;}});
    card.querySelector('[data-remove]')?.addEventListener('click',async btn=>{const b=btn.currentTarget;if(!confirm('Remove from watchlist?'))return;b.disabled=true;try{await call('/api/admin/recruiting/watchlist/'+id,null);card.remove();}catch(e){b.disabled=false;}});
    card.querySelector('[data-promote]')?.addEventListener('click',async btn=>{const b=btn.currentTarget,openingId=card.querySelector('[data-promote-opening]').value;if(!openingId)return;b.disabled=true;try{await call('/api/admin/recruiting/watchlist/'+id+'/promote',{method:'POST',body:{opening_id:Number(openingId)}});b.textContent='Added';setTimeout(()=>b.textContent='Add to opening',1200);}catch(e){b.textContent='Retry';}finally{b.disabled=false;}});
  });
  })();</script>`;
  return new Response(shell(bodyHtml,script),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}
