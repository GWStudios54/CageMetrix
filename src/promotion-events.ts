type Env={DB:D1Database};
type EventRow={slug:string;name:string;event_date:string;venue:string|null;city:string|null;region:string|null;country:string|null;status:string|null};

const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));

function prettyDate(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
}

function place(row:EventRow){
  return [row.venue,row.city,row.region,row.country].filter((value,index,all)=>value&&all.indexOf(value)===index).join(' · ');
}

function eventCard(row:EventRow,label:string){
  return `<a class="directory-promo-card directory-event-card" href="/events/${escape(row.slug)}"><span class="directory-region">${escape(label)}</span><h3>${escape(row.name)}</h3><p>${escape(prettyDate(row.event_date))}${place(row)?` · ${escape(place(row))}`:''}</p><span class="directory-arrow">Scout event →</span></a>`;
}

export async function enhancePromotionEvents(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const result=await env.DB.prepare(`
    SELECT slug,name,event_date,venue,city,region,country,status
    FROM events
    WHERE promotion_slug=? AND slug IS NOT NULL AND event_date>=date('now','-45 day')
    ORDER BY event_date ASC,name ASC
    LIMIT 40
  `).bind(slug).all<EventRow>();
  const rows=result.results||[];
  if(!rows.length)return response;
  const today=new Date().toISOString().slice(0,10);
  const upcoming=rows.filter(row=>row.event_date>=today&&String(row.status||'scheduled')!=='cancelled').slice(0,12);
  const recent=rows.filter(row=>row.event_date<today).sort((a,b)=>b.event_date.localeCompare(a.event_date)||a.name.localeCompare(b.name)).slice(0,6);
  if(!upcoming.length&&!recent.length)return response;
  const blocks=[
    upcoming.length?`<section class="directory-region-section directory-events-section"><div class="directory-section-head"><span class="eyebrow">UPCOMING EVENTS</span><h2>Next ${escape(upcoming.length===1?'card':'cards')}</h2><p>Official promotion calendar entries with verified dates and physical locations.</p></div><div class="directory-promo-grid">${upcoming.map(row=>eventCard(row,'UPCOMING')).join('')}</div></section>`:'',
    recent.length?`<section class="directory-region-section directory-events-section"><div class="directory-section-head"><span class="eyebrow">RECENT EVENTS</span><h2>Recent cards</h2></div><div class="directory-promo-grid">${recent.map(row=>eventCard(row,'RECENT')).join('')}</div></section>`:''
  ].join('');
  return new HTMLRewriter().on('.scout-directory-main',{element(element){element.append(blocks,{html:true});}}).transform(response);
}
