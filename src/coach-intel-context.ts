type Env={DB:D1Database};
type Row=Record<string,any>;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const label=(value:unknown)=>String(value||'unknown').replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase());
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};

function groupCoach(rows:Row[]){
  const map=new Map<number,Row>();
  for(const row of rows){
    const id=Number(row.id);let item=map.get(id);
    if(!item){item={...row,evidence:[]};for(const key of ['evidence_id','evidence_source_url','evidence_source_title','evidence_publisher','evidence_published_at','evidence_source_type','evidence_confidence'])delete item[key];map.set(id,item);}
    if(row.evidence_id)item.evidence.push({source_url:row.evidence_source_url,source_title:row.evidence_source_title,publisher:row.evidence_publisher,published_at:row.evidence_published_at,source_type:row.evidence_source_type,confidence:row.evidence_confidence});
  }
  return [...map.values()];
}

function sourceLinks(evidence:Row[]){return evidence.map(item=>`<a class="contract-source" href="${esc(item.source_url)}" rel="nofollow noopener"><strong>${esc(item.source_title||item.publisher||'Public source')}</strong><small>${esc(item.publisher||label(item.source_type))}${item.published_at?` · ${esc(pretty(item.published_at)||item.published_at)}`:''} · Grade ${esc(item.confidence||'C')}</small></a>`).join('');}

function coachCard(row:Row){
  const date=[row.started_at?`Since ${pretty(row.started_at)||row.started_at}`:null,row.ended_at?`Until ${pretty(row.ended_at)||row.ended_at}`:row.is_current?'Current':null].filter(Boolean).join(' · ');
  return `<article class="representation-record"><div><span class="eyebrow">${row.is_current?'CURRENT COACH':'COACH HISTORY'}</span><h3>${esc(row.coach_name)}</h3><small>${esc(date||'Dates not publicly established')} · Evidence grade ${esc(row.confidence||'C')}</small></div>${row.evidence?.length?`<div class="contract-sources">${sourceLinks(row.evidence)}</div>`:''}</article>`;
}

async function fighterCoachData(env:Env,slug:string){
  const fighter=await env.DB.prepare(`SELECT source_key,source_fighter_id FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!fighter)return null;
  let coaches:Row[];
  try{
    const result=await env.DB.prepare(`SELECT h.id,h.coach_name,h.started_at,h.ended_at,h.is_current,h.confidence,
      ev.id evidence_id,ev.source_url evidence_source_url,ev.source_title evidence_source_title,ev.publisher evidence_publisher,
      ev.published_at evidence_published_at,ev.source_type evidence_source_type,ev.confidence evidence_confidence
      FROM fighter_coach_history h
      LEFT JOIN fighter_coach_evidence ev ON ev.coach_history_id=h.id
      WHERE h.source_key=? AND h.source_fighter_id=?
      ORDER BY h.is_current DESC,COALESCE(h.started_at,h.verified_at) DESC,h.id DESC,
               CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC`).bind(fighter.source_key,fighter.source_fighter_id).all<Row>();
    coaches=groupCoach(result.results||[]);
  }catch{
    coaches=[];
  }
  return {fighter,coaches};
}

// A fighter can change head coach without changing gym/camp and vice versa (e.g. Henry
// Cejudo/Eric Albarracin splitting while presumably remaining at the same camp) -- distinct from
// camp-intelligence and shown as its own section rather than folded into it. Always renders (with a
// neutral empty state) even with no coach history, same reasoning as camp: no record is treated as
// unknown, not coachless.
export async function enhanceFighterCoachContext(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const data=await fighterCoachData(env,slug);if(!data)return response;
  const body=data.coaches.length?data.coaches.map(coachCard).join(''):`<div class="talent-empty"><strong>No publicly verified head coach.</strong><p>No coach record is treated as unknown, not coachless.</p></div>`;
  const section=`<section class="contract-intelligence coach-intelligence"><div class="talent-section-head"><span class="eyebrow">COACH INTELLIGENCE</span><h2>Who leads this fighter's corner</h2><p>Coach affiliation is published only when public evidence supports it, and is tracked separately from training camp -- a fighter can change one without the other.</p></div><div class="contract-columns"><div>${body}</div></div></section>`;
  return new HTMLRewriter().on('.camp-intelligence',{element(el){el.after(section,{html:true});}}).transform(response);
}
