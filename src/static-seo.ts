import {eventSeoName} from './seo.ts';
import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE=SITE_ORIGIN;
const PUBLIC_MODEL='CageMetrix Win Probability';
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const jsonLd=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c');
const prettyDate=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};
const modelRank=(v:unknown)=>v==='0.2.1'?0:v==='0.2.0'?1:v==='0.1.0'?2:3;

async function nextEvent(env:Env){
  return env.DB.prepare(`SELECT e.id,e.slug,e.name,e.event_date,e.starts_at,e.status,
    (SELECT a.name||' vs '||z.name FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id WHERE b.event_id=e.id ORDER BY b.bout_order,b.id LIMIT 1) main_event
    FROM events e
    WHERE e.slug IS NOT NULL AND e.status='scheduled' AND e.starts_at>=CURRENT_TIMESTAMP
      AND EXISTS(SELECT 1 FROM bouts b JOIN predictions p ON p.bout_id=b.id WHERE b.event_id=e.id)
    ORDER BY e.starts_at ASC LIMIT 1`).first<Row>();
}
async function eventRows(env:Env,eventId:number){
  const rows=await env.DB.prepare(`WITH latest AS (
    SELECT p.*,mv.version model_version,ROW_NUMBER() OVER(PARTITION BY p.bout_id ORDER BY CASE mv.version WHEN '0.2.1' THEN 0 WHEN '0.2.0' THEN 1 WHEN '0.1.0' THEN 2 ELSE 3 END,p.id DESC) rn
    FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id WHERE mv.name=?
  ), consensus AS (
    SELECT ep.bout_id,COUNT(*) total,SUM(CASE WHEN ep.picked_fighter_id=b.fighter_a_id THEN 1 ELSE 0 END) a_picks,SUM(CASE WHEN ep.picked_fighter_id=b.fighter_b_id THEN 1 ELSE 0 END) b_picks
    FROM community_event_picks ep JOIN bouts b ON b.id=ep.bout_id GROUP BY ep.bout_id
  ) SELECT b.id,b.bout_order,b.fighter_a_id,b.fighter_b_id,a.name fighter_a,z.name fighter_b,lp.fighter_a_probability,lp.fighter_b_probability,lp.picked_fighter_id,lp.model_version,COALESCE(c.total,0) community_total,COALESCE(c.a_picks,0) a_picks,COALESCE(c.b_picks,0) b_picks
    FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id LEFT JOIN latest lp ON lp.bout_id=b.id AND lp.rn=1 LEFT JOIN consensus c ON c.bout_id=b.id WHERE b.event_id=? ORDER BY b.bout_order,b.id`).bind(PUBLIC_MODEL,eventId).all<Row>();
  const map=new Map<string,Row>();for(const r of rows.results||[]){const ids=[Number(r.fighter_a_id),Number(r.fighter_b_id)].sort((a,b)=>a-b),key=ids.join(':');const cur=map.get(key);if(!cur||modelRank(r.model_version)<modelRank(cur.model_version)||(modelRank(r.model_version)===modelRank(cur.model_version)&&Number(r.id)>Number(cur.id)))map.set(key,r);}return [...map.values()].sort((a,b)=>Number(a.bout_order||999)-Number(b.bout_order||999));
}
async function trending(env:Env,event:Row|null){
  const out:{href:string,title:string,meta:string}[]=[];
  if(event?.slug)out.push({href:`/forum/event/${event.slug}`,title:`${eventSeoName(event)} event thread`,meta:'Fight Night'});
  if(event?.id){const fights=await env.DB.prepare(`SELECT b.id,a.name fighter_a,z.name fighter_b,COUNT(p.id) replies FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id LEFT JOIN community_posts p ON p.scope_type='fight' AND p.scope_id=b.id AND p.deleted_at IS NULL WHERE b.event_id=? GROUP BY b.id ORDER BY replies DESC,b.bout_order LIMIT 2`).bind(event.id).all<Row>();for(const r of fights.results||[])if(Number(r.replies||0)>0)out.push({href:`/forum/fight/${r.id}`,title:`${r.fighter_a} vs ${r.fighter_b}`,meta:`${r.replies} posts · Fight Night`});}
  try{const custom=await env.DB.prepare(`SELECT t.id,t.title,t.category,COUNT(p.id) replies FROM forum_threads t LEFT JOIN forum_posts p ON p.thread_id=t.id AND p.deleted_at IS NULL WHERE t.deleted_at IS NULL GROUP BY t.id ORDER BY COALESCE(MAX(p.created_at),t.updated_at) DESC LIMIT 4`).all<Row>();for(const r of custom.results||[])out.push({href:`/forum/thread/${r.id}`,title:String(r.title),meta:`${Number(r.replies||0)} posts · ${r.category==='cagemetrix'?BRAND_NAME:r.category==='off-topic'?'Off Topic':'MMA'}`});}catch{}
  return out.slice(0,5);
}
function dashboard(event:Row|null,rows:Row[],threads:{href:string,title:string,meta:string}[]){
  if(!event?.slug)return '';
  const label=eventSeoName(event),matchup=event.main_event||event.name,community=rows.reduce((n,r)=>n+Number(r.community_total||0),0),predictions=rows.filter(r=>Number.isFinite(Number(r.fighter_a_probability))).length;
  const disagreements=rows.map(r=>{const total=Number(r.community_total||0),a=Number(r.fighter_a_probability);if(!total||!Number.isFinite(a))return null;const crowd=Number(r.a_picks||0)/total;return {...r,crowd_a:crowd,gap:Math.abs(a-crowd)};}).filter(Boolean).sort((a:any,b:any)=>b.gap-a.gap).slice(0,3) as Row[];
  const disagreementHtml=disagreements.length?disagreements.map(r=>`<div class="home-disagreement"><div class="home-disagreement-top"><strong>${escape(r.fighter_a)} vs ${escape(r.fighter_b)}</strong><b>${Math.round(Number(r.gap)*100)}pt split</b></div><small>Model: ${escape(r.fighter_a)} ${Math.round(Number(r.fighter_a_probability)*100)}% · Crowd: ${Math.round(Number(r.crowd_a)*100)}%</small></div>`).join(''):'<div class="home-empty">Crowd disagreement appears as community picks come in.</div>';
  const threadHtml=threads.length?threads.map(t=>`<a class="home-thread-link" href="${escape(t.href)}"><strong>${escape(t.title)}</strong><small>${escape(t.meta)}</small></a>`).join(''):'<div class="home-empty">The forum is warming up.</div>';
  return `<section class="home-fightweek" data-home-dashboard data-event-slug="${escape(event.slug)}"><div class="home-fightweek-shell"><div class="home-fightweek-head"><div><span class="eyebrow">NEXT CARD · ${escape(prettyDate(event.event_date))}</span><h2>${escape(label)}</h2><p>${escape(matchup)}</p></div><a class="button primary" href="/events/${escape(event.slug)}">Open the card →</a></div><div class="home-fightweek-stats"><div class="home-fightweek-stat"><strong>${predictions}</strong><span>MMA Scouts predictions</span></div><div class="home-fightweek-stat"><strong>${community}</strong><span>community picks</span></div><div class="home-fightweek-stat"><strong>${disagreements.length}</strong><span>notable model/crowd splits</span></div></div><div class="home-user-card" data-home-user><div><span class="eyebrow">YOUR CARD</span><strong>Loading your record…</strong></div></div><div class="home-fightweek-grid"><div class="home-fightweek-panel"><span class="eyebrow">THE CROWD DISAGREES</span><h3>Biggest model vs community splits</h3><div class="home-disagreement-list">${disagreementHtml}</div></div><div class="home-fightweek-panel"><span class="eyebrow">FORUM</span><h3>Active discussions</h3><div class="home-thread-list">${threadHtml}</div><a class="home-forum-link" href="/forum">Enter the forum →</a></div></div></div></section>`;
}
async function asset(request:Request,env:Env,pathname:string){const url=new URL(request.url);url.pathname=pathname;url.search='';return env.ASSETS.fetch(new Request(url.toString(),{method:'GET',headers:request.headers}));}
function baseMeta(rewriter:HTMLRewriter,title:string,description:string,canonical:string){return rewriter.on('title',{element(el){el.setInnerContent(title);}}).on('meta[name="description"]',{element(el){el.setAttribute('content',description);}}).on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}}).on('meta[property="og:url"]',{element(el){el.setAttribute('content',canonical);}}).on('meta[property="og:image"]',{element(el){el.setAttribute('content',`${SITE}/og.png`);}}).on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}}).on('meta[name="twitter:image"]',{element(el){el.setAttribute('content',`${SITE}/og.png`);}});}

export async function homePage(request:Request,env:Env){
  const responsePromise=asset(request,env,'/index.html'),event=await nextEvent(env),[response,rows,threads]=await Promise.all([responsePromise,event?.id?eventRows(env,Number(event.id)):Promise.resolve([]),trending(env,event)]);
  const title='MMA Fighter Stats, Rankings, Predictions & Research | MMA Scouts',description='Research MMA fighters and matchups with opponent-adjusted Scout Ratings, UFC stats, fight predictions, prospect discovery and documented career history.',canonical=`${SITE}/`,schema={'@context':'https://schema.org','@graph':[{'@type':'WebSite',name:BRAND_NAME,url:canonical,description},{'@type':'Organization',name:BRAND_NAME,url:canonical} ]};
  const block=dashboard(event,rows,threads);
  const rewriter=baseMeta(new HTMLRewriter(),title,description,canonical)
    .on('.hero',{element(el){if(block)el.after(block,{html:true});}})
    .on('.hero .eyebrow',{element(el){el.setInnerContent('THE MMA RESEARCH ENGINE');}})
    .on('.hero h1',{element(el){el.setInnerContent('Research any fighter.<br />Understand any matchup.',{html:true});}})
    .on('.hero .lede',{element(el){el.setInnerContent('Explore fighter stats, opponent-adjusted Scout Ratings, fight predictions, prospects and MMA history—then ask Scout AI what you want to know.');}})
    .on('.topbar nav a[href="/community"]',{element(el){el.setAttribute('href','/forum');el.setInnerContent('Forum');}})
    .on('head',{element(el){el.append(`<link rel="stylesheet" href="/home-dashboard.css"><script src="/home-dashboard.js" defer></script><link rel="canonical" href="${canonical}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:site_name" content="${BRAND_NAME}"><script type="application/ld+json">${jsonLd(schema)}</script>`,{html:true});}});
  const transformed=rewriter.transform(response),out=new Response(transformed.body,transformed);out.headers.set('cache-control','public, max-age=30, s-maxage=90');out.headers.set('Link',`<${canonical}>; rel="canonical"`);return out;
}

export async function predictionsPage(request:Request,env:Env){
  const [response,event]=await Promise.all([asset(request,env,'/predictions.html'),nextEvent(env)]),title='UFC Fight Predictions, Picks & Win Probabilities | MMA Scouts',description='Upcoming UFC fight predictions with locked MMA Scouts model win probabilities, matchup stats, Scout Ratings and an auditable record of every model pick.',canonical=`${SITE}/predictions.html`,schema={'@context':'https://schema.org','@type':'CollectionPage',name:'MMA Scouts UFC Fight Predictions',url:canonical,description,isPartOf:{'@type':'WebSite',name:BRAND_NAME,url:`${SITE}/`}};
  const spot=event?.slug?`<section class="event-spotlight"><div><span class="eyebrow">NEXT UFC CARD · ${escape(prettyDate(event.event_date))}</span><strong>${escape(eventSeoName(event))}: ${escape(event.main_event||event.name)}</strong></div><a class="button primary" href="/events/${escape(event.slug)}">Full card predictions →</a></section>`:'';
  const rewriter=baseMeta(new HTMLRewriter(),title,description,canonical).on('.forecast-intro',{element(el){if(spot)el.after(spot,{html:true});}}).on('.forecast-intro h1',{element(el){el.setInnerContent('UFC Fight Predictions & Win Probabilities');}}).on('.topbar nav a[href="/community"]',{element(el){el.setAttribute('href','/forum');el.setInnerContent('Forum');}}).on('head',{element(el){el.append(`<style>.event-spotlight{margin:8px 0 72px;padding:22px 0;display:flex;justify-content:space-between;gap:20px;align-items:center;border-bottom:1px solid var(--line)}.event-spotlight div{display:grid;gap:8px}.event-spotlight strong{font-size:18px}.event-spotlight .button{white-space:nowrap}@media(max-width:760px){.event-spotlight{display:grid}.event-spotlight .button{width:100%;text-align:center}}</style><link rel="canonical" href="${canonical}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:url" content="${canonical}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(schema)}</script>`,{html:true});}});
  const transformed=rewriter.transform(response),out=new Response(transformed.body,transformed);out.headers.set('cache-control','public, max-age=30, s-maxage=120');out.headers.set('Link',`<${canonical}>; rel="canonical"`);return out;
}
