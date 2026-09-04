import {eventSeoName} from './seo.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE='https://cagemetrix.com';
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const jsonLd=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c');
const prettyDate=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};
const spotlightCss=`<style>
.event-spotlight{margin:8px 0 72px;padding:22px 0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;border-bottom:1px solid var(--line)}
.event-spotlight-copy{display:grid;gap:8px;min-width:0}
.event-spotlight-title{display:block;color:var(--text);font-size:18px;font-weight:800;line-height:1.35}
.event-spotlight .button.primary{color:#fff;white-space:nowrap;text-align:center}
@media(max-width:760px){.event-spotlight{grid-template-columns:1fr;gap:16px;margin:6px 0 60px;padding:20px 0}.event-spotlight .button.primary{display:block;width:100%}.event-spotlight-title{font-size:16px}}
</style>`;

async function nextEvent(env:Env){
  return env.DB.prepare(`SELECT e.id,e.slug,e.name,e.event_date,e.starts_at,e.status,
    (SELECT a.name||' vs '||z.name FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id WHERE b.event_id=e.id ORDER BY b.bout_order,b.id LIMIT 1) main_event
    FROM events e
    WHERE e.slug IS NOT NULL AND e.status='scheduled' AND e.starts_at>=CURRENT_TIMESTAMP
      AND EXISTS(SELECT 1 FROM bouts b JOIN predictions p ON p.bout_id=b.id WHERE b.event_id=e.id)
    ORDER BY e.starts_at ASC LIMIT 1`).first<Row>();
}
function spotlight(event:Row|null){
  if(!event?.slug)return '';
  const label=eventSeoName(event),matchup=event.main_event||event.name;
  return `<section class="event-spotlight" aria-label="Featured upcoming UFC predictions"><div class="event-spotlight-copy"><span class="eyebrow">NEXT UFC CARD · ${escape(prettyDate(event.event_date))}</span><strong class="event-spotlight-title">${escape(label)}: ${escape(matchup)}</strong></div><a class="button primary" href="/events/${escape(event.slug)}">Full card predictions →</a></section>`;
}
async function asset(request:Request,env:Env,pathname:string){
  const url=new URL(request.url);url.pathname=pathname;url.search='';
  return env.ASSETS.fetch(new Request(url.toString(),{method:'GET',headers:request.headers}));
}
function baseMeta(rewriter:HTMLRewriter,title:string,description:string,canonical:string){
  return rewriter
    .on('title',{element(el){el.setInnerContent(title);}})
    .on('meta[name="description"]',{element(el){el.setAttribute('content',description);}})
    .on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}})
    .on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}})
    .on('meta[property="og:url"]',{element(el){el.setAttribute('content',canonical);}})
    .on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}})
    .on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}});
}

export async function homePage(request:Request,env:Env){
  const [response,event]=await Promise.all([asset(request,env,'/index.html'),nextEvent(env)]);
  const title='UFC Rankings, Fight Predictions & MMA Analytics | CageMetrix™';
  const description='Opponent-adjusted UFC rankings, fighter stats and locked fight predictions. Compare CMR™, strength of schedule, technical ratings and model win probabilities.';
  const canonical=`${SITE}/`;
  const schema={'@context':'https://schema.org','@graph':[{'@type':'WebSite',name:'CageMetrix',url:canonical,description},{'@type':'Organization',name:'CageMetrix',url:canonical,logo:`${SITE}/logo.svg`} ]};
  const rewriter=baseMeta(new HTMLRewriter(),title,description,canonical)
    .on('.hero',{element(el){const html=spotlight(event);if(html)el.after(html,{html:true});}})
    .on('head',{element(el){el.append(`${spotlightCss}<link rel="canonical" href="${canonical}"><meta name="robots" content="index,follow,max-image-preview:large"><script type="application/ld+json">${jsonLd(schema)}</script>`,{html:true});}});
  const transformed=rewriter.transform(response);const out=new Response(transformed.body,transformed);out.headers.set('cache-control','public, max-age=60, s-maxage=300');return out;
}

export async function predictionsPage(request:Request,env:Env){
  const [response,event]=await Promise.all([asset(request,env,'/predictions.html'),nextEvent(env)]);
  const title='UFC Fight Predictions, Picks & Win Probabilities | CageMetrix™';
  const description='Upcoming UFC fight predictions with locked CageMetrix™ win probabilities, matchup stats and an auditable record of every model pick.';
  const canonical=`${SITE}/predictions.html`;
  const schema={'@context':'https://schema.org','@type':'CollectionPage',name:'CageMetrix UFC Fight Predictions',url:canonical,description,isPartOf:{'@type':'WebSite',name:'CageMetrix',url:`${SITE}/`}};
  const rewriter=baseMeta(new HTMLRewriter(),title,description,canonical)
    .on('.forecast-intro',{element(el){const html=spotlight(event);if(html)el.after(html,{html:true});}})
    .on('.forecast-intro h1',{element(el){el.setInnerContent('UFC Fight Predictions & Win Probabilities');}})
    .on('head',{element(el){el.append(`${spotlightCss}<link rel="canonical" href="${canonical}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:url" content="${canonical}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(schema)}</script>`,{html:true});}});
  const transformed=rewriter.transform(response);const out=new Response(transformed.body,transformed);out.headers.set('cache-control','public, max-age=30, s-maxage=120');return out;
}
