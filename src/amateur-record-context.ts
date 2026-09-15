type Env={DB:D1Database};
type Row=Record<string,any>;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const label=(value:unknown)=>String(value||'unknown').replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase());
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};

function sourceLinks(evidence:Row[]){return evidence.map(item=>`<a class="contract-source" href="${esc(item.source_url)}" rel="nofollow noopener"><strong>${esc(item.source_title||item.publisher||'Public source')}</strong><small>${esc(item.publisher||label(item.source_type))}${item.published_at?` · ${esc(pretty(item.published_at)||item.published_at)}`:''} · Grade ${esc(item.confidence||'C')}</small></a>`).join('');}

async function fighterAmateurRecordData(env:Env,slug:string){
  const fighter=await env.DB.prepare(`SELECT source_key,source_fighter_id FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!fighter)return null;
  let record:Row|null=null;
  try{
    const rows=await env.DB.prepare(`SELECT r.id,r.wins,r.losses,r.draws,r.no_contests,r.promotion_or_body,r.turned_pro_date,r.confidence,
      ev.id evidence_id,ev.source_url evidence_source_url,ev.source_title evidence_source_title,ev.publisher evidence_publisher,
      ev.published_at evidence_published_at,ev.source_type evidence_source_type,ev.confidence evidence_confidence
      FROM fighter_amateur_record r
      LEFT JOIN fighter_amateur_record_evidence ev ON ev.amateur_record_id=r.id
      WHERE r.source_key=? AND r.source_fighter_id=?
      ORDER BY CASE ev.confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,ev.verified_at DESC`).bind(fighter.source_key,fighter.source_fighter_id).all<Row>();
    for(const row of rows.results||[]){
      if(!record){record={...row,evidence:[]};for(const key of ['evidence_id','evidence_source_url','evidence_source_title','evidence_publisher','evidence_published_at','evidence_source_type','evidence_confidence'])delete record[key];}
      if(row.evidence_id)record.evidence.push({source_url:row.evidence_source_url,source_title:row.evidence_source_title,publisher:row.evidence_publisher,published_at:row.evidence_published_at,source_type:row.evidence_source_type,confidence:row.evidence_confidence});
    }
  }catch{
    record=null;
  }
  return {fighter,record};
}

// Unlike contract/camp/representation, this section is omitted entirely (not shown with an
// empty/"unknown" state) when no amateur record is on file. Most professional fighters simply have no
// tracked amateur MMA career -- there's no discovery pipeline that would eventually fill this in the
// way contract/camp candidates get reviewed -- so "amateur record not verified" on every page would be
// noise, not a meaningful gap, same reasoning as antidoping's omission rule.
export async function enhanceFighterAmateurRecordContext(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const data=await fighterAmateurRecordData(env,slug);if(!data||!data.record)return response;
  const r=data.record;
  const recordLine=`${r.wins}-${r.losses}${r.draws?`-${r.draws}`:''}${r.no_contests?` (${r.no_contests} NC)`:''}`;
  const details:string[]=[];
  if(r.turned_pro_date)details.push(`Turned professional: ${pretty(r.turned_pro_date)||r.turned_pro_date}`);
  const section=`<section class="contract-intelligence amateur-record-intelligence"><div class="talent-section-head"><span class="eyebrow">AMATEUR RECORD</span><h2>Before turning professional</h2><p>Published only when a promotion, sanctioning body or reputable outlet has publicly documented it.</p></div><div class="contract-columns"><div><article class="contract-record"><div class="contract-record-head"><div><span class="eyebrow">AMATEUR MMA</span><h3>${esc(r.promotion_or_body||'Amateur competition')}</h3></div><span class="talent-badge">${esc(recordLine)}</span></div>${details.length?`<ul class="contract-terms">${details.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>`:''}${r.evidence?.length?`<div class="contract-sources"><strong>Sources</strong>${sourceLinks(r.evidence)}</div>`:''}</article></div></div></section>`;
  return new HTMLRewriter().on('.camp-intelligence',{element(el){el.after(section,{html:true});}}).transform(response);
}
