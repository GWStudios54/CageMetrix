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
  ) SELECT b.id,b.bout_order,a.name fighter_a,z.name fighter_b,a.slug fighter_a_slug,z.slug fighter_b_slug,
    lp.fighter_a_probability,lp.fighter_b_probability,lp.picked_fighter_id,lp.model_version
    FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
    LEFT JOIN latest lp ON lp.bout_id=b.id AND lp.rn=1
    WHERE b.event_id=? ORDER BY b.bout_order,b.id`).bind(PUBLIC_MODEL,eventId).all<Row>();
  const map=new Map<string,Row>();
  for(const r of rows.results||[]){
    const key=[String(r.fighter_a_slug),String(r.fighter_b_slug)].sort().join(':');
    const cur=map.get(key);
    if(!cur||modelRank(r.model_version)<modelRank(cur.model_version)||(modelRank(r.model_version)===modelRank(cur.model_version)&&Number(r.id)>Number(cur.id)))map.set(key,r);
  }
  return [...map.values()].sort((a,b)=>Number(a.bout_order||999)-Number(b.bout_order||999));
}

function matchupSpotlight(event:Row|null,rows:Row[]){
  if(!event?.slug)return `<div class="home-matchup-shell"><div class="home-matchup-head"><div><span class="eyebrow">MATCHUP SCOUT</span><h2>No scheduled card is indexed yet.</h2><p>Scout AI and fighter research remain available across the database.</p></div><a class="button secondary" href="/scout">Ask Scout AI →</a></div></div>`;
  const cards=rows.slice(0,4).map((r,index)=>{
    const a=Number(r.fighter_a_probability),b=Number(r.fighter_b_probability),has=Number.isFinite(a)&&Number.isFinite(b);
    const favored=has?(a>=b?String(r.fighter_a):String(r.fighter_b)):'';
    const pct=has?Math.round(Math.max(a,b)*100):null;
    return `<a class="home-matchup-card" href="/fights/${Number(r.id)}"><span class="home-matchup-label">${index===0?'Featured matchup':`Card matchup ${index+1}`}</span><div class="home-matchup-names"><strong>${escape(r.fighter_a)}</strong><span class="home-matchup-vs">vs</span><strong>${escape(r.fighter_b)}</strong></div><div class="home-model-edge"><small>${has?`Model lean · ${escape(favored)}`:'Open the matchup report and fighter evidence.'}</small>${has?`<b>${pct}%</b>`:'<b>→</b>'}</div></a>`;
  }).join('');
  return `<div class="home-matchup-shell"><div class="home-matchup-head"><div><span class="eyebrow">NEXT CARD · ${escape(prettyDate(event.event_date))}</span><h2>${escape(eventSeoName(event))}</h2><p>${escape(event.main_event||event.name)}</p></div><a class="button secondary" href="/events/${escape(event.slug)}">Open full card →</a></div>${cards?`<div class="home-matchup-grid">${cards}</div>`:''}</div>`;
}

function promptButtons(rows:Row[]){
  const first=rows[0];
  const questions=first?[
    `Compare ${first.fighter_a} and ${first.fighter_b}`,
    `Who has the stronger strength of schedule: ${first.fighter_a} or ${first.fighter_b}?`,
    `Which fighters are statistically similar to ${first.fighter_a}?`,
    'Which regional prospects have faced the strongest opposition?'
  ]:[
    'Which active lightweights have the strongest strength of schedule?',
    'Which regional prospects have faced the strongest opposition?',
    'Who beat the most opponents before those opponents later reached the UFC?'
  ];
  return questions.map(q=>`<button class="home-prompt" type="button" data-home-question="${escape(q)}">${escape(q)}</button>`).join('');
}

async function asset(request:Request,env:Env,pathname:string){const url=new URL(request.url);url.pathname=pathname;url.search='';return env.ASSETS.fetch(new Request(url.toString(),{method:'GET',headers:request.headers}));}
function baseMeta(rewriter:HTMLRewriter,title:string,description:string,canonical:string){return rewriter.on('title',{element(el){el.setInnerContent(title);}}).on('meta[name="description"]',{element(el){el.setAttribute('content',description);}}).on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}}).on('meta[property="og:url"]',{element(el){el.setAttribute('content',canonical);}}).on('meta[property="og:image"]',{element(el){el.setAttribute('content',`${SITE}/og.png`);}}).on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}}).on('meta[name="twitter:image"]',{element(el){el.setAttribute('content',`${SITE}/og.png`);}});}

export async function homePage(request:Request,env:Env){
  const event=await nextEvent(env);
  const [response,rows]=await Promise.all([asset(request,env,'/index.html'),event?.id?eventRows(env,Number(event.id)):Promise.resolve([])]);
  const title='MMA Fighter Research, Scout Ratings & Matchup Analysis | MMA Scouts';
  const description='Research MMA fighters, compare matchups, discover prospects and interrogate fight history with opponent-adjusted Scout Ratings and evidence-grounded Scout AI.';
  const canonical=`${SITE}/`;
  const schema={'@context':'https://schema.org','@graph':[{'@type':'WebSite',name:BRAND_NAME,url:canonical,description,potentialAction:{'@type':'SearchAction',target:`${SITE}/scout?q={search_term_string}`,'query-input':'required name=search_term_string'}},{'@type':'Organization',name:BRAND_NAME,url:canonical}]};
  const rewriter=baseMeta(new HTMLRewriter(),title,description,canonical)
    .on('#home-matchup-slot',{element(el){el.setInnerContent(matchupSpotlight(event,rows),{html:true});}})
    .on('#home-dynamic-prompts',{element(el){el.setInnerContent(promptButtons(rows),{html:true});}})
    .on('head',{element(el){el.append(`<link rel="canonical" href="${canonical}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:site_name" content="${BRAND_NAME}"><script type="application/ld+json">${jsonLd(schema)}</script>`,{html:true});}});
  const transformed=rewriter.transform(response),out=new Response(transformed.body,transformed);
  out.headers.set('cache-control','public, max-age=30, s-maxage=90');
  out.headers.set('Link',`<${canonical}>; rel="canonical"`);
  return out;
}

export async function predictionsPage(request:Request,env:Env){
  const [response,event]=await Promise.all([asset(request,env,'/predictions.html'),nextEvent(env)]),title='Matchup Scout: UFC Fight Predictions & Win Probabilities | MMA Scouts',description='Research upcoming UFC matchups with locked MMA Scouts win probabilities, fighter evidence, Scout Ratings and an auditable record of model picks.',canonical=`${SITE}/predictions.html`,schema={'@context':'https://schema.org','@type':'CollectionPage',name:'MMA Scouts Matchup Scout',url:canonical,description,isPartOf:{'@type':'WebSite',name:BRAND_NAME,url:`${SITE}/`}};
  const spot=event?.slug?`<section class="event-spotlight"><div><span class="eyebrow">NEXT UFC CARD · ${escape(prettyDate(event.event_date))}</span><strong>${escape(eventSeoName(event))}: ${escape(event.main_event||event.name)}</strong></div><a class="button primary" href="/events/${escape(event.slug)}">Full card analysis →</a></section>`:'';
  const rewriter=baseMeta(new HTMLRewriter(),title,description,canonical).on('.forecast-intro',{element(el){if(spot)el.after(spot,{html:true});}}).on('.forecast-intro h1',{element(el){el.setInnerContent('Matchup Scout · UFC Win Probabilities');}}).on('head',{element(el){el.append(`<style>.event-spotlight{margin:8px 0 72px;padding:22px 0;display:flex;justify-content:space-between;gap:20px;align-items:center;border-bottom:1px solid var(--line)}.event-spotlight div{display:grid;gap:8px}.event-spotlight strong{font-size:18px}.event-spotlight .button{white-space:nowrap}@media(max-width:760px){.event-spotlight{display:grid}.event-spotlight .button{width:100%;text-align:center}}</style><link rel="canonical" href="${canonical}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:url" content="${canonical}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(schema)}</script>`,{html:true});}});
  const transformed=rewriter.transform(response),out=new Response(transformed.body,transformed);out.headers.set('cache-control','public, max-age=30, s-maxage=120');out.headers.set('Link',`<${canonical}>; rel="canonical"`);return out;
}
