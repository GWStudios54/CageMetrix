type Env={DB:D1Database};
type Row=Record<string,any>;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const label=(value:unknown)=>String(value||'unknown').replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase());
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};

function groupCamp(rows:Row[]){
  const map=new Map<number,Row>();
  for(const row of rows){
    const id=Number(row.id);let item=map.get(id);
    if(!item){item={...row,evidence:[]};for(const key of ['evidence_id','evidence_source_url','evidence_source_title','evidence_publisher','evidence_published_at','evidence_source_type','evidence_confidence'])delete item[key];map.set(id,item);}
    if(row.evidence_id)item.evidence.push({source_url:row.evidence_source_url,source_title:row.evidence_source_title,publisher:row.evidence_publisher,published_at:row.evidence_published_at,source_type:row.evidence_source_type,confidence:row.evidence_confidence});
  }
  return [...map.values()];
}

function sourceLinks(evidence:Row[]){return evidence.map(item=>`<a class="contract-source" href="${esc(item.source_url)}" rel="nofollow noopener"><strong>${esc(item.source_title||item.publisher||'Public source')}</strong><small>${esc(item.publisher||label(item.source_type))}${item.published_at?` · ${esc(pretty(item.published_at)||item.published_at)}`:''} · Grade ${esc(item.confidence||'C')}</small></a>`).join('');}

function campCard(row:Row){
  const campName=row.camp_name_resolved||row.camp_name||'Training camp not publicly named';
  const date=[row.started_at?`Joined ${pretty(row.started_at)||row.started_at}`:null,row.ended_at?`Left ${pretty(row.ended_at)||row.ended_at}`:row.is_current?'Current':null].filter(Boolean).join(' · ');
  const location=[row.city,row.region,row.country].filter(Boolean).join(', ');
  return `<article class="representation-record"><div><span class="eyebrow">${row.is_current?'CURRENT CAMP':'CAMP HISTORY'}</span><h3>${row.camp_slug?`<a href="/camps/${esc(row.camp_slug)}">${esc(campName)}</a>`:esc(campName)}</h3>${location?`<p>${esc(location)}</p>`:''}${row.coach_name?`<p>Coach: ${esc(row.coach_name)}</p>`:''}<small>${esc(date||'Dates not publicly established')} · Evidence grade ${esc(row.confidence||'C')}</small></div>${row.evidence?.length?`<div class="contract-sources">${sourceLinks(row.evidence)}</div>`:''}</article>`;
}

async function fighterCampData(env:Env,slug:string){
  const fighter=await env.DB.prepare(`SELECT source_key,source_fighter_id FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!fighter)return null;
  let camp:Row[];
  try{
    const result=await env.DB.prepare(`SELECT h.id,h.camp_name,h.coach_name,h.started_at,h.ended_at,h.is_current,h.confidence,
      t.slug camp_slug,t.name camp_name_resolved,t.city,t.region,t.country,
      ev.id evidence_id,ev.source_url evidence_source_url,ev.source_title evidence_source_title,ev.publisher evidence_publisher,
      ev.published_at evidence_published_at,ev.source_type evidence_source_type,ev.confidence evidence_confidence
      FROM fighter_camp_history h
      LEFT JOIN training_camps t ON t.id=h.camp_id
      LEFT JOIN fighter_camp_evidence ev ON ev.camp_history_id=h.id
      WHERE h.source_key=? AND h.source_fighter_id=?
      ORDER BY h.is_current DESC,COALESCE(h.started_at,h.verified_at) DESC,h.id DESC,
               CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC`).bind(fighter.source_key,fighter.source_fighter_id).all<Row>();
    camp=groupCamp(result.results||[]);
  }catch{
    camp=[];
  }
  return {fighter,camp};
}

export async function enhanceFighterCampContext(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const data=await fighterCampData(env,slug);if(!data)return response;
  const body=data.camp.length?data.camp.map(campCard).join(''):`<div class="talent-empty"><strong>Training camp is not publicly verified.</strong><p>No camp record is treated as unknown—not campless.</p></div>`;
  const section=`<section class="contract-intelligence camp-intelligence"><div class="talent-section-head"><span class="eyebrow">TRAINING CAMP INTELLIGENCE</span><h2>Where this fighter trains</h2><p>Camp affiliation is published only when public evidence supports it, and dated to when the affiliation actually changed.</p></div><div class="contract-columns"><div><h3>Camp file</h3>${body}</div></div></section>`;
  return new HTMLRewriter().on('.contract-intelligence',{element(el){el.after(section,{html:true});}}).transform(response);
}
