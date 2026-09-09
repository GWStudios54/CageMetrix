type Env={DB:D1Database};
type Row=Record<string,any>;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));

async function agencySourceRows(env:Env,slug:string){
  const agency=await env.DB.prepare(`SELECT id,name,website_url FROM management_agencies WHERE slug=? AND active=1 LIMIT 1`).bind(slug).first<Row>();
  if(!agency)return null;
  let sources:Row[]=[];
  try{
    const result=await env.DB.prepare(`SELECT source_url,source_title,source_type,verified_at FROM management_agency_sources WHERE agency_id=? ORDER BY CASE source_type WHEN 'official_profile' THEN 1 WHEN 'official_services' THEN 2 WHEN 'official_roster' THEN 3 ELSE 4 END,verified_at DESC`).bind(agency.id).all<Row>();
    sources=result.results||[];
  }catch{}
  if(!sources.length&&agency.website_url)sources=[{source_url:agency.website_url,source_title:`${agency.name} official website`,source_type:'official_profile'}];
  return {agency,sources};
}

export async function enhanceManagementAgencyAbout(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const data=await agencySourceRows(env,slug);if(!data)return response;
  const sourceLinks=data.sources.map((row:Row)=>`<a class="contract-source" href="${esc(row.source_url)}" rel="nofollow noopener"><strong>${esc(row.source_title||'Official agency source')}</strong><small>${esc(String(row.source_type||'official_profile').replaceAll('_',' '))}</small></a>`).join('');
  const section=`<section class="agency-about-sources"><div class="talent-section-head"><span class="eyebrow">ABOUT & SOURCES</span><h2>Independent MMA Scouts profile</h2><p>The summary above is written by MMA Scouts from publicly available factual information. It is not copied marketing text and does not indicate a partnership, sponsorship or endorsement.</p></div>${sourceLinks?`<div class="contract-sources"><strong>Official sources</strong>${sourceLinks}</div>`:''}<p class="talent-policy"><strong>Independence notice:</strong> MMA Scouts is not affiliated with or endorsed by ${esc(data.agency.name)}. Company names are used to identify the subject of this research profile.</p></section>`;
  return new HTMLRewriter().on('.talent-hero',{element(el){el.after(section,{html:true});}}).transform(response);
}
