type Env={DB:D1Database};
type Row=Record<string,any>;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const label=(value:unknown)=>String(value||'unknown').replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase());
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};

function groupEvents(rows:Row[]){
  const map=new Map<number,Row>();
  for(const row of rows){
    const id=Number(row.id);let item=map.get(id);
    if(!item){item={...row,evidence:[]};for(const key of ['evidence_id','evidence_source_url','evidence_source_title','evidence_publisher','evidence_published_at','evidence_source_type','evidence_confidence'])delete item[key];map.set(id,item);}
    if(row.evidence_id)item.evidence.push({source_url:row.evidence_source_url,source_title:row.evidence_source_title,publisher:row.evidence_publisher,published_at:row.evidence_published_at,source_type:row.evidence_source_type,confidence:row.evidence_confidence});
  }
  return [...map.values()];
}

function sourceLinks(evidence:Row[]){return evidence.map(item=>`<a class="contract-source" href="${esc(item.source_url)}" rel="nofollow noopener"><strong>${esc(item.source_title||item.publisher||'Public source')}</strong><small>${esc(item.publisher||label(item.source_type))}${item.published_at?` · ${esc(pretty(item.published_at)||item.published_at)}`:''} · Grade ${esc(item.confidence||'C')}</small></a>`).join('');}

// Neutral, factual framing throughout -- this is the one intel category in this system where tone
// matters as much as accuracy. No editorializing, no "shocking"/"caught" language, just what a
// sanctioning body or promotion has publicly stated.
function eventCard(row:Row){
  const when=pretty(row.effective_at||row.reported_at)||'Date not publicly established';
  const details:string[]=[];
  if(row.substance)details.push(`Substance: ${row.substance}`);
  if(row.sanctioning_body)details.push(`Sanctioning body: ${row.sanctioning_body}`);
  if(row.suspension_months)details.push(`Reported suspension: ${row.suspension_months} month${Number(row.suspension_months)===1?'':'s'}`);
  if(row.expires_at)details.push(`Reported end date: ${pretty(row.expires_at)||row.expires_at}`);
  return `<article class="contract-record${row.is_current?' current':''}"><div class="contract-record-head"><div><span class="eyebrow">${esc(label(row.event_type))}${row.is_current?' · CURRENT':''}</span></div></div><p>${esc(row.public_summary)}</p>${details.length?`<ul class="contract-terms">${details.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>`:''}<div class="contract-meta"><span>${esc(when)}</span></div>${row.evidence?.length?`<div class="contract-sources"><strong>Sources</strong>${sourceLinks(row.evidence)}</div>`:''}</article>`;
}

async function fighterAntidopingData(env:Env,slug:string){
  const fighter=await env.DB.prepare(`SELECT source_key,source_fighter_id FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!fighter)return null;
  let events:Row[];
  try{
    const result=await env.DB.prepare(`SELECT e.id,e.event_type,e.substance,e.sanctioning_body,e.suspension_months,e.effective_at,e.reported_at,e.expires_at,e.public_summary,e.is_current,
      ev.id evidence_id,ev.source_url evidence_source_url,ev.source_title evidence_source_title,ev.publisher evidence_publisher,
      ev.published_at evidence_published_at,ev.source_type evidence_source_type,ev.confidence evidence_confidence
      FROM fighter_antidoping_events e
      LEFT JOIN fighter_antidoping_evidence ev ON ev.antidoping_event_id=e.id
      WHERE e.source_key=? AND e.source_fighter_id=?
      ORDER BY COALESCE(e.effective_at,e.reported_at) DESC,e.id DESC,
               CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC`).bind(fighter.source_key,fighter.source_fighter_id).all<Row>();
    events=groupEvents(result.results||[]);
  }catch{
    events=[];
  }
  return {fighter,events};
}

// Unlike contract/representation/camp, this section is omitted entirely (not shown with an
// empty/"unknown" state) when a fighter has no published anti-doping event. Showing a "no violations
// reported" box on every clean fighter's page -- the overwhelming majority -- would read as
// presumptive rather than informative, unlike "representation not publicly verified" which is a
// genuinely common and expected unknown.
export async function enhanceFighterAntidopingContext(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const data=await fighterAntidopingData(env,slug);if(!data||!data.events.length)return response;
  const section=`<section class="contract-intelligence antidoping-intelligence"><div class="talent-section-head"><span class="eyebrow">ANTI-DOPING STATUS</span><h2>Publicly reported status</h2><p>Published only when a sanctioning body, promotion or reputable outlet has stated it publicly. Every claim links to its source.</p></div><div class="contract-columns"><div>${data.events.map(eventCard).join('')}</div></div></section>`;
  return new HTMLRewriter().on('.camp-intelligence',{element(el){el.after(section,{html:true});}}).transform(response);
}
