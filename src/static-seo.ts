import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE=SITE_ORIGIN;
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const jsonLd=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c');
const prettyDate=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};

async function nextEvent(env:Env){
  return env.DB.prepare(`SELECT e.id,e.slug,e.name,e.promotion,e.promotion_slug,e.event_date,e.starts_at,e.status,e.venue,e.city,e.region,e.country,
    (SELECT a.name||' vs '||z.name FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id WHERE b.event_id=e.id ORDER BY b.bout_order,b.id LIMIT 1) main_event
    FROM events e
    WHERE e.slug IS NOT NULL AND e.status='scheduled' AND COALESCE(e.starts_at,e.event_date)>=CURRENT_TIMESTAMP
      AND (e.promotion_slug IS NOT NULL OR e.promotion='UFC' OR EXISTS(SELECT 1 FROM bouts b WHERE b.event_id=e.id))
    ORDER BY COALESCE(e.starts_at,e.event_date) ASC LIMIT 1`).first<Row>();
}

async function eventRows(env:Env,eventId:number){
  const rows=await env.DB.prepare(`SELECT b.id,b.bout_order,b.weight_class,b.status,a.name fighter_a,z.name fighter_b,a.slug fighter_a_slug,z.slug fighter_b_slug
    FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
    WHERE b.event_id=? ORDER BY b.bout_order,b.id LIMIT 8`).bind(eventId).all<Row>();
  return rows.results||[];
}

function eventSpotlight(event:Row|null,rows:Row[]){
  if(!event?.slug)return `<div class="home-matchup-shell"><div class="home-matchup-head"><div><span class="eyebrow">EVENT SCOUT</span><h2>The next official cards are syncing.</h2><p>Scout AI, promotion rosters and fighter reports remain available across the database.</p></div><a class="button secondary" href="/scout">Ask Scout AI →</a></div></div>`;
  const location=[event.venue,event.city,event.region,event.country].filter(Boolean).filter((value,index,all)=>all.indexOf(value)===index).join(' · ');
  const cards=rows.slice(0,4).map((r,index)=>`<a class="home-matchup-card" href="/scout?q=${encodeURIComponent(`Compare ${String(r.fighter_a)} and ${String(r.fighter_b)} as MMA fighters`)}"><span class="home-matchup-label">${index===0?'Featured fight':`Card matchup ${index+1}`}</span><div class="home-matchup-names"><strong>${escape(r.fighter_a)}</strong><span class="home-matchup-vs">vs</span><strong>${escape(r.fighter_b)}</strong></div><div class="home-model-edge"><small>${escape(r.weight_class||'Open fighter research')}</small><b>Scout →</b></div></a>`).join('');
  return `<div class="home-matchup-shell"><div class="home-matchup-head"><div><span class="eyebrow">NEXT EVENT · ${escape(String(event.promotion||'MMA').toUpperCase())} · ${escape(prettyDate(event.event_date))}</span><h2>${escape(event.name)}</h2><p>${escape(event.main_event||location||'Official event tracking')}</p></div><a class="button secondary" href="/events/${escape(event.slug)}">Scout full card →</a></div>${cards?`<div class="home-matchup-grid">${cards}</div>`:''}</div>`;
}

function promptButtons(rows:Row[]){
  const first=rows[0];
  const questions=first?[
    `Compare ${first.fighter_a} and ${first.fighter_b} as fighters without making a prediction`,
    `Who has faced stronger opposition: ${first.fighter_a} or ${first.fighter_b}?`,
    `Which fighters are statistically similar to ${first.fighter_a}?`,
    'Which regional prospects have faced the strongest opposition?'
  ]:[
    'Which active lightweights have the strongest strength of schedule?',
    'Which regional prospects have faced the strongest opposition?',
    'Who are the highest-rated prospects under 25 outside the UFC?'
  ];
  return questions.map(q=>`<button class="home-prompt" type="button" data-home-question="${escape(q)}">${escape(q)}</button>`).join('');
}

async function asset(request:Request,env:Env,pathname:string){const url=new URL(request.url);url.pathname=pathname;url.search='';return env.ASSETS.fetch(new Request(url.toString(),{method:'GET',headers:request.headers}));}
function baseMeta(rewriter:HTMLRewriter,title:string,description:string,canonical:string){return rewriter.on('title',{element(el){el.setInnerContent(title);}}).on('meta[name="description"]',{element(el){el.setAttribute('content',description);}}).on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}}).on('meta[property="og:url"]',{element(el){el.setAttribute('content',canonical);}}).on('meta[property="og:image"]',{element(el){el.setAttribute('content',`${SITE}/og.png`);}}).on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}}).on('meta[name="twitter:image"]',{element(el){el.setAttribute('content',`${SITE}/og.png`);}});}

export async function homePage(request:Request,env:Env){
  const event=await nextEvent(env);
  const [response,rows]=await Promise.all([asset(request,env,'/index.html'),event?.id?eventRows(env,Number(event.id)):Promise.resolve([])]);
  const title='Global MMA Scouting, Fighter Reports & Prospect Discovery | MMA Scouts';
  const description='Discover and evaluate MMA fighters across major and regional promotions with opponent-adjusted Scout Ratings, prospect research, career history, promotion rosters and evidence-grounded Scout AI.';
  const canonical=`${SITE}/`;
  const schema={'@context':'https://schema.org','@graph':[{'@type':'WebSite',name:BRAND_NAME,url:canonical,description,potentialAction:{'@type':'SearchAction',target:`${SITE}/scout?q={search_term_string}`,'query-input':'required name=search_term_string'}},{'@type':'Organization',name:BRAND_NAME,url:canonical}]};
  const rewriter=baseMeta(new HTMLRewriter(),title,description,canonical)
    .on('#home-matchup-slot',{element(el){el.setInnerContent(eventSpotlight(event,rows),{html:true});}})
    .on('#home-dynamic-prompts',{element(el){el.setInnerContent(promptButtons(rows),{html:true});}})
    .on('head',{element(el){el.append(`<link rel="canonical" href="${canonical}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:site_name" content="${BRAND_NAME}"><script type="application/ld+json">${jsonLd(schema)}</script>`,{html:true});}});
  const transformed=rewriter.transform(response),out=new Response(transformed.body,transformed);
  out.headers.set('cache-control','public, max-age=30, s-maxage=90');
  out.headers.set('Link',`<${canonical}>; rel="canonical"`);
  return out;
}

export async function predictionsPage(request:Request,_env:Env){
  return Response.redirect(new URL('/events',request.url),308);
}
